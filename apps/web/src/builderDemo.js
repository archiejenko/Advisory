// The OS Builder in the demo workspace: the saved OS, packs, preview, pause, history, Studio and layouts,
// answered from memory with the same shapes as /api/ws/os. Nothing is saved beyond this tab.
import { facet } from "../../../packages/core/os.ts";
import { PACKS, LIBRARY, GUARDRAILS, featuresOf, configFromPack, validateConfig, estimate, moduleSetting, THEMES } from "../../../packages/core/osconfig.ts";

const WIDGETS = ["needs-you", "status", "money", "pipeline", "today", "team", "module", "activity", "ask", "cash"];
const DEFAULT_LAYOUT = {
  desktop: { widgets: [{ id: "w1", type: "money", w: 2, h: 1 }, { id: "w2", type: "pipeline", w: 1, h: 1 }, { id: "w3", type: "today", w: 1, h: 1 }, { id: "w4", type: "team", w: 2, h: 1 }, { id: "w5", type: "activity", w: 2, h: 1 }], dock: [] },
  phone: { widgets: [{ id: "p1", type: "money", w: 1, h: 1 }, { id: "p2", type: "today", w: 1, h: 1 }, { id: "p3", type: "team", w: 1, h: 1 }], dock: [] },
};

/** The demo business (a cleaning company) starts with an OS already built from the trades pack, payroll outsourced. */
function seed() {
  const cfg = configFromPack("trades");
  // Brightwork also keeps these, so every demo record has its app.
  for (const k of ["goals-and-objectives", "budgets-and-planning", "risk-register", "contracts-and-e-signature", "complaints", "rota-and-shifts", "purchasing-and-orders", "bills-and-payables", "recruitment", "employee-records", "absence-and-holiday", "insurance", "devices-and-software", "training", "cash-flow-forecasting", "lead-generation", "outreach-and-follow-up"]) {
    if (!cfg.modules.some((m) => m.key === k)) cfg.modules.push({ key: k, mode: "here", features: featuresOf(k).filter((x) => x.default).map((x) => x.key), autonomy: "approve", position: cfg.modules.length });
  }
  const cc = cfg.modules.find((m) => m.key === "credit-control"); if (cc) cc.autonomy = "approve";
  const pay = cfg.modules.find((m) => m.key === "payroll"); if (pay) pay.provider = { name: "Moss Payroll Bureau", email: "payroll@mossbureau.example" };
  const now = new Date().toISOString();
  return { cfg: { ...cfg, version: 1 }, built: true, changes: [{ version: 1, by_user: "dana@brightwork.example", summary: `Built the OS with ${cfg.modules.filter((m) => m.mode === "here").length} apps`, at: now, snapshot: JSON.parse(JSON.stringify(cfg)) }], fields: [], apps: [], layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) };
}

export function osbState(s) { if (!s.osb) s.osb = seed(); return s.osb; }
export function demoOs(s) { const o = osbState(s); return o.built ? o.cfg : null; }

function summary(prev, next) {
  if (!prev) return `Built the OS with ${next.modules.filter((m) => m.mode === "here").length} apps`;
  const out = []; const before = new Map(prev.modules.map((m) => [m.key, m]));
  for (const m of next.modules) {
    const p = before.get(m.key), n = facet(m.key)?.app || m.key;
    if (!p) out.push(`added ${n}`); else if (p.mode !== m.mode) out.push(`${n}: ${p.mode} → ${m.mode}`); else if (p.autonomy !== m.autonomy) out.push(`${n} autonomy: ${p.autonomy} → ${m.autonomy}`); else if (JSON.stringify(p.features) !== JSON.stringify(m.features)) out.push(`${n} features changed`);
    before.delete(m.key);
  }
  for (const k of before.keys()) out.push(`removed ${facet(k)?.app || k}`);
  if (prev.ai_paused !== next.ai_paused) out.push(next.ai_paused ? "paused the AI Team" : "resumed the AI Team");
  if (prev.theme !== next.theme) out.push(`theme ${next.theme}`);
  return out.slice(0, 8).join("; ") || "No changes";
}

export function builderDemo(method, p, q, body, s, fail, me) {
  if (!p.startsWith("/os")) return undefined;
  const o = osbState(s);
  const owner = () => { if (me?.role && me.role !== "owner") fail(403, "Only the owner can change the OS."); };
  const save = (input) => {
    const modules = (input.modules || []).map((m, i) => ({ ...m, position: m.position ?? i, features: [...new Set(m.features || [])] }));
    const check = validateConfig({ modules });
    if (!check.ok) fail(400, check.errors.map((e) => e.detail).slice(0, 3).join(" "));
    if (o.built && input.version !== undefined && input.version !== o.cfg.version) fail(409, "Someone else changed the OS since you opened it. Reload to see their changes.");
    const prev = o.built ? o.cfg : null;
    const theme = THEMES.some((t) => t.key === input.theme) ? input.theme : prev?.theme || "dark";
    const cfg = { pack: input.pack || prev?.pack || "blank", theme, ai_paused: input.ai_paused ?? prev?.ai_paused ?? false, modules, version: (prev?.version || 0) + 1 };
    o.changes.unshift({ version: cfg.version, by_user: me?.user?.email || "dana@brightwork.example", summary: summary(prev, cfg), at: new Date().toISOString(), snapshot: JSON.parse(JSON.stringify(cfg)) });
    o.cfg = cfg; o.built = true;
    return { ...cfg, built: true, updated_at: new Date().toISOString(), warnings: check.warnings };
  };

  if (p === "/os" && method === "GET") return { os: o.built ? { ...o.cfg, built: true } : { ...configFromPack("blank"), built: false, version: 0 }, guardrails: GUARDRAILS };
  if (p === "/os" && method === "PUT") { owner(); return { os: save(body || {}) }; }
  if (p === "/os/library" && method === "GET") return { categories: LIBRARY, packs: PACKS.map((x) => ({ key: x.key, name: x.name, blurb: x.blurb, apps: x.here.length })) };
  if (p === "/os/packs" && method === "GET") return { packs: PACKS.map((x) => ({ key: x.key, name: x.name, blurb: x.blurb, os: configFromPack(x.key) })) };
  let r = p.match(/^\/os\/packs\/([a-z-]+)$/);
  if (r && method === "GET") { const x = PACKS.find((y) => y.key === r[1]) || fail(404, "Pack not found."); return { pack: { key: x.key, name: x.name, blurb: x.blurb }, os: configFromPack(x.key) }; }
  if (p === "/os/preview" && method === "POST") { const c = validateConfig({ modules: body?.modules || [] }); return { ...c, estimate: estimate({ modules: body?.modules || [] }, body?.people) }; }
  if (p === "/os/pause" && method === "POST") return { os: save({ ...(o.built ? o.cfg : configFromPack("blank")), ai_paused: !!body?.paused, version: o.built ? o.cfg.version : undefined }) };
  if (p === "/os/changes" && method === "GET") return { changes: o.changes.map(({ snapshot, ...c }) => c) };
  if (p === "/os/restore" && method === "POST") { owner(); const c = o.changes.find((x) => x.version === body?.version) || fail(404, "That version of the OS isn't in the history."); return { os: save({ ...c.snapshot, version: o.cfg.version }) }; }
  if (p === "/os/fields") {
    if (method === "GET") return { fields: o.fields.filter((f) => !q.module || f.module === q.module) };
    if (method === "POST") {
      owner();
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(body?.key || "")) fail(400, "A field key is lower case letters, numbers and underscores.");
      if (o.fields.some((f) => f.module === body.module && f.key === body.key)) fail(409, `${body.key} is already a field on this app.`);
      const f = { id: "cf_demo" + (o.fields.length + 1), ...body }; o.fields.push(f); return { field: f };
    }
  }
  if ((r = p.match(/^\/os\/fields\/([^/]+)$/)) && method === "DELETE") { owner(); o.fields = o.fields.filter((f) => f.id !== r[1]); return { ok: true }; }
  if (p === "/os/apps") {
    if (method === "GET") return { apps: o.apps };
    if (method === "POST") { owner(); if (facet(body?.key) || o.apps.some((a) => a.key === body?.key)) fail(409, "You already have an app with that key."); const a = { id: "ca_demo" + (o.apps.length + 1), ...body }; o.apps.push(a); return { app: a }; }
  }
  if (p === "/os/layout") {
    const space = q.space === "phone" ? "phone" : "desktop";
    if (method === "GET") return { space, ...o.layout[space], saved: true };
    if (method === "PUT") {
      for (const w of body?.widgets || []) if (!WIDGETS.includes(w.type)) fail(400, `Unknown widget: ${w.type}.`);
      o.layout[space] = { widgets: (body?.widgets || []).slice(0, 24), dock: (body?.dock || []).slice(0, 16) };
      return { space, ...o.layout[space], saved: true };
    }
  }
  return undefined;
}

/** Adds each module's mode to the demo catalogue once an OS is built, as the API does. */
export function withModes(cat, s) {
  const cfg = demoOs(s);
  if (!cfg) return cat;
  return { ...cat, built: true, modules: cat.modules.map((m) => { const x = moduleSetting(cfg, m.key); return { ...m, mode: x.mode, autonomy: x.autonomy }; }) };
}
