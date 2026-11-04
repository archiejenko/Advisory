// Contact rules: the same function the API runs before an agent's draft reaches the approvals queue, and the
// workspace runs as someone logs a touch. Every rule, the verdict order, overrides, breaches and the agent hold path.
import { describe, it, expect } from "vitest";
import { evaluate, check, resolve, classifyLogged, DEFAULT_RULES, type CTouch, type CAccount, type ContactRules, type Who } from "../../packages/core/contact";

const H = 3600e3, D = 24 * H;
const NOW = Date.UTC(2026, 10, 4, 12, 0);
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const dana: Who = { kind: "person", id: "p_dana" };
const sam: Who = { kind: "person", id: "p_sam" };
const theo: Who = { kind: "agent", id: "agt_cs" };
const maya: Who = { kind: "agent", id: "agt_sales" };
const acc = (o: Partial<CAccount> = {}): CAccount => ({ owner: dana, handoffTo: [], dnc: null, ...o });
const out = (msAgo: number, actor: Who, o: Partial<CTouch> = {}): CTouch => ({ at: at(msAgo), actor, direction: "out", channel: "email", thread: "t1", ...o });
const inn = (msAgo: number, o: Partial<CTouch> = {}): CTouch => ({ at: at(msAgo), actor: null, direction: "in", channel: "email", thread: "t1", ...o });
const rules = (patch: Partial<{ [K in keyof ContactRules]: Partial<ContactRules[K]> }> = {}): ContactRules =>
  Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, { ...v, ...((patch as any)[k] || {}) }])) as ContactRules;
const state = (e: ReturnType<typeof evaluate>, id: string) => e.rules.find((r) => r.id === id)!.state;
const send = (a: CAccount, xs: CTouch[], who: Who, o: { newThread?: boolean; contactId?: string; r?: ContactRules } = {}) =>
  check(a, xs, o.r || DEFAULT_RULES, NOW, { actor: who, channel: "email", newThread: o.newThread ?? false, contactId: o.contactId });

describe("R1 do not contact", () => {
  it("blocks every outbound for 180 days after a decline", () => {
    const xs = [inn(10 * D, { outcome: "declined" })];
    const e = evaluate(acc(), xs, DEFAULT_RULES, NOW);
    expect(e.verdict).toBe("dnc");
    expect(e.dueAt).toBe(at(10 * D - 180 * D));
    expect(send(acc(), xs, dana).ruleId).toBe("R1");
  });
  it("lifts the moment the period ends", () => {
    const xs = [inn(180 * D, { outcome: "declined" })];
    expect(state(evaluate(acc(), xs, DEFAULT_RULES, NOW), "R1")).toBe("pass");
    expect(state(evaluate(acc(), xs, DEFAULT_RULES, NOW - 1), "R1")).toBe("active");
  });
  it("uses the set date on an opt-out instead of N days", () => {
    const a = acc({ dnc: { since: at(300 * D), until: at(-5 * D) } });
    const e = evaluate(a, [], DEFAULT_RULES, NOW);
    expect(e.verdict).toBe("dnc");
    expect(e.dueAt).toBe(at(-5 * D));
    expect(evaluate(a, [], DEFAULT_RULES, NOW + 6 * D).verdict).toBe("clear");
  });
  it("an opt-out with no date lasts N days", () => {
    const a = acc({ dnc: { since: at(10 * D), until: null } });
    expect(evaluate(a, [], rules({ R1: { days: 30 } }), NOW).dueAt).toBe(at(10 * D - 30 * D));
    expect(evaluate(a, [], rules({ R1: { days: 5 } }), NOW).verdict).toBe("clear");
  });
  it("does nothing when switched off", () => {
    const xs = [inn(D, { outcome: "declined" })];
    expect(state(evaluate(acc(), xs, rules({ R1: { on: false } }), NOW), "R1")).toBe("off");
    expect(send(acc(), xs, dana, { r: rules({ R1: { on: false } }) }).decision).toBe("allow");
  });
});

describe("R2 quiet period", () => {
  it("stops anyone else for 48 hours after an outbound", () => {
    const xs = [out(2 * H, dana, { channel: "phone" })];
    expect(evaluate(acc(), xs, DEFAULT_RULES, NOW).verdict).toBe("quiet");
    expect(evaluate(acc(), xs, DEFAULT_RULES, NOW).dueAt).toBe(at(2 * H - 48 * H));
    const c = send(acc(), xs, theo);
    expect(c.decision).toBe("hold");
    expect(c.ruleId).toBe("R2");
  });
  it("lets the person who sent the last message follow up", () => expect(send(acc(), [out(2 * H, dana)], dana).decision).toBe("allow"));
  it("ends early when they reply", () => {
    const xs = [out(5 * H, dana), inn(H)];
    expect(send(acc(), xs, theo).broken).not.toContain("R2");
  });
  it("ends at exactly 48 hours", () => {
    expect(send(acc(), [out(48 * H, dana)], theo).decision).toBe("allow");
    expect(send(acc(), [out(48 * H - 1, dana)], theo).decision).toBe("hold");
  });
  it("can be shortened", () => expect(send(acc(), [out(5 * H, dana)], theo, { r: rules({ R2: { hours: 4 } }) }).decision).toBe("allow"));
});

describe("R3 owner starts threads", () => {
  it("holds an agent that isn't the owner starting a new conversation", () => {
    const c = send(acc(), [], maya, { newThread: true });
    expect(c.decision).toBe("hold");
    expect(c.ruleId).toBe("R3");
  });
  it("warns a person instead", () => expect(send(acc(), [], sam, { newThread: true }).decision).toBe("warn"));
  it("lets the owner, and anyone they hand to, start one", () => {
    expect(send(acc(), [], dana, { newThread: true }).decision).toBe("allow");
    expect(send(acc({ handoffTo: [maya] }), [], maya, { newThread: true }).decision).toBe("allow");
  });
  it("doesn't apply inside an existing thread", () => expect(send(acc(), [], maya, { newThread: false }).decision).toBe("allow"));
  it("doesn't apply with no owner or when switched off", () => {
    expect(send(acc({ owner: null }), [], maya, { newThread: true }).decision).toBe("allow");
    expect(send(acc(), [], maya, { newThread: true, r: rules({ R3: { on: false } }) }).decision).toBe("allow");
  });
});

describe("R4 confirm acceptances", () => {
  it("is due 4 hours after they accept, and fails after", () => {
    const xs = [out(D, maya), inn(3 * H, { outcome: "accepted" })];
    const e = evaluate(acc(), xs, DEFAULT_RULES, NOW);
    expect(e.verdict).toBe("confirm");
    expect(e.dueAt).toBe(at(3 * H - 4 * H));
    expect(state(e, "R4")).toBe("active");
    expect(state(evaluate(acc(), xs, DEFAULT_RULES, NOW + 2 * H), "R4")).toBe("fail");
  });
  it("is met by a reply on any channel, not just the one it came in on", () => {
    const xs = [inn(3 * H, { outcome: "accepted", channel: "whatsapp" }), out(H, dana, { channel: "phone" })];
    expect(state(evaluate(acc(), xs, DEFAULT_RULES, NOW), "R4")).toBe("pass");
  });
  it("never stops a send: sending is how it's met", () => expect(send(acc(), [inn(10 * H, { outcome: "accepted" })], dana).decision).toBe("allow"));
});

describe("R5 reply in time", () => {
  it("is due 24 hours after their message", () => {
    const e = evaluate(acc(), [out(3 * D, maya), inn(2 * H)], DEFAULT_RULES, NOW);
    expect(e.verdict).toBe("reply");
    expect(e.dueAt).toBe(at(2 * H - 24 * H));
    expect(state(evaluate(acc(), [inn(25 * H)], DEFAULT_RULES, NOW), "R5")).toBe("fail");
  });
  it("counts from the first unanswered message", () => expect(evaluate(acc(), [inn(10 * H), inn(2 * H)], DEFAULT_RULES, NOW).dueAt).toBe(at(10 * H - 24 * H)));
  it("ignores a message that needs no reply", () => expect(evaluate(acc(), [inn(2 * H, { quiet: true })], DEFAULT_RULES, NOW).verdict).toBe("clear"));
  it("is met by any reply", () => expect(state(evaluate(acc(), [inn(5 * H), out(H, dana)], DEFAULT_RULES, NOW), "R5")).toBe("pass"));
});

describe("R6 frequency cap", () => {
  const three = [out(6 * D, maya, { contactId: "c1" }), out(4 * D, maya, { contactId: "c1" }), out(3 * D, maya, { contactId: "c1" })];
  it("stops the fourth outbound to one contact in 7 days", () => {
    const c = send(acc(), three, maya, { contactId: "c1" });
    expect(c.decision).toBe("hold");
    expect(c.ruleId).toBe("R6");
    expect(evaluate(acc(), three, DEFAULT_RULES, NOW).verdict).toBe("capped");
  });
  it("resets as the oldest touch leaves the window", () => {
    expect(evaluate(acc(), three, DEFAULT_RULES, NOW).dueAt).toBe(at(6 * D - 7 * D));
    expect(check(acc(), three, DEFAULT_RULES, NOW + D + 1, { actor: maya, channel: "email", contactId: "c1", newThread: false }).decision).toBe("allow");
  });
  it("counts each contact on its own", () => expect(send(acc(), three, maya, { contactId: "c2" }).decision).toBe("allow"));
  it("counts the whole account when no contact is named", () => expect(send(acc(), three, maya).decision).toBe("hold"));
  it("can be raised", () => expect(send(acc(), three, maya, { contactId: "c1", r: rules({ R6: { max: 4 } }) }).decision).toBe("allow"));
});

describe("verdict priority: R1, then R4, R5, R2, R6", () => {
  // Fails all five at once: declined (R1), an acceptance unconfirmed (R4), a message unanswered (R5),
  // a quiet period (R2: the last touch is ours, but the acceptance and message came after an earlier outbound) and the cap (R6).
  const xs = [out(6 * D, maya), out(5 * D, maya), inn(4 * D, { outcome: "accepted" }), inn(3 * D), out(2 * D, maya, { thread: "t2" }), inn(2 * D - H, { outcome: "declined", quiet: true })];
  const all = (r: ContactRules, xs2: CTouch[], a: CAccount = acc()) => evaluate(a, xs2, r, NOW).verdict;
  it("R1 wins over everything", () => expect(all(DEFAULT_RULES, xs)).toBe("dnc"));
  it("then R4", () => {
    const x = [out(3 * D, maya), out(2 * D, maya), inn(30 * H, { outcome: "accepted" }), inn(20 * H)];
    expect(all(DEFAULT_RULES, x)).toBe("confirm");
    expect(all(rules({ R4: { on: false } }), x)).toBe("reply");
  });
  it("then R5 over R2", () => {
    const x = [out(5 * D, dana), inn(30 * H)];
    expect(all(DEFAULT_RULES, x)).toBe("reply");
  });
  it("then R2 over R6", () => {
    const x = [out(5 * D, maya), out(4 * D, maya), out(H, maya)];
    expect(all(DEFAULT_RULES, x)).toBe("quiet");
    expect(all(rules({ R2: { on: false } }), x)).toBe("capped");
  });
  it("and clear when every rule is off", () => {
    const off = rules({ R1: { on: false }, R2: { on: false }, R3: { on: false }, R4: { on: false }, R5: { on: false }, R6: { on: false } });
    expect(all(off, xs)).toBe("clear");
    expect(evaluate(acc(), xs, off, NOW).rules.every((r) => r.state === "off")).toBe(true);
  });
  it("only reads touches up to now", () => expect(evaluate(acc(), [inn(-H, { outcome: "declined" })], DEFAULT_RULES, NOW).verdict).toBe("clear"));
});

describe("overrides, holds and blocks", () => {
  const quietXs = [out(2 * H, dana, { channel: "phone" })];
  it("a person's override needs a written reason, and is logged as overridden", () => {
    const c = send(acc(), quietXs, sam);
    expect(c.decision).toBe("warn");
    expect(resolve(c, sam)).toEqual({ send: false, log: null, needsReason: true });
    expect(resolve(c, sam, "   ")).toEqual({ send: false, log: null, needsReason: true });
    expect(resolve(c, sam, "They asked me to call back today")).toEqual({ send: true, log: "overridden", needsReason: false });
  });
  it("an agent's send is held, whatever reason comes with it", () => {
    const c = send(acc(), quietXs, theo);
    expect(resolve(c, theo, "please")).toEqual({ send: false, log: "held", needsReason: false });
  });
  it("an agent is blocked, not held, by do not contact", () => {
    const c = send(acc(), [inn(D, { outcome: "declined" })], theo);
    expect(c.decision).toBe("block");
    expect(resolve(c, theo)).toEqual({ send: false, log: "blocked", needsReason: false });
  });
  it("an agent is never warned", () => {
    for (const xs of [quietXs, [inn(D, { outcome: "declined" })], [out(3 * D, dana, { thread: null }), out(2 * D, dana), out(D, dana)]])
      expect(["hold", "block"]).toContain(send(acc(), xs, theo, { newThread: true }).decision);
  });
  it("a send that breaks nothing goes straight out with nothing logged", () => expect(resolve(send(acc(), [], dana), dana)).toEqual({ send: true, log: null, needsReason: false }));
});

describe("breaches: touches logged after the fact", () => {
  it("a call made inside someone else's quiet period is a breach of R2", () => {
    const before = [out(10 * H, theo)];
    const call = { ...out(8 * H, sam, { channel: "phone" as const }), actor: sam };
    expect(classifyLogged(acc(), before, DEFAULT_RULES, call).breach).toBe("R2");
  });
  it("a fourth WhatsApp in a week is a breach of R6", () => {
    const before = [out(6 * D, sam, { channel: "whatsapp" }), out(4 * D, sam, { channel: "whatsapp" }), out(2 * D, sam, { channel: "whatsapp" })];
    const msg = { ...out(D, sam, { channel: "whatsapp" as const }), actor: sam };
    expect(classifyLogged(acc(), before, DEFAULT_RULES, msg).breach).toBe("R6");
  });
  it("a call to someone who declined is a breach of R1", () => {
    const msg = { ...out(H, sam, { channel: "phone" as const }), actor: sam };
    expect(classifyLogged(acc(), [inn(D, { outcome: "declined" })], DEFAULT_RULES, msg).breach).toBe("R1");
  });
  it("a call that broke nothing isn't a breach, and neither is anything inbound", () => {
    const msg = { ...out(H, dana, { channel: "phone" as const }), actor: dana };
    expect(classifyLogged(acc(), [], DEFAULT_RULES, msg).breach).toBeNull();
    expect(classifyLogged(acc(), [out(2 * H, theo)], DEFAULT_RULES, { ...inn(H), actor: sam }).breach).toBeNull();
  });
  it("is judged at the time it happened, not now", () => {
    const before = [out(60 * H, theo)];
    const call = { ...out(55 * H, sam, { channel: "phone" as const }), actor: sam };
    expect(classifyLogged(acc(), before, DEFAULT_RULES, call).breach).toBe("R2");
  });
});
