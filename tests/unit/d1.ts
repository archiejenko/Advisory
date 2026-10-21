// A D1-shaped database over Node's built-in SQLite, with every migration applied, so unit tests can run
// the real SQL (atomic inserts, RETURNING, json_extract) without wrangler. Plus fakes for R2 and Queues.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

export function testDb() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  const clean = (a: any[]) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v));
  const prepare = (sql: string) => {
    let args: any[] = [];
    const st: any = {
      bind: (...a: any[]) => { args = clean(a); return st; },
      first: async () => (db.prepare(sql).get(...args) as any) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => {
        const s = db.prepare(sql);
        if (/\bRETURNING\b/i.test(sql)) { const rows = s.all(...args); return { results: rows, meta: { changes: rows.length } }; }
        const r = s.run(...args);
        return { meta: { changes: Number(r.changes) } };
      },
    };
    return st;
  };
  const batch = async (stmts: any[]) => {
    db.exec("BEGIN");
    try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { raw: db, DB: { prepare, batch } as any };
}

export function fakeR2() {
  const store = new Map<string, string>();
  return {
    store,
    put: async (k: string, v: any) => { store.set(k, typeof v === "string" ? v : "bin"); },
    get: async (k: string) => (store.has(k) ? { json: async () => JSON.parse(store.get(k)!), text: async () => store.get(k)!, body: store.get(k) } : null),
    head: async (k: string) => (store.has(k) ? {} : null),
    delete: async (k: string | string[]) => { for (const x of [k].flat()) store.delete(x); },
    list: async ({ prefix = "" }: { prefix?: string } = {}) => ({ objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  };
}

export function fakeQueue() {
  const sent: any[] = [];
  return { sent, send: async (b: any) => { sent.push(b); }, sendBatch: async (msgs: { body: any }[]) => { for (const m of msgs) sent.push(m.body); } };
}

/** An Env with a fresh database, R2 and queues, local mail, and the given vars. */
export function testEnv(vars: Record<string, string> = {}) {
  const { raw, DB } = testDb();
  return { raw, env: { DB, FILES: fakeR2(), JOBS: fakeQueue(), AGENT_JOBS: fakeQueue(), CACHE: { get: async () => null, put: async () => {} }, MAIL_MODE: "outbox", APP_URL: "https://ah.test/", ...vars } as any };
}

const now = () => new Date().toISOString();
/** A business with an owner, ready for agents. */
export function seedOrg(raw: DatabaseSync, o: { id?: string; plan?: string; created_at?: string; email?: string } = {}) {
  const id = o.id || "org_a", email = o.email || `owner@${id}.test`, user = "usr_" + id;
  raw.prepare("INSERT INTO org (id, name, plan, inbox_alias, created_at) VALUES (?,?,?,?,?)").run(id, "Brightwork " + id, o.plan || "growth", id + "-in", o.created_at || now());
  raw.prepare("INSERT INTO user (id, email, created_at) VALUES (?,?,?)").run(user, email, now());
  raw.prepare("INSERT INTO membership (org_id, user_id, role) VALUES (?,?,'owner')").run(id, user);
  raw.prepare("INSERT INTO subscription (org_id, status, founding, updated_at) VALUES (?, 'active', 1, ?)").run(id, now());
  return { id, user, email };
}
export function seedAgent(raw: DatabaseSync, orgId: string, o: { id?: string; template?: string; autonomy?: string; cap?: number } = {}) {
  const id = o.id || "agt_1";
  raw.prepare("INSERT INTO agent (id, org_id, template, name, brief, autonomy, monthly_cap, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, orgId, o.template || "outreach", "Outreach", "Find customers.", o.autonomy || "auto", o.cap ?? 300, now());
  return id;
}
