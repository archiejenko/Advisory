// Thin D1 helpers. Workspace code never builds its own org filter: it goes through `Scoped`.
import { nowIso, newId } from "../../../../packages/core/util";

export type Env = Record<string, any> & {
  DB: D1Database; FILES: R2Bucket; CACHE: KVNamespace; JOBS: Queue<any>; ASSETS?: Fetcher;
};

export async function one<T = any>(env: Env, sql: string, ...args: any[]): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...args).first<T>()) ?? null;
}
export async function all<T = any>(env: Env, sql: string, ...args: any[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...args).all<T>()).results || [];
}
export async function run(env: Env, sql: string, ...args: any[]) {
  return env.DB.prepare(sql).bind(...args).run();
}

export async function audit(env: Env, orgId: string | null, actor: string | null, action: string, target?: string, detail?: unknown) {
  await run(env, "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?,?,?,?,?,?,?)",
    newId("aud"), orgId, actor, action, target ?? null, detail === undefined ? null : JSON.stringify(detail), nowIso());
}

/**
 * Every workspace read and write goes through here. The org id comes from the session,
 * and each statement must contain the literal `org_id = ?1` (or insert org_id first as ?1) so the first bind is always the org.
 */
export class Scoped {
  constructor(private env: Env, readonly orgId: string) {}
  private check(sql: string) {
    const ownOrgRow = /\b(FROM|UPDATE)\s+org\b/i.test(sql) && /\bid\s*=\s*\?1\b/.test(sql);
    // An insert is scoped when org_id is its first column and ?1 its first value.
    const scopedInsert = /^\s*INSERT\s+(OR\s+\w+\s+)?INTO\s+\w+\s*\(\s*org_id\s*,[^)]*\)\s*VALUES\s*\(\s*\?1\s*[,)]/i.test(sql);
    if (!ownOrgRow && !scopedInsert && !/org_id\s*=\s*\?1\b/.test(sql)) throw new Error("Scoped query without org filter: " + sql.slice(0, 60));
  }
  one<T = any>(sql: string, ...args: any[]) { this.check(sql); return one<T>(this.env, sql, this.orgId, ...args); }
  all<T = any>(sql: string, ...args: any[]) { this.check(sql); return all<T>(this.env, sql, this.orgId, ...args); }
  run(sql: string, ...args: any[]) { this.check(sql); return run(this.env, sql, this.orgId, ...args); }
}
