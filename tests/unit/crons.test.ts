// The crons in wrangler.toml are the ones the Worker handles and /api/health watches, and the deploy's cron check
// (scripts/check-crons.mjs) compares the live Worker against the same list.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CRON_EVERY_MIN } from "../../apps/api/src/lib/jobs";

describe("crons", () => {
  it("wrangler.toml declares exactly the crons the Worker handles", () => {
    const toml = readFileSync("wrangler.toml", "utf8");
    const list = toml.match(/^\[triggers\][^[]*?^crons\s*=\s*\[([^\]]*)\]/ms)?.[1] ?? "";
    const declared = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(declared).toEqual(Object.keys(CRON_EVERY_MIN).sort());
  });
});
