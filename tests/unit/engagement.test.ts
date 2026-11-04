// Engagement in the demo store: the Brightwork story reads the same at any time of day, agent drafts go through the
// contact rules before they reach the queue, and every action here can be undone.
import { describe, expect, it } from "vitest";
import { seed } from "../../apps/web/src/workspace/demo/seed";
import * as q from "../../apps/web/src/workspace/demo/selectors";
import { accountForRef } from "../../apps/web/src/workspace/demo/store";
import type { AccountRef, State } from "../../apps/web/src/workspace/demo/types";

const CLOCKS: number[] = [];
for (let d = 0; d < 7; d++) for (const h of [0.5, 9, 18.75]) CLOCKS.push(Date.UTC(2026, 9, 26 + d, 0, 0) + h * 3600e3);
const co = (id: string): AccountRef => ({ kind: "company", id });
const sup = (id: string): AccountRef => ({ kind: "supplier", id });
const verdict = (s: State, r: AccountRef) => q.verdictFor(s, r).verdict;

describe.each(CLOCKS.map((t) => [new Date(t).toISOString(), t]))("the Brightwork story at %s", (_label, t) => {
  const s = seed(t as number);

  it("Castlefield accepted by email and nobody has confirmed", () => {
    const e = q.verdictFor(s, co("co_castlefield"));
    expect(e.verdict).toBe("confirm");
    expect(e.rules.find((r) => r.id === "R4")!.detail).toMatch(/email/);
  });
  it("Chorlton accepted on Lee's WhatsApp, which nobody else saw, and the 4 hours are up", () => {
    const e = q.verdictFor(s, co("co_chorlton"));
    expect(e.verdict).toBe("confirm");
    expect(e.rules.find((r) => r.id === "R4")!.state).toBe("fail");
    expect(q.touchesFor(s, co("co_chorlton"))[0]).toMatchObject({ channel: "whatsapp", heardBy: { kind: "person", id: "p_lee" }, outcome: "accepted" });
  });
  it("Whalley and Northgate are waiting on replies", () => {
    expect(verdict(s, co("co_whalley"))).toBe("reply");
    expect(verdict(s, co("co_northgate"))).toBe("reply");
  });
  it("Salford: Theo's reply is held because Dana phoned first, and it waits for a decision", () => {
    expect(verdict(s, co("co_salford"))).toBe("quiet");
    const g = q.holdsFor(s, co("co_salford"));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ actor: { kind: "agent", id: "agt_cs" }, ruleId: "R2", decision: "held", approvalId: "apr_salford" });
    const call = q.touchesFor(s, co("co_salford")).find((x) => x.channel === "phone")!;
    expect(call.actor).toEqual({ kind: "person", id: "p_dana" });
    expect(Date.parse(call.at)).toBeLessThan(Date.parse(g[0].at));
  });
  it("Ashworth and Castle Quay are breaches, logged after the fact", () => {
    const b = s.guard.filter((g) => g.decision === "breach");
    const ash = b.find((g) => g.account.id === "co_ashworth")!, cq = b.find((g) => g.account.id === "co_castlequay")!;
    expect(ash.ruleId).toBe("R6");
    expect(cq.ruleId).toBe("R2");
    for (const g of [ash, cq]) {
      const touch = s.touches.find((x) => x.id === g.touchId)!;
      expect(Date.parse(touch.loggedAt)).toBeGreaterThan(Date.parse(touch.at));
      expect(g.actor.kind).toBe("person");
    }
    expect(verdict(s, co("co_ashworth"))).toBe("capped");
  });
  it("Brightside: Dana overrode the quiet period with a reason", () => {
    const g = s.guard.find((x) => x.account.id === "co_brightside")!;
    expect(g).toMatchObject({ decision: "overridden", ruleId: "R2", actor: { kind: "person", id: "p_dana" } });
    expect(g.reason!.length).toBeGreaterThan(10);
  });
  it("Hulme, Clearwater and Didsbury Family Dental are on do not contact", () => {
    expect(verdict(s, co("co_hulme"))).toBe("dnc");
    expect(verdict(s, sup("sup_clearwater"))).toBe("dnc");
    expect(verdict(s, co("co_didsfam"))).toBe("dnc");
    expect(q.engagementAccounts(s, { view: "dnc" }).map((r) => r.name).sort()).toEqual(["Clearwater Window Supplies", "Didsbury Family Dental", "Hulme Dental"]);
  });
  it("needs attention: two acceptances, three replies (Holcombe's too) and one held send, soonest limit first", () => {
    const n = q.needsAttention(s);
    expect(n.map((x) => x.kind).sort()).toEqual(["confirm", "confirm", "held", "reply", "reply", "reply"]);
    expect(q.engagementWaiting(s)).toBe(6);
    const due = n.map((x) => x.dueAt!);
    expect([...due].sort()).toEqual(due);
    expect(q.viewCounts(s).needs).toBe(6);
  });
  it("every pending decision that contacts someone passes the contact rules", () => {
    const NEW: Record<string, boolean> = { send_outreach: true, reply_enquiry: false, send_reminder: true, send_invoice: true, follow_up_quote: false };
    const checked = q.pending(s).filter((a) => a.type in NEW);
    expect(checked.length).toBe(6);
    for (const a of checked) {
      const acc = accountForRef(s, a.linkedRecord)!;
      expect(q.checkAttempt(s, acc, { actor: { kind: "agent", id: a.agentId }, channel: "email", newThread: NEW[a.type] }).decision, a.id).toBe("allow");
    }
  });
  it("every account has an owner, and every bill's supplier is a record", () => {
    for (const r of q.allAccounts(s)) expect(q.ownerOf(s, r)).not.toBeNull();
    for (const b of s.bills) expect(s.suppliers.some((x) => x.id === b.supplierId)).toBe(true);
  });
  it("uses all six channels and all six sequence states", () => {
    expect(new Set(s.touches.map((x) => x.channel)).size).toBe(6);
    expect(new Set(s.sequences.map((x) => x.state))).toEqual(new Set(["active", "paused", "held", "finished", "stopped", "awaiting"]));
  });
  it("the chart has 30 days of outbound touches from people and agents, with the double contacts and the hold marked", () => {
    const c = q.touchesPerDay(s, 30, "sender");
    expect(c.days).toHaveLength(30);
    expect(c.days.reduce((n, d) => n + d.parts.person, 0)).toBeGreaterThan(5);
    expect(c.days.reduce((n, d) => n + d.parts.agent, 0)).toBeGreaterThan(5);
    expect(c.days.reduce((n, d) => n + d.double, 0)).toBeGreaterThanOrEqual(3);
    expect(c.days.reduce((n, d) => n + d.held, 0)).toBeGreaterThanOrEqual(1);
    const byCh = q.touchesPerDay(s, 30, "channel");
    for (const d of byCh.days) expect(Object.values(d.parts).reduce((a, b) => a + b, 0)).toBe(d.total);
  });
  it("six figures, each with the period before", () => {
    const f = q.engagementFigures(s);
    expect(f).toHaveLength(6);
    for (const x of f) expect(typeof x.before).toBe("number");
  });
});

describe("agent drafts go through the contact rules", async () => {
  const store = await import("../../apps/web/src/workspace/demo/store");
  // Store actions are stamped with the real time, so these start from a seed made now.
  const at = Date.now();

  it("every pending decision in the seed goes out when approved", () => {
    store.init(seed(at));
    store.approveMany(q.pending(store.getState()).map((a) => a.id));
    const s = store.getState();
    expect(q.pendingCount(s)).toBe(0);
    expect(s.approvals.filter((a) => a.status === "held").map((a) => a.id)).toEqual(["apr_salford"]);
  });
  it("a draft for an account in someone else's quiet period is held, the owner is told, and undo takes it all back", () => {
    store.init(seed(at));
    const before = store.getState();
    const tok = store.confirmAcceptance(co("co_brightside"));
    const s = store.getState();
    expect(store.guardOutcome(tok)).toMatchObject({ outcome: "held", ruleId: "R2" });
    expect(q.pendingCount(s)).toBe(q.pendingCount(before));
    const g = s.guard[0];
    expect(g).toMatchObject({ decision: "held", pending: true, actor: { kind: "agent", id: "agt_cs" } });
    expect(s.approvals.find((a) => a.id === g.approvalId)!.status).toBe("held");
    expect(s.tasks[0].title).toMatch(/held message to Brightside/);
    store.undo(tok);
    const u = store.getState();
    expect(u.guard.length).toBe(before.guard.length);
    expect(u.approvals.length).toBe(before.approvals.length);
    expect(u.tasks.length).toBe(before.tasks.length);
  });
  it("a draft for an account on do not contact is skipped: no decision, a blocked entry, and the sequence stops", () => {
    store.init(seed(at));
    const before = store.getState();
    const tok = store.confirmAcceptance(co("co_hulme"));
    const s = store.getState();
    expect(store.guardOutcome(tok)).toMatchObject({ outcome: "blocked", ruleId: "R1" });
    expect(s.approvals.length).toBe(before.approvals.length);
    expect(s.guard[0]).toMatchObject({ decision: "blocked", pending: false });
  });
  it("a draft for a clear account goes to the queue", () => {
    store.init(seed(at));
    const n = q.pendingCount(store.getState());
    const tok = store.confirmAcceptance(co("co_chorlton"));
    expect(store.guardOutcome(tok)!.outcome).toBe("queued");
    expect(q.pendingCount(store.getState())).toBe(n + 1);
  });
  it("following up quotes skips Hulme (do not contact), holds Ashworth (at the weekly limit) and drafts Chorlton", () => {
    store.init(seed(at));
    store.fixLeak("leak_quotes");
    const s = store.getState();
    const draft = q.pending(s).find((a) => a.type === "follow_up_quote")!;
    expect(draft.title).toBe("Follow up 1 quote");
    expect(draft.linkedRecord.id).toBe("q_chorlton");
    expect(s.guard.find((g) => g.account.id === "co_hulme" && g.decision === "blocked")!.ruleId).toBe("R1");
    expect(s.guard.find((g) => g.account.id === "co_ashworth" && g.decision === "held")!.ruleId).toBe("R6");
  });
  it("approving re-checks: if someone phoned since the draft, the send is held instead", () => {
    store.init(seed(at));
    store.logTouch({ account: co("co_castlefield"), actor: { kind: "person", id: "p_dana" }, channel: "phone", direction: "out", text: "Rang Dr Haddad", thread: "cv_castlefield" });
    const tok = store.approve("apr_castlefield")!;
    expect(store.guardOutcome(tok)).toMatchObject({ outcome: "held", ruleId: "R2" });
    expect(store.getState().approvals.find((a) => a.id === "apr_castlefield")!.status).toBe("held");
  });
  it("a send that goes out is a touch the next check sees", () => {
    store.init(seed(at));
    store.approve("apr_castlefield");
    const s = store.getState();
    expect(q.touchesFor(s, co("co_castlefield"))[0]).toMatchObject({ actor: { kind: "agent", id: "agt_cs" }, direction: "out", channel: "email" });
    expect(verdict(s, co("co_castlefield"))).toBe("quiet");
  });
});

describe("held messages, overrides and breaches", async () => {
  const store = await import("../../apps/web/src/workspace/demo/store");
  // Store actions are stamped with the real time, so these start from a seed made now.
  const at = Date.now();

  it("sending a held message needs a reason, is logged as overridden, and goes out", () => {
    store.init(seed(at));
    expect(store.sendHeld("ge_salford", "  ")).toBeNull();
    const tok = store.sendHeld("ge_salford", "Ellie asked for it in writing on the call")!;
    const s = store.getState();
    expect(s.guard.find((g) => g.id === "ge_salford")).toMatchObject({ decision: "overridden", pending: false, decidedBy: "p_dana", reason: "Ellie asked for it in writing on the call" });
    expect(s.approvals.find((a) => a.id === "apr_salford")!.status).toBe("approved");
    expect(s.conversations.find((c) => c.id === "cv_salford")!.status).toBe("waiting");
    expect(q.engagementWaiting(s)).toBe(5);
    store.undo(tok);
    expect(store.getState().guard.find((g) => g.id === "ge_salford")!.pending).toBe(true);
    expect(store.getState().approvals.find((a) => a.id === "apr_salford")!.status).toBe("held");
  });
  it("dropping a held message sends nothing and pauses the sequence", () => {
    store.init(seed(at));
    store.dropHeld("ge_salford");
    const s = store.getState();
    expect(s.guard.find((g) => g.id === "ge_salford")).toMatchObject({ pending: false, outcome: "Dropped" });
    expect(s.approvals.find((a) => a.id === "apr_salford")!.status).toBe("rejected");
    expect(s.sequences.find((x) => x.id === "sq_salford")!.state).toBe("paused");
    expect(s.conversations.find((c) => c.id === "cv_salford")!.status).toBe("new");
  });
  it("a person contacting someone in a quiet period needs a reason, and it's logged as overridden", () => {
    store.init(seed(at));
    const x = { account: co("co_castlequay"), actor: { kind: "person" as const, id: "p_sam" }, channel: "phone" as const, direction: "out" as const, text: "Rang Bea", thread: "cq_xmas" };
    expect(q.checkAttempt(store.getState(), x.account, { actor: x.actor, channel: x.channel, newThread: false }).decision).toBe("warn");
    expect(store.logTouch(x)).toBeNull();
    store.logTouch(x, "Bea asked for a call about the alarm");
    expect(store.getState().guard[0]).toMatchObject({ decision: "overridden", ruleId: "R2", reason: "Bea asked for a call about the alarm" });
  });
  it("a call logged after the fact that broke a rule is a breach", () => {
    store.init(seed(at));
    const when = new Date(Date.now() - 3 * 3600e3).toISOString();
    store.logTouch({ account: co("co_hulme"), actor: { kind: "person", id: "p_lee" }, channel: "phone", direction: "out", text: "Rang about the quote", at: when, thread: "q_q_hulme" });
    expect(store.getState().guard[0]).toMatchObject({ decision: "breach", ruleId: "R1" });
  });
  it("an acceptance logged by whoever heard it puts the account in Needs action", () => {
    store.init(seed(at));
    const n = q.engagementWaiting(store.getState());
    store.logTouch({ account: co("co_nq"), actor: { kind: "person", id: "p_sam" }, channel: "phone", direction: "in", text: "Rob said yes to a walk-round", outcome: "accepted" });
    expect(q.engagementWaiting(store.getState())).toBe(n + 1);
  });
  it("owners, paused automations and rule changes can all be undone", () => {
    store.init(seed(at));
    const refs = [co("co_whalley"), co("co_nq")];
    const t1 = store.assignOwner(refs, { kind: "person", id: "p_dana" });
    expect(q.ownerOf(store.getState(), refs[0])).toEqual({ kind: "person", id: "p_dana" });
    const t2 = store.pauseSequences(refs);
    expect(store.getState().sequences.filter((x) => refs.some((r) => r.id === x.account.id)).every((x) => x.state === "paused")).toBe(true);
    const t3 = store.setContactRule("R2", { hours: 12 });
    expect(store.getState().contactRules.R2.hours).toBe(12);
    store.undo(t3); store.undo(t2); store.undo(t1);
    const s = store.getState();
    expect(s.contactRules.R2.hours).toBe(48);
    expect(q.ownerOf(s, refs[0])).toEqual({ kind: "agent", id: "agt_sales" });
    expect(s.sequences.find((x) => x.id === "sq_whalley")!.state).toBe("active");
  });
  it("switching the quiet period off clears Salford, Castle Quay and Brightside", () => {
    store.init(seed(at));
    store.setContactRule("R2", { on: false });
    const s = store.getState();
    for (const id of ["co_salford", "co_castlequay", "co_brightside"]) expect(verdict(s, co(id))).toBe("clear");
  });
  it("the grid filters, sorts and exports", () => {
    store.init(seed(at));
    const s = store.getState();
    expect(q.engagementAccounts(s, { view: "suppliers" }).every((r) => r.ref.kind === "supplier")).toBe(true);
    expect(q.engagementAccounts(s, { channel: "whatsapp" }).map((r) => r.ref.id)).toEqual(expect.arrayContaining(["co_chorlton", "co_castlequay"]));
    expect(q.engagementAccounts(s, { owner: "person:p_sam" }).every((r) => r.owner?.id === "p_sam")).toBe(true);
    const byName = q.engagementAccounts(s, { sort: { key: "name", dir: 1 } }).map((r) => r.name);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
    const csv = q.engagementCsv(s, q.engagementAccounts(s, { view: "dnc" }));
    expect(csv[0][0]).toBe("Account");
    expect(csv).toHaveLength(4);
  });
});
