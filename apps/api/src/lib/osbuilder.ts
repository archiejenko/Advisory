// The business's own OS, as saved by the OS Builder: which apps are here, outsourced, kept elsewhere or off,
// their features and autonomy, the theme, and the pause switch. A business with no saved OS keeps the earlier
// behaviour: every app available and each agent's own autonomy.
import { newId, nowIso } from "../../../../packages/core/util";
import { facet, KINDS, type Kind } from "../../../../packages/core/os";
import {
  validateConfig, configFromPack, pack as packOf, featuresOf, estimate, moduleSetting, THEMES,
  type OsConfig, type ModuleConfig, type Mode, type Autonomy, type Theme, type CustomField, type CustomApp,
} from "../../../../packages/core/osconfig";
import { type Env, one, all, run, audit } from "./db";
import { HttpError } from "./http";

export type SavedOs = OsConfig & { version: number; updated_at: string; built: true };

/** The saved OS, or null when the business hasn't built one yet. */
export async function loadOs(env: Env, orgId: string): Promise<SavedOs | null> {
  const o = await one<any>(env, "SELECT * FROM org_os WHERE org_id = ?", orgId);
  if (!o) return null;
  const rows = await all<any>(env, "SELECT * FROM org_module WHERE org_id = ? ORDER BY position, module_key", orgId);
  const modules: ModuleConfig[] = rows.map((r) => ({
    key: r.module_key, mode: r.mode as Mode, autonomy: r.autonomy as Autonomy, position: r.position,
    features: safe(r.features, [] as string[]), ...(r.provider && r.provider !== "{}" ? { provider: safe(r.provider, {}) } : {}),
  }));
  return { pack: o.pack, theme: o.theme as Theme, ai_paused: !!o.ai_paused, modules, version: o.version, updated_at: o.updated_at, built: true };
}
function safe<T>(s: string, d: T): T { try { return JSON.parse(s); } catch { return d; } }

/** A short, human summary of what changed between two configs, for the change log. */
export function diffSummary(prev: Pick<OsConfig, "modules" | "ai_paused" | "theme"> | null, next: Pick<OsConfig, "modules" | "ai_paused" | "theme">) {
  if (!prev) return `Built the OS with ${next.modules.filter((m) => m.mode === "here").length} apps`;
  const out: string[] = [];
  const before = new Map(prev.modules.map((m) => [m.key, m]));
  for (const m of next.modules) {
    const p = before.get(m.key), name = facet(m.key)?.app || m.key;
    if (!p) out.push(`added ${name}`);
    else if (p.mode !== m.mode) out.push(`${name}: ${p.mode} → ${m.mode}`);
    else if (p.autonomy !== m.autonomy) out.push(`${name} autonomy: ${p.autonomy} → ${m.autonomy}`);
    else if (JSON.stringify(p.features) !== JSON.stringify(m.features)) out.push(`${name} features changed`);
    before.delete(m.key);
  }
  for (const k of before.keys()) out.push(`removed ${facet(k)?.app || k}`);
  if (prev.ai_paused !== next.ai_paused) out.push(next.ai_paused ? "paused the AI Team" : "resumed the AI Team");
  if (prev.theme !== next.theme) out.push(`theme ${next.theme}`);
  return out.length ? out.slice(0, 8).join("; ") + (out.length > 8 ? ` and ${out.length - 8} more` : "") : "No changes";
}

/** Save the whole OS. Checks it first; refuses a stale version so two people editing don't overwrite each other. */
export async function saveOs(env: Env, orgId: string, input: { pack?: string; theme?: string; ai_paused?: boolean; modules: ModuleConfig[]; version?: number }, by: string) {
  const prev = await loadOs(env, orgId);
  if (prev && input.version !== undefined && input.version !== prev.version) throw new HttpError(409, "stale", "Someone else changed the OS since you opened it. Reload to see their changes.");
  const theme = (input.theme || prev?.theme || "dark") as Theme;
  if (!THEMES.some((t) => t.key === theme)) throw new HttpError(400, "invalid_request", "Unknown theme.");
  const modules = input.modules.map((m, i) => ({ ...m, position: m.position ?? i, features: [...new Set(m.features || [])] }));
  const check = validateConfig({ modules });
  if (!check.ok) throw new HttpError(400, "invalid_os", check.errors.map((e) => e.detail).slice(0, 5).join(" "));
  const cfg = { pack: input.pack && packOf(input.pack) ? input.pack : prev?.pack || "blank", theme, ai_paused: input.ai_paused ?? prev?.ai_paused ?? false, modules };
  const version = (prev?.version || 0) + 1, at = nowIso();
  const stmts = [
    env.DB.prepare("INSERT INTO org_os (org_id, pack, theme, version, ai_paused, updated_by, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET pack = excluded.pack, theme = excluded.theme, version = excluded.version, ai_paused = excluded.ai_paused, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(orgId, cfg.pack, cfg.theme, version, cfg.ai_paused ? 1 : 0, by, at),
    env.DB.prepare("DELETE FROM org_module WHERE org_id = ?").bind(orgId),
    ...modules.map((m) => env.DB.prepare("INSERT INTO org_module (org_id, module_key, mode, features, autonomy, provider, position) VALUES (?,?,?,?,?,?,?)")
      .bind(orgId, m.key, m.mode, JSON.stringify(m.features), m.autonomy, JSON.stringify(m.provider || {}), m.position)),
    env.DB.prepare("INSERT INTO os_change (id, org_id, version, by_user, summary, snapshot, at) VALUES (?,?,?,?,?,?,?)")
      .bind(newId("osc"), orgId, version, by, diffSummary(prev, cfg), JSON.stringify(cfg), at),
  ];
  await env.DB.batch(stmts);
  await audit(env, orgId, by, "os_saved", undefined, { version, apps: modules.filter((m) => m.mode === "here").length });
  return { ...(await loadOs(env, orgId))!, warnings: check.warnings };
}

export async function setPaused(env: Env, orgId: string, paused: boolean, by: string) {
  const prev = await loadOs(env, orgId);
  const cfg = prev || { ...configFromPack("blank"), modules: [] };
  return saveOs(env, orgId, { ...cfg, ai_paused: paused, version: prev?.version }, by);
}

export async function changes(env: Env, orgId: string) {
  return all<any>(env, "SELECT version, by_user, summary, at FROM os_change WHERE org_id = ? ORDER BY version DESC LIMIT 50", orgId);
}
/** Put the OS back as it was at an earlier version. Saved as a new version, so the undo can itself be undone. */
export async function restore(env: Env, orgId: string, version: number, by: string) {
  const c = await one<any>(env, "SELECT snapshot FROM os_change WHERE org_id = ? AND version = ?", orgId, version);
  if (!c) throw new HttpError(404, "not_found", "That version of the OS isn't in the history.");
  const snap = safe<OsConfig>(c.snapshot, null as any);
  const cur = await loadOs(env, orgId);
  return saveOs(env, orgId, { ...snap, version: cur?.version }, by);
}

/** The OS as an agent run sees it: the setting for a module (undefined = no OS built), and the pause switch. */
export async function osFor(env: Env, orgId: string) {
  const cfg = await loadOs(env, orgId);
  return { cfg, paused: !!cfg?.ai_paused, setting: (key: string) => moduleSetting(cfg, key) };
}

export function preview(input: { modules: ModuleConfig[] }, people?: number) {
  const check = validateConfig(input);
  return { ...check, estimate: estimate(input, people) };
}

/* ---------- Studio: custom fields and apps ---------- */
const KEY = /^[a-z][a-z0-9_]{1,39}$/;
export async function customFields(env: Env, orgId: string, module?: string) {
  const rows = module
    ? await all<any>(env, "SELECT * FROM custom_field WHERE org_id = ? AND module = ? ORDER BY created_at", orgId, module)
    : await all<any>(env, "SELECT * FROM custom_field WHERE org_id = ? ORDER BY module, created_at", orgId);
  return rows.map((r) => ({ id: r.id, module: r.module, key: r.key, label: r.label, type: r.type, options: safe(r.options, []) }));
}
export async function addCustomField(env: Env, orgId: string, f: CustomField, by: string) {
  const fc = facet(f.module);
  const app = fc ? null : await one<any>(env, "SELECT kind FROM custom_app WHERE org_id = ? AND key = ?", orgId, f.module);
  if (!fc && !app) throw new HttpError(404, "not_found", "There's no app by that name.");
  if (!KEY.test(f.key)) throw new HttpError(400, "invalid_request", "A field key is lower case letters, numbers and underscores.");
  const kind = (fc?.kind || app.kind) as Kind;
  if (KINDS[kind].fields.some((x) => x.key === f.key) || ["title", "status"].includes(f.key)) throw new HttpError(409, "exists", `${f.key} is already a field on this app.`);
  if ((await all(env, "SELECT id FROM custom_field WHERE org_id = ? AND module = ?", orgId, f.module)).length >= 40) throw new HttpError(409, "too_many", "An app can have 40 custom fields.");
  if (await one(env, "SELECT id FROM custom_field WHERE org_id = ? AND module = ? AND key = ?", orgId, f.module, f.key)) throw new HttpError(409, "exists", `${f.key} is already a field on this app.`);
  const id = newId("cf");
  await run(env, "INSERT INTO custom_field (id, org_id, module, key, label, type, options, created_at) VALUES (?,?,?,?,?,?,?,?)", id, orgId, f.module, f.key, f.label.slice(0, 60), f.type, JSON.stringify((f.options || []).slice(0, 30)), nowIso());
  await audit(env, orgId, by, "field_added", id, { module: f.module, key: f.key });
  return { id, ...f };
}
export async function removeCustomField(env: Env, orgId: string, id: string, by: string) {
  const r = await run(env, "DELETE FROM custom_field WHERE id = ? AND org_id = ?", id, orgId);
  if (!r.meta.changes) throw new HttpError(404, "not_found", "Field not found.");
  await audit(env, orgId, by, "field_removed", id);
}
export async function customApps(env: Env, orgId: string) {
  return (await all<any>(env, "SELECT * FROM custom_app WHERE org_id = ? ORDER BY created_at", orgId)).map((r) => ({ id: r.id, key: r.key, name: r.name, kind: r.kind, category: r.category, statuses: safe(r.statuses, []) }));
}
export async function addCustomApp(env: Env, orgId: string, a: CustomApp, by: string) {
  if (!KEY.test(a.key.replace(/-/g, "_"))) throw new HttpError(400, "invalid_request", "An app key is lower case letters, numbers and dashes.");
  if (facet(a.key)) throw new HttpError(409, "exists", "That's already an app in the library.");
  if (!KINDS[a.kind]) throw new HttpError(400, "invalid_request", "Unknown kind of record.");
  if ((await all(env, "SELECT id FROM custom_app WHERE org_id = ?", orgId)).length >= 30) throw new HttpError(409, "too_many", "A business can build 30 apps of its own.");
  if (await one(env, "SELECT id FROM custom_app WHERE org_id = ? AND key = ?", orgId, a.key)) throw new HttpError(409, "exists", "You already have an app with that key.");
  const id = newId("ca");
  await run(env, "INSERT INTO custom_app (id, org_id, key, name, kind, category, statuses, created_at) VALUES (?,?,?,?,?,?,?,?)", id, orgId, a.key, a.name.slice(0, 60), a.kind, a.category, JSON.stringify((a.statuses || []).slice(0, 12)), nowIso());
  await audit(env, orgId, by, "app_built", id, { key: a.key });
  return { id, ...a };
}

/* ---------- The home screen ---------- */
export type Widget = { id: string; type: string; w: number; h: number; module?: string };
export const WIDGET_TYPES = ["needs-you", "status", "money", "pipeline", "today", "team", "module", "activity", "ask", "cash"];
export const DEFAULT_LAYOUT = {
  desktop: { widgets: [{ id: "w1", type: "needs-you", w: 2, h: 2 }, { id: "w2", type: "status", w: 1, h: 1 }, { id: "w3", type: "money", w: 1, h: 1 }, { id: "w4", type: "today", w: 2, h: 1 }, { id: "w5", type: "pipeline", w: 1, h: 1 }, { id: "w6", type: "activity", w: 1, h: 2 }] as Widget[], dock: [] as string[] },
  phone: { widgets: [{ id: "p1", type: "needs-you", w: 1, h: 2 }, { id: "p2", type: "status", w: 1, h: 1 }, { id: "p3", type: "today", w: 1, h: 1 }] as Widget[], dock: [] as string[] },
};
export async function getLayout(env: Env, orgId: string, space: "desktop" | "phone") {
  const r = await one<any>(env, "SELECT widgets, dock, updated_at FROM org_layout WHERE org_id = ? AND space = ?", orgId, space);
  if (!r) return { space, ...DEFAULT_LAYOUT[space], saved: false };
  return { space, widgets: safe(r.widgets, DEFAULT_LAYOUT[space].widgets), dock: safe(r.dock, []), saved: true, updated_at: r.updated_at };
}
export async function putLayout(env: Env, orgId: string, space: "desktop" | "phone", l: { widgets: Widget[]; dock: string[] }) {
  for (const w of l.widgets) if (!WIDGET_TYPES.includes(w.type)) throw new HttpError(400, "invalid_request", `Unknown widget: ${w.type}.`);
  await run(env, "INSERT INTO org_layout (org_id, space, widgets, dock, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(org_id, space) DO UPDATE SET widgets = excluded.widgets, dock = excluded.dock, updated_at = excluded.updated_at",
    orgId, space, JSON.stringify(l.widgets.slice(0, 24)), JSON.stringify(l.dock.slice(0, 16)), nowIso());
  return getLayout(env, orgId, space);
}

export { featuresOf };
