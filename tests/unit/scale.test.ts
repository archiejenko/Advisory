// The fixes from the architecture check, against the real SQL: queues, crons, the Floor, mail, clean-up.
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import { preset } from "../../packages/core/swarms";
import { dueAgents, startDue, runAgent, nextRunAt, spreadMinute, RUNS_AT_ONCE } from "../../apps/api/src/lib/agents";
import { onQueue, retention, prospectRows, purgeOrg, MAX_WAITS } from "../../apps/api/src/lib/jobs";
import { isWatched } from "../../apps/api/src/lib/process";
import { createSwarm } from "../../apps/api/src/lib/engine";
import { floorState, EVENT_PAGE, BULK_EVENTS, syncSwarm } from "../../apps/api/src/lib/swarm";
import { onEmail, isAutomated } from "../../apps/api/src/lib/inbound";

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const DAY = 864e5;
afterEach(() => vi.restoreAllMocks());

let msgSeq = 0;
function batch(queue: string, bodies: any[]) {
  const msgs = bodies.map((body) => ({ id: "m" + ++msgSeq, body, attempts: 1, acked: false, retried: null as any, ack() { this.acked = true; }, retry(o: any) { this.retried = o || {}; } }));
  return { queue, messages: msgs } as any;
}

describe("scheduled agents", () => {
  it("spreads agents set for the same hour across 45 minutes, the same minute every time", () => {
    const m = spreadMinute("agt_abc");
    expect(m).toBe(spreadMinute("agt_abc"));
    expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThan(45);
    const minutes = new Set(Array.from({ length: 200 }, (_, i) => spreadMinute("agt_" + i)));
    expect(minutes.size).toBeGreaterThan(30);
    expect(nextRunAt("daily", 8, new Date("2026-07-01T06:00:00Z"), 17)).toBe("2026-07-01T07:17:00.000Z");
  });

  it("the cron queues one start per due agent and moves each next run on, without starting runs itself", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    for (const id of ["agt_1", "agt_2", "agt_3"]) seedAgent(raw, org.id, { id });
    raw.prepare("UPDATE agent SET status = 'running', rhythm = 'daily', run_hour = 8, next_run_at = ?").run(iso(60000));
    expect(await dueAgents(env)).toBe(3);
    expect(env.JOBS.sent.map((j: any) => j.type)).toEqual(["agent_start", "agent_start", "agent_start"]);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM agent_run").get() as any).n).toBe(0);
    const next = raw.prepare("SELECT next_run_at FROM agent").all() as any[];
    for (const r of next) expect(Date.parse(r.next_run_at)).toBeGreaterThan(Date.now());
    expect(await dueAgents(env)).toBe(0);
  });

  it("a start message delivered twice makes one run", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    seedAgent(raw, org.id, { id: "agt_1" });
    raw.prepare("UPDATE agent SET status = 'running'").run();
    const due = iso(60000);
    expect(await startDue(env, org.id, "agt_1", due)).toBe("started");
    expect(await startDue(env, org.id, "agt_1", due)).toBe("duplicate");
    expect((raw.prepare("SELECT COUNT(*) AS n FROM agent_run").get() as any).n).toBe(1);
  });

  it("a paused agent's start is refused quietly, not retried", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    seedAgent(raw, org.id, { id: "agt_1", template: "research" });
    expect(await startDue(env, org.id, "agt_1", iso())).toBe("refused");
  });
});

describe("runs per business", () => {
  it(`runs at most ${RUNS_AT_ONCE} at once for one business; the next waits for a slot instead of using a retry`, async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id);
    for (const id of ["run_a", "run_b"]) raw.prepare("INSERT INTO agent_run (id, org_id, agent_id, trigger, status, created_at, started_at) VALUES (?, ?, ?, 'manual', 'running', ?, ?)").run(id, org.id, agent, iso(), iso());
    raw.prepare("INSERT INTO agent_run (id, org_id, agent_id, trigger, status, created_at) VALUES ('run_c', ?, ?, 'manual', 'queued', ?)").run(org.id, agent, iso());
    expect(await runAgent(env, "run_c")).toBe("deferred");
    expect((raw.prepare("SELECT status FROM agent_run WHERE id = 'run_c'").get() as any).status).toBe("queued");
    expect(env.AGENT_JOBS.sent).toEqual([{ type: "agent_run", run_id: "run_c" }]);
  });

  it("a run the sweep already called interrupted stays interrupted when it finishes late", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0" });
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { template: "research" });
    raw.prepare("INSERT INTO agent_run (id, org_id, agent_id, trigger, input, status, created_at) VALUES ('run_l', ?, ?, 'manual', 'Who?', 'queued', ?)").run(org.id, agent, iso());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      raw.prepare("UPDATE agent_run SET status = 'failed', error = 'Interrupted' WHERE id = 'run_l'").run(); // the sweep, mid-run
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200 });
    });
    await runAgent(env, "run_l");
    const r = raw.prepare("SELECT status, steps, cost_pence FROM agent_run WHERE id = 'run_l'").get() as any;
    expect(r.status).toBe("failed");
    expect(r.steps).toBe(1);
  });
});

describe("the job queue", () => {
  const fullWindow = (raw: any, n = 600) => raw.prepare("INSERT INTO rate_window (bucket, count) VALUES (?, ?)").run("ch:" + Math.floor(Date.now() / 300000), n);

  it("a job waiting for register budget goes back on the queue with a delay, without using a retry", async () => {
    const { raw, env } = testEnv({ CH_API_BASE: "https://ch.test", CH_API_KEY: "k" });
    fullWindow(raw);
    const b = batch("agent-house-jobs", [{ type: "company", number: "01234567", event_id: "evt_1" }]);
    const sent: any[] = [];
    env.JOBS.send = async (body: any, opts: any) => { sent.push({ body, opts }); };
    await onQueue(b, env);
    expect(b.messages[0].acked).toBe(true);
    expect(b.messages[0].retried).toBeNull();
    expect(sent[0].body).toMatchObject({ type: "company", _waits: 1 });
    expect(sent[0].opts.delaySeconds).toBeGreaterThan(0);
  });

  it(`after ${MAX_WAITS} waits it falls back to ordinary retries`, async () => {
    const { raw, env } = testEnv({ CH_API_BASE: "https://ch.test", CH_API_KEY: "k" });
    fullWindow(raw);
    const b = batch("agent-house-jobs", [{ type: "company", number: "01234567", event_id: "evt_1", _waits: MAX_WAITS }]);
    await onQueue(b, env);
    expect(b.messages[0].acked).toBe(false);
    expect(b.messages[0].retried).not.toBeNull();
  });

  it("dead letters are recorded, acknowledged, and the operator hears once an hour", async () => {
    const { raw, env } = testEnv({ OPERATOR_EMAIL: "ops@ah.test" });
    await onQueue(batch("agent-house-dead", [{ type: "deliver", alert_id: "al_1" }, { type: "agent_run", run_id: "run_1" }]), env);
    await onQueue(batch("agent-house-dead", [{ type: "digest", org_id: "org_a" }]), env);
    expect((raw.prepare("SELECT type FROM dead_job ORDER BY type").all() as any[]).map((r) => r.type)).toEqual(["agent_run", "deliver", "digest"]);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_addr = 'ops@ah.test'").get() as any).n).toBe(1);
  });
});

describe("watches and prospects", () => {
  it("finds a Truth API watch by number, by index", async () => {
    const { raw, env } = testEnv();
    raw.prepare("INSERT INTO watch_subscription (id, key_id, numbers, webhook, created_at) VALUES ('wch_1', 'key_1', '[\"01234567\"]', 'https://x.test', ?)").run(iso());
    raw.prepare("INSERT INTO watch_number (watch_id, number) VALUES ('wch_1', '01234567')").run();
    expect(await isWatched(env, "01234567")).toBe(true);
    expect(await isWatched(env, "07654321")).toBe(false);
  });

  it("a prospect list for a wide area doesn't run past D1's 100 parameters", async () => {
    const { raw, env } = testEnv();
    raw.prepare("INSERT INTO company_index (number, name, status, district, sic, incorporated) VALUES ('00000001', 'Acme', 'Active', 'M99', '69201', '2010-01-01')").run();
    const districts = Array.from({ length: 150 }, (_, i) => "M" + (i + 1));
    const rows = await prospectRows(env, { id: "org_a", prospect_districts: JSON.stringify(districts), prospect_sic: JSON.stringify(["69", "70"]), prospect_min_age: 3 }, 10);
    expect(rows.map((r: any) => r.number)).toEqual(["00000001"]);
  });
});

describe("the Floor", () => {
  async function team() {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "growth" });
    const r = await createSwarm(env, org.id, org.user, preset("sales-floor")!.blueprint, { preset: "sales-floor" });
    return { raw, env, org, id: r.id };
  }

  it("pages forwards from the cursor, so a Floor that fell behind misses nothing", async () => {
    const { raw, env, org, id } = await team();
    const ins = raw.prepare("INSERT INTO swarm_event (org_id, swarm_id, kind, summary, at) VALUES (?, ?, 'tool', ?, ?)");
    for (let i = 0; i < EVENT_PAGE + 25; i++) ins.run(org.id, id, "e" + i, iso());
    const first = await floorState(env, org.id, id);
    expect(first.events).toHaveLength(EVENT_PAGE);
    const start = (raw.prepare("SELECT MIN(id) AS id FROM swarm_event WHERE swarm_id = ?").get(id) as any).id;
    const page1 = await floorState(env, org.id, id, start);
    expect(page1.events).toHaveLength(EVENT_PAGE);
    expect(page1.more).toBe(true);
    const page2 = await floorState(env, org.id, id, page1.cursor);
    expect(page2.more).toBe(false);
    const total = (raw.prepare("SELECT COUNT(*) AS n FROM swarm_event WHERE swarm_id = ? AND id > ?").get(id, start) as any).n;
    expect(page1.events.length + page2.events.length).toBe(total);
  });

  it(`more than ${BULK_EVENTS} new cards in one sync are logged as one line`, async () => {
    const { raw, env, org, id } = await team();
    const before = (raw.prepare("SELECT COUNT(*) AS n FROM swarm_event WHERE swarm_id = ?").get(id) as any).n;
    const ins = raw.prepare("INSERT INTO lead (id, org_id, company, status, created_at) VALUES (?, ?, ?, 'new', ?)");
    for (let i = 0; i < 300; i++) ins.run("lead_" + i, org.id, "Co " + i, iso());
    await syncSwarm(env, org.id, id, { force: true });
    expect((raw.prepare("SELECT COUNT(*) AS n FROM work_item WHERE swarm_id = ?").get(id) as any).n).toBe(300);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM swarm_event WHERE swarm_id = ?").get(id) as any).n).toBe(before + 1);
  });

  it("a poll re-reads the records at most once a minute", async () => {
    const { raw, env, org, id } = await team();
    raw.prepare("UPDATE swarm SET synced_at = ?").run(iso(20000));
    raw.prepare("INSERT INTO lead (id, org_id, company, status, created_at) VALUES ('lead_x', ?, 'New Co', 'new', ?)").run(org.id, iso());
    await floorState(env, org.id, id);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM work_item WHERE ref_id = 'lead_x'").get() as any).n).toBe(0);
    raw.prepare("UPDATE swarm SET synced_at = ?").run(iso(61000));
    await floorState(env, org.id, id);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM work_item WHERE ref_id = 'lead_x'").get() as any).n).toBe(1);
  });
});

describe("inbound mail", () => {
  const mail = (env: any, to: string, subject: string, headers: Record<string, string> = {}) => {
    const text = `From: sam@customer.example\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\nHello, can you quote for a clean?`;
    return onEmail({ from: "sam@customer.example", to, rawSize: text.length, raw: new Response(text).body, headers: new Headers({ subject, ...headers }), setReject() {} } as any, env);
  };

  it("spots auto-replies, newsletters and lists", () => {
    expect(isAutomated(new Headers({ "auto-submitted": "auto-replied" }))).toBe(true);
    expect(isAutomated(new Headers({ "list-unsubscribe": "<mailto:x@y>" }))).toBe(true);
    expect(isAutomated(new Headers({ precedence: "bulk" }))).toBe(true);
    expect(isAutomated(new Headers({ "auto-submitted": "no" }))).toBe(false);
    expect(isAutomated(new Headers({}))).toBe(false);
  });

  it("a burst of enquiries wakes the inbox agent once; automated mail is kept but wakes nobody", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    seedAgent(raw, org.id, { id: "agt_in", template: "inbox" });
    raw.prepare("UPDATE agent SET status = 'running', rhythm = 'on_event'").run();
    for (let i = 0; i < 5; i++) await mail(env, `${org.id}-in@in.ah.test`, "Quote " + i);
    await mail(env, `${org.id}-in@in.ah.test`, "Out of office", { "auto-submitted": "auto-replied" });
    expect((raw.prepare("SELECT COUNT(*) AS n FROM inbox_message").get() as any).n).toBe(6);
    expect((raw.prepare("SELECT status FROM inbox_message WHERE subject = 'Out of office'").get() as any).status).toBe("ignored");
    expect((raw.prepare("SELECT COUNT(*) AS n FROM agent_run").get() as any).n).toBe(1);
  });
});

describe("clean-up", () => {
  it("trims the Floor's log by id, clears old message bodies, and drops processed register events", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const ev = raw.prepare("INSERT INTO swarm_event (org_id, swarm_id, kind, summary, at) VALUES (?, 'swm_1', 'tool', 'x', ?)");
    for (let i = 0; i < 5; i++) ev.run(org.id, iso(40 * DAY));
    for (let i = 0; i < 3; i++) ev.run(org.id, iso(DAY));
    raw.prepare("INSERT INTO inbox_message (id, org_id, from_addr, subject, body, received_at) VALUES ('msg_old', ?, 'a@b', 's', 'old body', ?)").run(org.id, iso(92 * DAY));
    raw.prepare("INSERT INTO inbox_message (id, org_id, from_addr, subject, body, received_at) VALUES ('msg_new', ?, 'a@b', 's', 'new body', ?)").run(org.id, iso(DAY));
    raw.prepare("INSERT INTO register_event (id, number, kind, occurred_at, source, source_id, processed_at) VALUES ('evt_old', '01234567', 'x', ?, 's', '1', ?)").run(iso(100 * DAY), iso(100 * DAY));
    const r = await retention(env);
    expect(r).toMatchObject({ swarm_events: 5, inbox_bodies: 1, register_events: 1 });
    expect((raw.prepare("SELECT COUNT(*) AS n FROM swarm_event").get() as any).n).toBe(3);
    expect((raw.prepare("SELECT body FROM inbox_message WHERE id = 'msg_old'").get() as any).body).toBeNull();
    expect((raw.prepare("SELECT body FROM inbox_message WHERE id = 'msg_new'").get() as any).body).toBe("new body");
  });

  it("one failing step doesn't stop the others", async () => {
    const { raw, env } = testEnv();
    raw.exec("DROP TABLE health_check");
    raw.prepare("INSERT INTO swarm_event (org_id, swarm_id, kind, summary, at) VALUES ('org_a', 'swm_1', 'tool', 'x', ?)").run(iso(40 * DAY));
    const r = await retention(env);
    expect(String(r.health_checks)).toMatch(/^failed/);
    expect(r.swarm_events).toBe(1);
  });

  it("a purge finishes, people with no other workspace go too, and a second purge does nothing", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("UPDATE org SET cancelled_at = ?").run(iso(40 * DAY));
    raw.prepare("INSERT INTO house_rule (id, org_id, text, source, created_at) VALUES ('hr_1', ?, 'Sign off Cheers', 'owner', ?)").run(org.id, iso());
    expect(await purgeOrg(env, org.id)).toMatchObject({ people: 1 });
    expect((raw.prepare("SELECT COUNT(*) AS n FROM house_rule").get() as any).n).toBe(0);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM user").get() as any).n).toBe(0);
    expect(await purgeOrg(env, org.id)).toEqual({ skipped: true });
  });
});

describe("the weekly re-check", () => {
  it("takes one seventh of the watched companies a day, and every company once a week", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const ins = raw.prepare("INSERT INTO client (org_id, number, display_name, added_at) VALUES (?, ?, 'Co', ?)");
    for (let i = 0; i < 140; i++) ins.run(org.id, String(10000000 + i * 37).padStart(8, "0"), iso());
    const { reconcile } = await import("../../apps/api/src/lib/jobs");
    let total = 0;
    for (let d = 0; d < 7; d++) total += await reconcile(env, new Date(Date.UTC(2026, 9, 18 + d, 6)));
    expect(total).toBe(140);
    expect(await reconcile(env, new Date(), { all: true })).toBe(140);
    const one = await reconcile(env, new Date(Date.UTC(2026, 9, 19, 6)));
    expect(one).toBeGreaterThan(10); expect(one).toBeLessThan(35);
  });
});
