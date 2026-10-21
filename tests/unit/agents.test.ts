import { describe, it, expect } from "vitest";
import { nextRunAt } from "../../apps/api/src/lib/agents";
import { allowedUrl } from "../../apps/api/src/lib/web";
import { TEMPLATES, template } from "../../packages/core/templates";

describe("agent schedule (UK time)", () => {
  it("weekdays skips the weekend and runs at the hour in London", () => {
    // Friday 23 October 2026, 10:00 UTC (11:00 BST): next is Monday 26 October 08:00 GMT (clocks change on the 25th)
    expect(nextRunAt("weekdays", 8, new Date("2026-10-23T10:00:00Z"))).toBe("2026-10-26T08:00:00.000Z");
    // In summer time, 08:00 London is 07:00 UTC
    expect(nextRunAt("daily", 8, new Date("2026-07-01T06:00:00Z"))).toBe("2026-07-01T07:00:00.000Z");
  });
  it("weekly is Monday; monthly is the first working day", () => {
    expect(new Date(nextRunAt("weekly", 7, new Date("2026-10-21T12:00:00Z"))!).getUTCDay()).toBe(1);
    expect(nextRunAt("monthly", 8, new Date("2026-10-21T12:00:00Z"))).toBe("2026-11-02T08:00:00.000Z"); // 1 Nov 2026 is a Sunday
  });
  it("on-demand and event agents have no schedule", () => {
    expect(nextRunAt("on_demand", 8)).toBeNull();
    expect(nextRunAt("on_event", 8)).toBeNull();
  });
});

describe("reading pages safely", () => {
  const prod = { ALLOW_HTTP_FETCH: "false" } as any;
  it("refuses http and private addresses in production", () => {
    for (const u of ["http://example.com", "https://localhost/x", "https://127.0.0.1/", "https://10.0.0.5/", "https://192.168.1.1/", "https://169.254.169.254/latest", "ftp://x.example", "not a url"]) {
      expect(() => allowedUrl(prod, u)).toThrow();
    }
    expect(allowedUrl(prod, "https://www.example.co.uk/contact").hostname).toBe("www.example.co.uk");
  });
});

describe("agent catalogue", () => {
  it("every live LLM agent has standing orders and tools; next agents have none", () => {
    for (const t of TEMPLATES) {
      if (t.status === "live" && t.engine === "llm") { expect(t.instructions?.length).toBeGreaterThan(50); expect(t.tools.length).toBeGreaterThan(0); }
      if (t.status === "next") expect(t.tools.length).toBe(0);
    }
    expect(TEMPLATES.filter((t) => t.status === "live").length).toBe(8);
  });
  it("outreach never sends without propose-email, and fills its brief from the profile", () => {
    const o = template("outreach")!;
    expect(o.tools).toContain("propose-email");
    expect(o.instructions).toMatch(/Never guess or construct an email address/);
    expect(o.brief({ name: "Brightwork", customers: "law firms", area: "Manchester" })).toBe("Find law firms in Manchester. Introduce Brightwork. Tone: friendly, plain and brief.");
  });
});
