import { describe, it, expect } from "vitest";
import { Scoped } from "../../apps/api/src/lib/db";

// A fake D1 that records statements, to prove the guard rejects unscoped SQL before it runs.
function fakeEnv() {
  const seen: { sql: string; args: any[] }[] = [];
  const stmt = (sql: string) => ({ bind: (...args: any[]) => ({ first: async () => (seen.push({ sql, args }), null), all: async () => (seen.push({ sql, args }), { results: [] }), run: async () => (seen.push({ sql, args }), { meta: { changes: 0 } }) }) });
  return { env: { DB: { prepare: stmt } } as any, seen };
}

describe("tenant isolation guard", () => {
  it("binds the session's org as the first parameter", async () => {
    const { env, seen } = fakeEnv();
    await new Scoped(env, "org_a").all("SELECT * FROM client WHERE org_id = ?1 AND number = ?2", "123");
    expect(seen[0].args).toEqual(["org_a", "123"]);
  });
  it("refuses any query without the org filter", () => {
    const { env } = fakeEnv();
    expect(() => new Scoped(env, "org_a").all("SELECT * FROM client WHERE number = ?1", "123")).toThrow(/without org filter/);
    expect(() => new Scoped(env, "org_a").run("DELETE FROM alert")).toThrow(/without org filter/);
  });
  it("allows inserts only when org_id is the first column bound to ?1", async () => {
    const { env, seen } = fakeEnv();
    await new Scoped(env, "org_a").run("INSERT INTO membership (org_id, user_id, role) VALUES (?1, ?2, ?3)", "usr_1", "viewer");
    expect(seen[0].args).toEqual(["org_a", "usr_1", "viewer"]);
    expect(() => new Scoped(env, "org_a").run("INSERT INTO membership (user_id, org_id, role) VALUES (?1, ?2, ?3)", "x", "y")).toThrow(/without org filter/);
    expect(() => new Scoped(env, "org_a").run("INSERT INTO membership (org_id, user_id) VALUES (?2, ?1)", "x")).toThrow(/without org filter/);
  });
});
