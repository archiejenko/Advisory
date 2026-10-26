// monthly_cap (a team-wide limit on swarms and agents) was never enforced: credits and per-agent budgets are.
// No screen, signed in or out, and no API response may show it, so nothing in the app source may read it.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f.startsWith("dist") || f === "migrations" ? [] : files(p);
    return /\.(jsx?|tsx?|mjs|css|html)$/.test(f) ? [p] : [];
  });
}

describe("monthly_cap", () => {
  it("isn't read, returned or rendered anywhere in the app", () => {
    const hits = ["apps/web/src", "apps/api/src", "packages"].flatMap(files)
      .filter((p) => /monthly[_ ]cap|monthlyCap|team cap/i.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });
});
