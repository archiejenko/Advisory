// The OS Builder: the app library, packs, saving and loading a business's OS, and how it limits the AI Team.
import { describe, it, expect, afterEach, vi } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import worker from "../../apps/api/src/index";
import { sha256Hex } from "../../packages/core/util";
import { FACETS, CATEGORIES, AREAS, facet } from "../../packages/core/os";
import {
  LIBRARY, PACKS, DEPENDS, TEMPLATE_MODULES, TOOL_MODULES, BUILDER_APPS, featuresOf, configFromPack, validateConfig,
  toolAllowed, templateAllowed, effectiveAutonomy, estimate, moduleSetting,
} from "../../packages/core/osconfig";
import { TEMPLATES } from "../../packages/core/templates";
import { getTool, runTool } from "../../apps/api/src/lib/tools";
import { proposeEmail } from "../../apps/api/src/lib/actions";
import { saveOs, loadOs, changes } from "../../apps/api/src/lib/osbuilder";
import { hireAgent } from "../../apps/api/src/lib/agents";

afterEach(() => vi.restoreAllMocks());

async function signedIn(role = "owner") {
  const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0" });
  const org = seedOrg(raw);
  raw.prepare("UPDATE membership SET role = ?").run(role);
  raw.prepare("INSERT INTO session (id_hash, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)").run(await sha256Hex("sid_1"), org.user, org.id, new Date(Date.now() + 864e5).toISOString());
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request("https://ah.test/api/ws" + path, { ...init, headers: { Cookie: "ah_session=sid_1", "Content-Type": "application/json", ...(init.headers || {}) } }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  const send = (method: string, path: string, b: unknown) => call(path, { method, body: JSON.stringify(b) });
  return { raw, env, org, call, send };
}

describe("the app library", () => {
  it("puts every app but the always-on agent platform in one of ten categories", () => {
    expect(CATEGORIES).toHaveLength(10);
    const covered = CATEGORIES.flatMap((c) => c.areas);
    for (const a of AREAS) if (a.key !== "AP") expect(covered, a.key).toContain(a.key);
    expect(new Set(covered).size).toBe(covered.length);
    expect(LIBRARY.reduce((n, c) => n + c.apps.length, 0)).toBe(BUILDER_APPS.length);
    expect(BUILDER_APPS.length).toBe(FACETS.length - 5);
  });
  it("gives every app four to ten features with unique keys and honest depths", () => {
    for (const f of BUILDER_APPS) {
      const fs = featuresOf(f.key);
      expect(fs.length, f.key).toBeGreaterThanOrEqual(4);
      expect(fs.length, f.key).toBeLessThanOrEqual(10);
      expect(new Set(fs.map((x) => x.key)).size, f.key).toBe(fs.length);
      for (const x of fs) expect(["full", "partial", "basic"]).toContain(x.depth);
      // A feature never claims more than its app does.
      const rank = { basic: 0, partial: 1, full: 2 } as const;
      for (const x of fs) expect(rank[x.depth], `${f.key}/${x.key}`).toBeLessThanOrEqual(rank[f.depth]);
    }
  });
  it("covers what an all-in-one suite needs: tills, shop, manufacturing, studio and the rest", () => {
    for (const k of ["point-of-sale-shop", "point-of-sale-restaurant", "online-shop", "manufacturing", "maintenance", "studio", "spreadsheets", "documents", "surveys", "rentals", "subscriptions-and-recurring-billing", "marketing-automation"]) expect(facet(k), k).toBeTruthy();
  });
  it("packs, dependencies and the agent and tool maps only name real apps", () => {
    for (const p of PACKS) for (const k of [...p.here, ...(p.outsourced || [])]) expect(facet(k), `${p.key}: ${k}`).toBeTruthy();
    for (const [k, deps] of Object.entries(DEPENDS)) { expect(facet(k), k).toBeTruthy(); for (const d of deps) expect(facet(d), d).toBeTruthy(); }
    for (const [t, mods] of Object.entries(TEMPLATE_MODULES)) { expect(TEMPLATES.some((x) => x.key === t), t).toBe(true); for (const m of mods) expect(facet(m), m).toBeTruthy(); }
    for (const mods of Object.values(TOOL_MODULES)) for (const m of mods) expect(facet(m), m).toBeTruthy();
    for (const p of PACKS) expect(validateConfig(configFromPack(p.key)).ok, p.key).toBe(true);
  });
  it("estimates the plan from the apps placed and the people using them", () => {
    expect(estimate(configFromPack("blank"), 2).plan).toBe("starter");
    expect(estimate(configFromPack("trades"), 12).plan).toBe("growth");
    expect(estimate(configFromPack("retail"), 60).plan).toBe("scale");
  });
});

describe("saving your OS", () => {
  it("an owner builds it from a pack, sees it back, and can undo a change", async () => {
    const { call, send } = await signedIn();
    const before: any = await (await call("/os")).json();
    expect(before.os.built).toBe(false);
    expect(before.guardrails.join(" ")).toMatch(/Never moves money/);
    const { os: start }: any = await (await call("/os/packs/trades")).json();
    const saved: any = await (await send("PUT", "/os", start)).json();
    expect(saved.os).toMatchObject({ built: true, version: 1, pack: "trades" });
    // Payroll is outsourced in the trades pack: it's in the OS, but not run here.
    expect(saved.os.modules.find((m: any) => m.key === "payroll")).toMatchObject({ mode: "outsourced" });

    const next = { ...saved.os, modules: saved.os.modules.filter((m: any) => m.key !== "fleet-and-vehicles"), version: 1 };
    expect((await send("PUT", "/os", next)).status).toBe(200);
    expect((await send("PUT", "/os", next)).status).toBe(409); // stale: version 1 was already replaced

    const log: any = await (await call("/os/changes")).json();
    expect(log.changes.map((c: any) => c.version)).toEqual([2, 1]);
    expect(log.changes[0].summary).toMatch(/removed Fleet/);
    const back: any = await (await send("POST", "/os/restore", { version: 1 })).json();
    expect(back.os.version).toBe(3);
    expect(back.os.modules.some((m: any) => m.key === "fleet-and-vehicles")).toBe(true);

    const cat: any = await (await call("/os/catalogue")).json();
    expect(cat.built).toBe(true);
    expect(cat.modules.find((m: any) => m.key === "payroll").mode).toBe("outsourced");
    expect(cat.modules.find((m: any) => m.key === "online-shop").mode).toBe("off");
  });
  it("refuses unknown apps and features, and warns about missing dependencies", async () => {
    const { send } = await signedIn();
    expect((await send("PUT", "/os", { modules: [{ key: "time-machine", mode: "here", autonomy: "auto", features: [] }] })).status).toBe(400);
    expect((await send("PUT", "/os", { modules: [{ key: "payroll", mode: "here", autonomy: "auto", features: ["teleport"] }] })).status).toBe(400);
    const p: any = await (await send("POST", "/os/preview", { modules: [{ key: "credit-control", mode: "here", autonomy: "approve", features: [] }] })).json();
    expect(p.ok).toBe(true);
    expect(p.warnings[0]).toMatchObject({ module: "credit-control", needs: ["sales-invoicing"] });
  });
  it("complaints, employee relations and whistleblowing never run on their own", async () => {
    const { send } = await signedIn();
    const r = await send("PUT", "/os", { modules: [{ key: "complaints", mode: "here", autonomy: "auto", features: [] }] });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.message).toMatch(/a person always decides/);
    expect(moduleSetting({ modules: [{ key: "complaints", mode: "here", autonomy: "auto", features: [], position: 0 }] }, "complaints")!.autonomy).toBe("approve");
    const packs: any = await (await send("GET", "/os/packs", undefined)).json();
    expect(packs.packs.map((p: any) => p.key)).toContain("hospitality");
  });
  it("only an owner changes the OS; a manager can pause the AI Team", async () => {
    const { send } = await signedIn("manager");
    expect((await send("PUT", "/os", configFromPack("blank"))).status).toBe(403);
    const r: any = await (await send("POST", "/os/pause", { paused: true })).json();
    expect(r.os.ai_paused).toBe(true);
  });
  it("Studio adds fields to an app and builds new apps; layouts save per space", async () => {
    const { call, send } = await signedIn();
    expect((await send("POST", "/os/fields", { module: "projects-and-jobs", key: "site_postcode", label: "Site postcode", type: "text" })).status).toBe(201);
    expect((await send("POST", "/os/fields", { module: "projects-and-jobs", key: "owner", label: "Owner again", type: "text" })).status).toBe(409);
    expect((await send("POST", "/os/apps", { key: "kennels", name: "Kennels", kind: "asset", category: "workplace" })).status).toBe(201);
    expect((await send("POST", "/os/fields", { module: "kennels", key: "breed", label: "Breed", type: "text" })).status).toBe(201);
    const f: any = await (await call("/os/fields?module=projects-and-jobs")).json();
    expect(f.fields.map((x: any) => x.key)).toEqual(["site_postcode"]);
    const l: any = await (await call("/os/layout?space=phone")).json();
    expect(l.saved).toBe(false);
    const put: any = await (await send("PUT", "/os/layout?space=phone", { widgets: [{ id: "a", type: "needs-you", w: 1, h: 2 }], dock: ["sales-invoicing"] })).json();
    expect(put).toMatchObject({ saved: true, dock: ["sales-invoicing"] });
    expect((await send("PUT", "/os/layout", { widgets: [{ id: "a", type: "crypto-ticker", w: 1, h: 1 }], dock: [] })).status).toBe(400);
  });
});

describe("the OS limits the AI Team", () => {
  it("with no OS built, everything is available as before", () => {
    expect(toolAllowed(null, "list-invoices")).toBe(true);
    expect(templateAllowed(null, "outreach")).toBe(true);
    expect(moduleSetting(null, "payroll")).toBeUndefined();
  });
  it("tools and agents for apps that are off aren't offered", () => {
    const cfg = configFromPack("clinics");
    expect(toolAllowed(cfg, "list-invoices")).toBe(true);
    expect(toolAllowed(cfg, "save-lead")).toBe(true); // the CRM is in the clinics pack
    expect(toolAllowed(cfg, "business-profile")).toBe(true);
    expect(templateAllowed(cfg, "social")).toBe(false);
    expect(templateAllowed(cfg, "bookings")).toBe(true);
    expect(toolAllowed({ modules: [] }, "list-inbox")).toBe(false);
  });
  it("the stricter of the agent's and the app's autonomy wins, and a pause holds everything", () => {
    expect(effectiveAutonomy("auto", "auto")).toBe("auto");
    expect(effectiveAutonomy("auto", "approve")).toBe("approve_all");
    expect(effectiveAutonomy("approve_all", "auto")).toBe("approve_all");
    expect(effectiveAutonomy("auto", "auto", true)).toBe("approve_all");
  });
  it("an OS agent can't read an app that's off, write to one kept elsewhere, or save where it may only suggest", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO agent (id, org_id, template, name, brief, settings, rhythm, created_at) VALUES ('agt_os', ?, 'os', 'Payables agent', 'b', ?, 'on_demand', ?)").run(org.id, JSON.stringify({ role: "Payables agent" }), new Date().toISOString());
    const ctx = { env, orgId: org.id, agentId: "agt_os", runId: "run_t" };
    const save = (await getTool(env, "os-save", { business: true }))!;
    const list = (await getTool(env, "os-records", { business: true }))!;
    const mods = (bp: string, sp: string) => [{ key: "bills-and-payables", mode: bp, autonomy: "approve", features: [], position: 0 }, { key: "supplier-payments", mode: sp, autonomy: sp === "here" ? "suggest" : "approve", features: [], position: 1 }] as any;
    await saveOs(env, org.id, { modules: mods("external", "here") }, "owner");
    expect(JSON.stringify(await runTool(ctx, save, { module: "bills-and-payables", title: "Rent" }).catch((e) => e))).toMatch(/app_external|other system/);
    expect(JSON.stringify(await runTool(ctx, save, { module: "supplier-payments", title: "Pay Acme" }).catch((e) => e))).toMatch(/suggest_only|Suggest/);
    expect(JSON.stringify(await runTool(ctx, list, { module: "bills-and-payables" }))).not.toMatch(/app_off/);
    await saveOs(env, org.id, { modules: mods("off", "here"), version: 1 }, "owner");
    expect(JSON.stringify(await runTool(ctx, list, { module: "bills-and-payables" }).catch((e) => e))).toMatch(/app_off|isn't in this business/);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM os_record").get()).toEqual({ n: 0 });
  });
  it("an email that would go on its own is held when the app is set to approve, or the team is paused", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    seedAgent(raw, org.id, { autonomy: "auto" });
    raw.prepare("INSERT INTO lead (id, org_id, company, email, created_at) VALUES ('lead_1', ?, 'Acme', 'hi@acme.example', ?)").run(org.id, new Date(Date.now() - 864e5).toISOString());
    const ctx = { orgId: org.id, agentId: "agt_1" };
    const mail = { to: "hi@acme.example", subject: "Hello", body: "A short note.", lead_id: "lead_1" };
    expect((await proposeEmail(env, ctx, mail)).status).not.toBe("waiting_for_approval"); // no OS: as before
    await saveOs(env, org.id, { modules: [{ key: "outreach-and-follow-up", mode: "here", autonomy: "approve", features: [], position: 0 }, { key: "pipeline-and-crm", mode: "here", autonomy: "approve", features: [], position: 1 }] }, "owner");
    expect(await proposeEmail(env, ctx, { ...mail, subject: "Again" })).toMatchObject({ status: "waiting_for_approval", note: expect.stringMatching(/Your OS/) });
    await saveOs(env, org.id, { modules: [{ key: "outreach-and-follow-up", mode: "here", autonomy: "auto", features: [], position: 0 }], ai_paused: true, version: 1 }, "owner");
    expect(await proposeEmail(env, ctx, { ...mail, subject: "Third" })).toMatchObject({ status: "waiting_for_approval", note: expect.stringMatching(/paused/) });
  });
  it("a handover to an outsourced provider is drafted, never sent on its own", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO agent (id, org_id, template, name, brief, settings, autonomy, rhythm, created_at) VALUES ('agt_pay', ?, 'os', 'Payroll preparer', 'b', ?, 'auto', 'on_demand', ?)").run(org.id, JSON.stringify({ role: "Payroll preparer" }), new Date().toISOString());
    await saveOs(env, org.id, { modules: [{ key: "payroll", mode: "outsourced", autonomy: "auto", features: [], position: 0, provider: { name: "Bureau Ltd", email: "payroll@bureau.example" } }] }, "owner");
    const tool = (await getTool(env, "prepare-handover", { business: true }))!;
    const r: any = await runTool({ env, orgId: org.id, agentId: "agt_pay", runId: "run_h" }, tool, { module: "payroll", subject: "October payroll", body: "Two starters, one leaver." });
    expect(JSON.stringify(r)).toContain("waiting_for_approval");
    expect(raw.prepare("SELECT status FROM agent_action").all()).toEqual([{ status: "proposed" }]);
  });
  it("hiring an agent brings the app it works in, so its first run isn't refused (issue #1)", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    await saveOs(env, org.id, configFromPack("trades"), org.user); // no outreach or lead generation in Trades
    expect(templateAllowed(await loadOs(env, org.id), "outreach")).toBe(false);
    await hireAgent(env, org.id, org.user, { template: "outreach" });
    const os = (await loadOs(env, org.id))!;
    expect(templateAllowed(os, "outreach")).toBe(true);
    expect(os.modules.find((m) => m.key === "outreach-and-follow-up")).toMatchObject({ mode: "here", autonomy: "approve" });
    expect((await changes(env, org.id))[0].summary).toBe("added Sequences");
    // Hiring another agent whose app is already here changes nothing.
    await hireAgent(env, org.id, org.user, { template: "inbox" });
    expect((await loadOs(env, org.id))!.version).toBe(os.version);
  });
  it("an app the owner turned off isn't switched back on by a hire: the hire is refused", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const cfg = configFromPack("agencies");
    for (const m of cfg.modules) if (m.key === "outreach-and-follow-up" || m.key === "lead-generation") m.mode = m.key === "lead-generation" ? "off" : "external";
    await saveOs(env, org.id, cfg, org.user);
    await expect(hireAgent(env, org.id, org.user, { template: "outreach" })).rejects.toMatchObject({ status: 409, code: "needs_apps" });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM agent").get()).toEqual({ n: 0 });
    expect((await loadOs(env, org.id))!.version).toBe(1);
  });
  it("with no OS built, a hire leaves the OS alone", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    await hireAgent(env, org.id, org.user, { template: "outreach" });
    expect(await loadOs(env, org.id)).toBeNull();
  });
  it("no tool lets an agent move money or delete a record", async () => {
    const { env } = testEnv();
    for (const s of ["pay", "make-payment", "refund", "delete-record", "os-delete"]) expect(await getTool(env, s, { business: true })).toBeNull();
  });
});
