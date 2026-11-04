// Contact rules: who may contact a buyer or supplier, when, and on what terms. One source for the API (which checks
// an agent's draft before it reaches the approvals queue) and the website (which checks a touch as you log it), so
// the screen and the server always agree. All rule wording a customer can see lives here.
//
// Agents can't break a rule: their send is held, or blocked for do not contact. People are warned and can override
// with a written reason. Calls and messages logged after the fact that broke a rule are breaches.

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export type Who = { kind: "person" | "agent"; id: string };
export type ContactChannel = "email" | "phone" | "whatsapp" | "linkedin" | "web" | "visit";

/** A touch with a buyer or supplier. `actor` is null when they contacted us. */
export type CTouch = {
  at: string; actor: Who | null; direction: "in" | "out"; channel: ContactChannel;
  outcome?: "accepted" | "declined" | null; quiet?: boolean; contactId?: string | null; thread?: string | null;
};
/** What the rules need to know about an account. `dnc` is an explicit opt-out; `until` is a set end date. */
export type CAccount = { owner: Who | null; handoffTo?: Who[]; dnc?: { since: string; until: string | null } | null };

export type ContactRules = {
  R1: { on: boolean; days: number };
  R2: { on: boolean; hours: number };
  R3: { on: boolean };
  R4: { on: boolean; hours: number };
  R5: { on: boolean; hours: number };
  R6: { on: boolean; max: number; windowDays: number };
};
export const DEFAULT_RULES: ContactRules = {
  R1: { on: true, days: 180 }, R2: { on: true, hours: 48 }, R3: { on: true },
  R4: { on: true, hours: 4 }, R5: { on: true, hours: 24 }, R6: { on: true, max: 3, windowDays: 7 },
};
export const RULE_ORDER: RuleId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];

export const RULE_COPY: Record<RuleId, { name: string; explain: (r: ContactRules) => string }> = {
  R1: { name: "Do not contact", explain: (r) => `After a decline or opt-out, nobody contacts them for ${r.R1.days} days, or until the date set on the account` },
  R2: { name: "Quiet period", explain: (r) => `After anyone contacts them, nobody else does for ${r.R2.hours} hours unless they reply first` },
  R3: { name: "Owner starts threads", explain: () => "Only the owner, or someone they hand to, starts a new conversation" },
  R4: { name: "Confirm acceptances", explain: (r) => `An accepted invitation is confirmed within ${r.R4.hours} hours, on whatever channel it came in` },
  R5: { name: "Reply in time", explain: (r) => `A message from them is answered within ${r.R5.hours} hours` },
  R6: { name: "Frequency cap", explain: (r) => `No more than ${r.R6.max} outbound touches to one contact in any ${r.R6.windowDays} days` },
};

export type Verdict = "dnc" | "confirm" | "reply" | "quiet" | "capped" | "clear";
export const VERDICT_COPY: Record<Verdict, { label: string; next: string }> = {
  dnc: { label: "Do not contact", next: "Don't contact them" },
  confirm: { label: "Confirm acceptance", next: "Confirm the acceptance" },
  reply: { label: "Reply due", next: "Reply to them" },
  quiet: { label: "In quiet period", next: "Leave them until the quiet period ends" },
  capped: { label: "At weekly limit", next: "Wait until the weekly limit resets" },
  clear: { label: "Clear", next: "Nothing due" },
};

/** pass: nothing applies. active: in force, still in time. fail: in force and overdue (R4, R5) or broken. off: switched off. */
export type RuleState = "pass" | "active" | "fail" | "off";
export type RuleResult = { id: RuleId; state: RuleState; detail: string; dueAt: string | null };
export type Evaluation = { verdict: Verdict; next: string; dueAt: string | null; rules: RuleResult[] };

const H = 3600e3, D = 24 * H;
const t = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const same = (a: Who | null | undefined, b: Who | null | undefined) => !!a && !!b && a.kind === b.kind && a.id === b.id;
const sorted = (xs: CTouch[]) => [...xs].sort((a, b) => t(a.at) - t(b.at));

/* ---------- One function per rule. Each reads only the touches up to `now`. ---------- */

/** When do-not-contact ends, if it applies at `now`: an explicit opt-out, or their latest decline. */
function dncUntil(acc: CAccount, xs: CTouch[], r: ContactRules, now: number): number | null {
  const ends: number[] = [];
  if (acc.dnc && t(acc.dnc.since) <= now) ends.push(acc.dnc.until ? t(acc.dnc.until) : t(acc.dnc.since) + r.R1.days * D);
  const declined = xs.filter((x) => x.direction === "in" && x.outcome === "declined").pop();
  if (declined) ends.push(t(declined.at) + r.R1.days * D);
  const end = ends.length ? Math.max(...ends) : null;
  return end != null && now < end ? end : null;
}
function r1(acc: CAccount, xs: CTouch[], r: ContactRules, now: number): RuleResult {
  if (!r.R1.on) return { id: "R1", state: "off", detail: "Switched off", dueAt: null };
  const end = dncUntil(acc, xs, r, now);
  return end == null ? { id: "R1", state: "pass", detail: "No decline or opt-out in force", dueAt: null }
    : { id: "R1", state: "active", detail: "They declined or opted out", dueAt: iso(end) };
}
/** The last outbound and who sent it, if its quiet period is still running at `now`. */
function quiet(xs: CTouch[], r: ContactRules, now: number): { by: Who | null; until: number } | null {
  const last = xs.filter((x) => x.direction === "out").pop();
  if (!last) return null;
  if (xs.some((x) => x.direction === "in" && t(x.at) > t(last.at))) return null; // they replied: the quiet period is over
  const until = t(last.at) + r.R2.hours * H;
  return now < until ? { by: last.actor, until } : null;
}
function r2(xs: CTouch[], r: ContactRules, now: number, by?: Who): RuleResult {
  if (!r.R2.on) return { id: "R2", state: "off", detail: "Switched off", dueAt: null };
  const q = quiet(xs, r, now);
  if (!q) return { id: "R2", state: "pass", detail: "No quiet period running", dueAt: null };
  if (by && same(by, q.by)) return { id: "R2", state: "pass", detail: "Quiet period is yours: you sent the last message", dueAt: iso(q.until) };
  return { id: "R2", state: by ? "fail" : "active", detail: "Someone contacted them recently", dueAt: iso(q.until) };
}
function r3(acc: CAccount, r: ContactRules, by?: Who, newThread?: boolean): RuleResult {
  if (!r.R3.on) return { id: "R3", state: "off", detail: "Switched off", dueAt: null };
  if (!acc.owner) return { id: "R3", state: "pass", detail: "No owner set: anyone may start a thread", dueAt: null };
  if (!by || !newThread) return { id: "R3", state: "pass", detail: "The owner starts new threads", dueAt: null };
  if (same(by, acc.owner) || (acc.handoffTo || []).some((h) => same(h, by))) return { id: "R3", state: "pass", detail: "You own this account or it was handed to you", dueAt: null };
  return { id: "R3", state: "fail", detail: "Only the owner, or someone they hand to, starts a new thread", dueAt: null };
}
function r4(xs: CTouch[], r: ContactRules, now: number): RuleResult {
  if (!r.R4.on) return { id: "R4", state: "off", detail: "Switched off", dueAt: null };
  const acc = xs.filter((x) => x.direction === "in" && x.outcome === "accepted").pop();
  if (!acc || xs.some((x) => x.direction === "out" && t(x.at) > t(acc.at))) return { id: "R4", state: "pass", detail: "No acceptance waiting", dueAt: null };
  const due = t(acc.at) + r.R4.hours * H;
  return { id: "R4", state: now > due ? "fail" : "active", detail: `They accepted by ${acc.channel === "whatsapp" ? "WhatsApp" : acc.channel} and nobody has confirmed`, dueAt: iso(due) };
}
function r5(xs: CTouch[], r: ContactRules, now: number): RuleResult {
  if (!r.R5.on) return { id: "R5", state: "off", detail: "Switched off", dueAt: null };
  const lastOut = xs.filter((x) => x.direction === "out").pop();
  const waiting = xs.filter((x) => x.direction === "in" && !x.quiet && (!lastOut || t(x.at) > t(lastOut.at)))[0];
  if (!waiting) return { id: "R5", state: "pass", detail: "Nothing from them is waiting", dueAt: null };
  const due = t(waiting.at) + r.R5.hours * H;
  return { id: "R5", state: now > due ? "fail" : "active", detail: "Their message is waiting for a reply", dueAt: iso(due) };
}
/** Outbound touches in the rolling window, per contact (or the whole account when a touch names no contact). */
function r6(xs: CTouch[], r: ContactRules, now: number, contactId?: string | null, sending = false): RuleResult {
  if (!r.R6.on) return { id: "R6", state: "off", detail: "Switched off", dueAt: null };
  const from = now - r.R6.windowDays * D;
  const out = xs.filter((x) => x.direction === "out" && t(x.at) > from && t(x.at) <= now);
  const groups = new Map<string, CTouch[]>();
  for (const x of out) { const k = x.contactId || "_"; groups.set(k, [...(groups.get(k) || []), x]); }
  const list = sending ? (contactId ? [...(groups.get(contactId) || []), ...(groups.get("_") || [])] : out) : [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
  const n = list.length;
  const reset = n ? iso(t(sorted(list)[Math.max(0, n - r.R6.max)].at) + r.R6.windowDays * D) : null;
  if (n < r.R6.max) return { id: "R6", state: "pass", detail: `${n} of ${r.R6.max} in the last ${r.R6.windowDays} days`, dueAt: null };
  return { id: "R6", state: sending ? "fail" : "active", detail: `${n} outbound ${n === 1 ? "touch" : "touches"} in the last ${r.R6.windowDays} days`, dueAt: reset };
}

/** Where an account stands now: one verdict (R1, then R4, R5, R2, R6), the next step, when it's due, and every rule. */
export function evaluate(acc: CAccount, touches: CTouch[], rules: ContactRules, now: string | number): Evaluation {
  const n = typeof now === "number" ? now : t(now);
  const xs = sorted(touches.filter((x) => t(x.at) <= n));
  const res: Record<RuleId, RuleResult> = { R1: r1(acc, xs, rules, n), R2: r2(xs, rules, n), R3: r3(acc, rules), R4: r4(xs, rules, n), R5: r5(xs, rules, n), R6: r6(xs, rules, n) };
  const on = (id: RuleId) => res[id].state === "active" || res[id].state === "fail";
  const verdict: Verdict = on("R1") ? "dnc" : on("R4") ? "confirm" : on("R5") ? "reply" : on("R2") ? "quiet" : on("R6") ? "capped" : "clear";
  const from = { dnc: "R1", confirm: "R4", reply: "R5", quiet: "R2", capped: "R6", clear: null }[verdict] as RuleId | null;
  return { verdict, next: VERDICT_COPY[verdict].next, dueAt: from ? res[from].dueAt : null, rules: RULE_ORDER.map((id) => res[id]) };
}

export type Attempt = { actor: Who; channel: ContactChannel; contactId?: string | null; newThread: boolean; at?: string };
export type Check = { decision: "allow" | "warn" | "hold" | "block"; ruleId: RuleId | null; reason: string; broken: RuleId[]; rules: RuleResult[] };

/**
 * Whether `attempt` may go out now. Rules that stop a send, in order: R1, R2, R3, R6. (R4 and R5 are met by
 * sending, so they never stop one.) An agent is blocked by R1 and held by the rest; a person is warned.
 */
export function check(acc: CAccount, touches: CTouch[], rules: ContactRules, now: string | number, attempt: Attempt): Check {
  const n = typeof now === "number" ? now : t(now);
  const xs = sorted(touches.filter((x) => t(x.at) < n || (t(x.at) === n && x.direction === "in")));
  const one = r1(acc, xs, rules, n);
  const res = [{ ...one, state: one.state === "active" ? ("fail" as const) : one.state }, r2(xs, rules, n, attempt.actor), r3(acc, rules, attempt.actor, attempt.newThread), r6(xs, rules, n, attempt.contactId, true)];
  const broken = res.filter((x) => x.state === "fail").map((x) => x.id);
  if (!broken.length) return { decision: "allow", ruleId: null, reason: "No rule stops this", broken, rules: res };
  const id = broken[0];
  const decision = attempt.actor.kind === "agent" ? (id === "R1" ? "block" : "hold") : "warn";
  return { decision, ruleId: id, reason: `${RULE_COPY[id].name}: ${res.find((x) => x.id === id)!.detail}`, broken, rules: res };
}

/**
 * What the guard log records for a check, and whether the touch goes out. Agents never override. A person's warning
 * goes out only with a written reason, and is logged as overridden.
 */
export function resolve(c: Check, actor: Who, reason?: string | null): { send: boolean; log: "held" | "blocked" | "overridden" | null; needsReason: boolean } {
  if (c.decision === "allow") return { send: true, log: null, needsReason: false };
  if (actor.kind === "agent") return { send: false, log: c.decision === "block" ? "blocked" : "held", needsReason: false };
  const ok = !!reason && reason.trim().length > 0;
  return { send: ok, log: ok ? "overridden" : null, needsReason: !ok };
}

/** A call or message logged after it happened: which rule, if any, it broke at the time. */
export function classifyLogged(acc: CAccount, touches: CTouch[], rules: ContactRules, touch: CTouch & { actor: Who }): { breach: RuleId | null; reason: string } {
  if (touch.direction !== "out") return { breach: null, reason: "Inbound touches can't break a rule" };
  const c = check(acc, touches, rules, touch.at, { actor: touch.actor, channel: touch.channel, contactId: touch.contactId, newThread: !touch.thread });
  return c.decision === "allow" ? { breach: null, reason: c.reason } : { breach: c.ruleId, reason: c.reason };
}
