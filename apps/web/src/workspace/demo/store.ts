// The demo store: one state object, changed only through the actions below. Every change can be undone for
// 30 seconds (the store records what each action touched), and the state is saved to this browser so the demo
// survives a reload. "Reset demo" in the avatar menu starts again from the seed.
import type { Approval, ApprovalType, Collection, DealStage, Field, OsConfig, Preview, Ref, State, ActivityEvent, Actor, AccountRef, ContactRules, GuardEvent, RuleId, Sequence, Touch, TouchChannel } from "./types";
import { seed, dayOne } from "./seed";
import { pounds } from "./format";
import { accountName, actorName, agent, checkAttempt, company, sameAcc, title, TRUST_COPY } from "./selectors";
import { classifyLogged, resolve, RULE_COPY, type CTouch } from "../../../../../packages/core/contact";
import { answer } from "./ask";

const KEY = "bw:demo:v1";
const D = 86400e3;
const dayKey = () => new Date().toISOString().slice(0, 10);

type Patch = { coll: Collection; id: string; before: unknown } | { field: Field; before: unknown };
type Undo = { token: string; label: string; patches: Patch[]; at: number };

let state: State;
let undos: Undo[] = [];
const subs = new Set<() => void>();
let seq = 1;

function load(): State {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) { const v = JSON.parse(raw); if (v.day === dayKey() && v.state?.agents && v.state?.touches) return v.state; }
  } catch { /* storage blocked: start fresh */ }
  return seed();
}
function save() {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify({ day: dayKey(), state })); } catch { /* not persisted */ }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function emit() {
  subs.forEach((f) => f());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 200);
}

export function init(s?: State) { state = s || load(); undos = []; }
export function getState(): State { if (!state) init(); return state; }
export function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function reset(nowMs?: number) { state = seed(nowMs); undos = []; save(); emit(); }

/* ---------- Transactions ---------- */
type Tx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update<T = any>(coll: Collection, id: string, fn: (x: T) => Partial<T>): void;
  insert<T extends { id: string }>(coll: Collection, x: T, atStart?: boolean): void;
  set<K extends Field>(field: K, v: State[K]): void;
  event(actor: Actor, verb: string, ref: Ref | null, minutesSaved?: number, undoable?: boolean): void;
  now: string;
};
function tx(label: string, fn: (t: Tx) => void): string {
  const s = getState();
  const patches: Patch[] = [];
  const next: State = { ...s };
  const touched = new Set<string>();
  const t: Tx = {
    now: new Date().toISOString(),
    update(coll, id, f) {
      const arr = next[coll] as unknown as { id: string }[];
      const i = arr.findIndex((x) => x.id === id);
      if (i < 0) return;
      if (!touched.has(coll + id)) { patches.push({ coll, id, before: arr[i] }); touched.add(coll + id); }
      const copy = arr.slice();
      copy[i] = { ...arr[i], ...f(arr[i] as never) };
      (next as Record<string, unknown>)[coll] = copy;
    },
    insert(coll, x, atStart = true) {
      patches.push({ coll, id: x.id, before: undefined }); touched.add(coll + x.id);
      const arr = next[coll] as unknown as { id: string }[];
      (next as Record<string, unknown>)[coll] = atStart ? [x, ...arr] : [...arr, x];
    },
    set(field, v) {
      if (!touched.has(field)) { patches.push({ field, before: next[field] }); touched.add(field); }
      (next as Record<string, unknown>)[field] = v;
    },
    event(actor, verb, ref, minutesSaved = 0, undoable = true) {
      t.insert("activity", { id: "ev_n" + (seq++), actor, verb, linkedRecord: ref, at: t.now, undoable, minutesSaved } as ActivityEvent);
    },
  };
  fn(t);
  state = next;
  const token = "u" + (seq++);
  undos = [{ token, label, patches, at: Date.now() }, ...undos.filter((u) => Date.now() - u.at < 60e3)].slice(0, 20);
  emit();
  return token;
}
/** Undo one action: put back exactly what it touched, leaving everything else as it is now. */
export function undo(token: string) {
  const u = undos.find((x) => x.token === token);
  if (!u) return false;
  const next: State = { ...state };
  for (const p of [...u.patches].reverse()) {
    if ("field" in p) { (next as Record<string, unknown>)[p.field] = p.before; continue; }
    const arr = (next[p.coll] as unknown as { id: string }[]).slice();
    const i = arr.findIndex((x) => x.id === p.id);
    if (p.before === undefined) { if (i >= 0) arr.splice(i, 1); }
    else if (i >= 0) arr[i] = p.before as { id: string }; else arr.push(p.before as { id: string });
    (next as Record<string, unknown>)[p.coll] = arr;
  }
  state = next;
  undos = undos.filter((x) => x !== u);
  emit();
  return true;
}

/* ---------- The contact rules' guard on agent drafts ---------- */
const DANA: Actor = { kind: "person", id: "p_dana" };
/** Drafts that contact a buyer or supplier, and whether each starts a new conversation. Everything else isn't checked. */
const CONTACTS: Partial<Record<ApprovalType, { newThread: boolean }>> = {
  send_outreach: { newThread: true }, reply_enquiry: { newThread: false }, send_reminder: { newThread: true }, send_invoice: { newThread: true }, follow_up_quote: { newThread: false },
};
/** The buyer or supplier a decision is about. */
export function accountForRef(s: State, r: Ref): AccountRef | null {
  switch (r.type) {
    case "company": return { kind: "company", id: r.id };
    case "supplier": return { kind: "supplier", id: r.id };
    case "bill": { const b = s.bills.find((x) => x.id === r.id); return b?.supplierId ? { kind: "supplier", id: b.supplierId } : null; }
    case "conversation": case "invoice": case "quote": case "deal": case "job": {
      const coll = { conversation: s.conversations, invoice: s.invoices, quote: s.quotes, deal: s.deals, job: s.jobs }[r.type] as { id: string; companyId: string | null }[];
      const c = coll.find((x) => x.id === r.id)?.companyId;
      return c ? { kind: "company", id: c } : null;
    }
    default: return null;
  }
}
const channelOf = (p: Preview): TouchChannel => (p.kind === "message" ? (/whatsapp/i.test(p.channel) ? "whatsapp" : "web") : "email");
const textOf = (p: Preview) => (p.kind === "email" ? p.subject : p.kind === "message" ? p.body.slice(0, 80) : p.summary);
const threadOf = (a: Pick<Approval, "linkedRecord" | "type">) => (CONTACTS[a.type]?.newThread ? null : a.linkedRecord.id);
type Guarded = { outcome: "queued" | "held" | "blocked" | "unchecked"; guardId: string | null; ruleId: RuleId | null; reason: string };
const outcomes = new Map<string, Guarded>();
/** What the contact rules did to the draft or approval behind an undo token: queued, held, blocked or not checked. */
export const guardOutcome = (token: string | null) => (token && outcomes.get(token)) || null;

/** Check an agent's draft against the contact rules: allowed, held (it waits, and the owner is told) or blocked. */
function guardDraft(s: State, a: Pick<Approval, "agentId" | "type" | "linkedRecord" | "preview">) {
  const rule = CONTACTS[a.type], acc = accountForRef(s, a.linkedRecord);
  if (!rule || !acc) return { acc, c: null, r: null };
  const actor: Actor = { kind: "agent", id: a.agentId };
  const c = checkAttempt(s, acc, { actor, channel: channelOf(a.preview), newThread: rule.newThread });
  return { acc, c, r: resolve(c, actor) };
}
function setSequence(t: Tx, s: State, acc: AccountRef, agentId: string, state: Sequence["state"]) {
  const q = s.sequences.find((x) => x.agentId === agentId && sameAcc(x.account, acc));
  if (q) t.update<Sequence>("sequences", q.id, () => ({ state }));
}
/**
 * Every agent draft reaches the approvals queue through here. The contact rules are checked first: a hold parks the
 * draft and tells the account's owner; do not contact skips it and logs why.
 */
function propose(t: Tx, draft: Omit<Approval, "status" | "decidedAt" | "decidedBy" | "edited" | "note"> & Partial<Approval>): Guarded {
  const s = getState();
  const g = guardDraft(s, draft);
  if (!g.c || !g.r || g.r.send || !g.acc) {
    t.insert("approvals", { status: "pending", decidedAt: null, decidedBy: null, edited: false, note: null, ...draft } as Approval);
    return { outcome: g.c ? "queued" : "unchecked", guardId: null, ruleId: null, reason: "" };
  }
  return park(t, s, g.acc, draft, g.r.log as "held" | "blocked", g.c.ruleId!, g.c.reason, true);
}
/** Write a held or blocked draft to the guard log, update the agent's sequence, and tell the owner. */
function park(t: Tx, s: State, acc: AccountRef, a: Omit<Approval, "status" | "decidedAt" | "decidedBy" | "edited" | "note"> & Partial<Approval>, decision: "held" | "blocked", ruleId: RuleId, reason: string, isNew: boolean): Guarded {
  const gid = "ge_n" + (seq++);
  const ag = agent(s, a.agentId)!, name = accountName(s, acc);
  const ev: GuardEvent = { id: gid, account: acc, at: t.now, actor: { kind: "agent", id: a.agentId }, channel: channelOf(a.preview), attempted: a.title, ruleId, decision,
    outcome: decision === "blocked" ? "Skipped" : null, pending: decision === "held", reason, approvalId: decision === "held" ? a.id : null, touchId: null, decidedBy: null, decidedAt: null };
  t.insert("guard", ev);
  if (decision === "held") {
    if (isNew) t.insert("approvals", { decidedAt: null, decidedBy: null, edited: false, note: null, ...a, status: "held", guardEventId: gid } as Approval);
    else t.update<Approval>("approvals", a.id, () => ({ status: "held", guardEventId: gid }));
    setSequence(t, s, acc, a.agentId, "held");
    const owner = (acc.kind === "company" ? company(s, acc.id)?.owner : s.suppliers.find((x) => x.id === acc.id)?.owner) || DANA;
    t.insert("tasks", { id: "task_n" + (seq++), title: `Decide on ${possessive(ag.name)} held message to ${name}`, detail: `${RULE_COPY[ruleId].name}: ${reason}. Send it with a reason, or drop it.`,
      assignee: owner.kind === "person" ? owner : DANA, dueAt: null, linkedRecord: { type: acc.kind, id: acc.id }, status: "open", createdAt: t.now, createdBy: { kind: "agent", id: a.agentId } });
    t.event({ kind: "agent", id: a.agentId }, `had a message to ${name} held: ${RULE_COPY[ruleId].name.toLowerCase()}`, { type: acc.kind, id: acc.id }, 0);
  } else {
    if (!isNew) t.update<Approval>("approvals", a.id, () => ({ status: "rejected", decidedAt: t.now, decidedBy: null, note: "Skipped: do not contact" }));
    setSequence(t, s, acc, a.agentId, "stopped");
    t.event({ kind: "agent", id: a.agentId }, `skipped ${name}: they're on do not contact`, { type: acc.kind, id: acc.id }, 0);
  }
  return { outcome: decision, guardId: gid, ruleId, reason };
}
const possessive = (n: string) => (n.endsWith("s") ? n + "’" : n + "’s");
/** Every message that goes out is a touch on its account, so the next check sees it. */
function addTouch(t: Tx, acc: AccountRef | null, x: Omit<Touch, "id" | "account" | "loggedAt" | "heardBy" | "outcome" | "quiet" | "contactId"> & Partial<Touch>) {
  if (!acc) return null;
  const s = getState();
  const id = "t_n" + (seq++);
  const contactId = acc.kind === "company" ? s.contacts.find((c) => c.companyId === acc.id)?.id || null : null;
  t.insert("touches", { id, account: acc, loggedAt: x.at, heardBy: null, outcome: null, quiet: false, contactId, ...x } as Touch);
  return id;
}
function sentTouch(t: Tx, a: Approval, actor: Actor) {
  if (!CONTACTS[a.type]) return;
  addTouch(t, accountForRef(getState(), a.linkedRecord), { at: t.now, actor, channel: channelOf(a.preview), direction: "out", text: textOf(a.preview), thread: threadOf(a) });
}

/* ---------- Decisions ---------- */
/** What approving does, beyond marking the decision. Shared by approve and by rules that let agents act alone. */
function carryOut(t: Tx, a: Approval, how: "approved" | "auto") {
  const s = getState();
  const ag: Actor = { kind: "agent", id: a.agentId };
  sentTouch(t, a, ag);
  const r = a.linkedRecord;
  const by = how === "auto" ? " (under your rule)" : "";
  switch (a.type) {
    case "send_reminder": {
      const inv = s.invoices.find((x) => x.id === r.id)!;
      const n = inv.chaseLog.filter((c) => c.kind === "reminder").length + 1;
      t.update("invoices", inv.id, (x) => ({ chaseLog: [...x.chaseLog, { at: t.now, agentId: a.agentId, actorId: how === "auto" ? null : "p_dana", kind: "reminder" as const, summary: `${n === 1 ? "First" : n === 2 ? "Second" : n + "th"} reminder sent${how === "auto" ? " under your rule" : ", approved by Dana"}`, approvalId: a.id }], status: "overdue" as const }));
      t.event(ag, `sent ${n === 1 ? "a first" : "a second"} reminder for ${inv.id}${by}`, r, 15);
      break;
    }
    case "send_outreach": {
      const c = company(s, r.id)!;
      const p = a.preview as Extract<Preview, { kind: "email" }>;
      t.insert("conversations", { id: "cv_n" + (seq++), companyId: c.id, contactId: s.contacts.find((x) => x.companyId === c.id)?.id || null, channel: "email", subject: p.subject, origin: "reply", status: "waiting", assignedTo: ag, messages: [{ id: "m_n" + (seq++), at: t.now, direction: "out", from: "Dana Price", body: p.body, actor: ag }] });
      const d = s.deals.find((x) => x.companyId === c.id && x.stage !== "won" && x.stage !== "lost");
      if (d) t.update("deals", d.id, () => ({ nextStep: "Wait for a reply; follow up in 4 days", updatedAt: t.now }));
      t.event(ag, `emailed ${c.name}${by}`, r, 18);
      break;
    }
    case "reply_enquiry": {
      const cv = s.conversations.find((x) => x.id === r.id)!;
      const p = a.preview as Extract<Preview, { kind: "email" }>;
      t.update("conversations", cv.id, (x) => ({ status: "waiting" as const, messages: [...x.messages, { id: "m_n" + (seq++), at: t.now, direction: "out" as const, from: "Dana Price", body: p.body, actor: ag }] }));
      if (cv.id === "cv_castlefield") {
        t.update("jobs", "job_castlefield_visit", () => ({ status: "scheduled" as const }));
        t.update("diary", "dia_castlefield", (x) => ({ title: String((x as unknown as { title: string }).title).replace(" (to confirm)", "") }));
      }
      t.event(ag, `replied to ${cv.companyId ? company(s, cv.companyId)!.name : cv.subject}${by}`, r, 12);
      break;
    }
    case "pay_bill": {
      const b = s.bills.find((x) => x.id === r.id)!;
      t.update("bills", b.id, () => ({ status: "paid" as const, paidAt: t.now }));
      t.set("org", { ...getStateDraft(t).org, cashBalance: getStateDraft(t).org.cashBalance - b.total });
      t.event(ag, `paid ${b.supplier} ${pounds(b.total)}${by}`, r, 8);
      break;
    }
    case "confirm_job": t.event(ag, `told the crew about ${title(s, r)}${by}`, r, 10); break;
    case "post_briefing": {
      const p = a.preview as Extract<Preview, { kind: "message" }>;
      t.insert("chat", { id: "ch_n" + (seq++), channelId: "ch_general", author: ag, body: p.body, at: t.now, card: null }, false);
      t.event(ag, `posted the weekly briefing to #general${by}`, { type: "agent", id: a.agentId }, 25);
      break;
    }
    case "send_invoice": {
      t.update("invoices", r.id, () => ({ status: "sent" as const, issuedAt: t.now, dueAt: new Date(Date.now() + 30 * D).toISOString() }));
      t.event(ag, `sent ${r.id}${by}`, r, 12);
      break;
    }
    case "follow_up_quote": {
      for (const q of s.quotes.filter((x) => x.status === "sent")) {
        const d = s.deals.find((x) => x.id === q.dealId);
        if (d) t.update("deals", d.id, () => ({ nextStep: "Followed up today; call on Friday if no reply", updatedAt: t.now }));
      }
      t.event(ag, `followed up the quotes waiting for an answer${by}`, r, 20);
      break;
    }
  }
}
// Reads inside a transaction see the state as it was when it began; that's enough for the effects above.
function getStateDraft(_t: Tx) { return getState(); }

export function approve(id: string, edits?: { preview?: Preview }) {
  const a = getState().approvals.find((x) => x.id === id);
  if (!a || a.status !== "pending") return null;
  const final = edits?.preview ? { ...a, preview: edits.preview } : a;
  // Things may have changed since the draft: check the contact rules again before anything goes out.
  const g = a.watch ? null : guardDraft(getState(), final);
  if (g?.r && !g.r.send && g.acc) {
    let res: Guarded | null = null;
    const tok = tx(`Held: ${a.title}`, (t) => { if (edits?.preview) t.update<Approval>("approvals", id, () => ({ preview: final.preview })); res = park(t, getState(), g.acc!, final, g.r!.log as "held" | "blocked", g.c!.ruleId!, g.c!.reason, false); });
    outcomes.set(tok, res!);
    return tok;
  }
  return tx(`Approved: ${a.title}`, (t) => {
    t.update<Approval>("approvals", id, () => ({ status: "approved", decidedAt: t.now, decidedBy: "p_dana", edited: !!edits?.preview && JSON.stringify(edits.preview) !== JSON.stringify(a.preview), preview: final.preview }));
    if (a.watch) t.event({ kind: "agent", id: a.agentId }, `noted your OK on "${a.title}" (watch mode: nothing was sent)`, a.linkedRecord, 0);
    else carryOut(t, final, "approved");
  });
}
export function reject(id: string) {
  const a = getState().approvals.find((x) => x.id === id);
  if (!a || a.status !== "pending") return null;
  return tx(`Rejected: ${a.title}`, (t) => {
    t.update<Approval>("approvals", id, () => ({ status: "rejected", decidedAt: t.now, decidedBy: "p_dana" }));
    t.event(DANA, `rejected "${a.title}"; nothing was sent`, a.linkedRecord);
  });
}
export function approveMany(ids: string[]) {
  const list = getState().approvals.filter((x) => ids.includes(x.id) && x.status === "pending");
  if (!list.length) return null;
  return tx(`Approved ${list.length}`, (t) => {
    for (const a of list) {
      const g = a.watch ? null : guardDraft(getState(), a);
      if (g?.r && !g.r.send && g.acc) { park(t, getState(), g.acc, a, g.r.log as "held" | "blocked", g.c!.ruleId!, g.c!.reason, false); continue; }
      t.update<Approval>("approvals", a.id, () => ({ status: "approved", decidedAt: t.now, decidedBy: "p_dana" }));
      if (!a.watch) carryOut(t, a, "approved");
    }
  });
}
export function editPreview(id: string, preview: Preview) { tx("Edited a draft", (t) => t.update<Approval>("approvals", id, () => ({ preview }))); }

/* ---------- Trust ladder ---------- */
export function acceptTrust(agentId: string, type: ApprovalType, limit: number) {
  const ag = agent(getState(), agentId)!;
  return tx(`${ag.name} can now ${TRUST_COPY[type]} under ${pounds(limit)}`, (t) => {
    t.update("agents", agentId, (x: typeof ag) => ({ autonomy: x.autonomy.map((r) => (r.type === type ? { ...r, mode: "auto" as const, maxValue: limit } : r)) }));
    t.set("prefs", { ...getState().prefs, trustDismissed: [...getState().prefs.trustDismissed, agentId + ":" + type] });
    t.event(DANA, `let ${ag.name} ${TRUST_COPY[type]} under ${pounds(limit)} without asking`, { type: "agent", id: agentId }, 0);
    // Anything already waiting that now falls inside the rule goes ahead.
    for (const a of getState().approvals.filter((x) => x.agentId === agentId && x.type === type && x.status === "pending" && (x.value ?? 0) < limit)) {
      const g = guardDraft(getState(), a);
      if (g.r && !g.r.send && g.acc) { park(t, getState(), g.acc, a, g.r.log as "held" | "blocked", g.c!.ruleId!, g.c!.reason, false); continue; }
      t.update<Approval>("approvals", a.id, () => ({ status: "auto", decidedAt: t.now, decidedBy: null }));
      carryOut(t, a, "auto");
    }
  });
}
export function dismissTrust(key: string) { tx("Kept asking", (t) => t.set("prefs", { ...getState().prefs, trustDismissed: [...getState().prefs.trustDismissed, key] })); }
export function setAutonomy(agentId: string, type: ApprovalType, mode: "ask" | "auto", maxValue: number | null) {
  const ag = agent(getState(), agentId)!;
  return tx(`Changed ${ag.name}'s rules`, (t) => {
    t.update("agents", agentId, (x: typeof ag) => ({ autonomy: x.autonomy.map((r) => (r.type === type ? { ...r, mode, maxValue } : r)) }));
    t.event(DANA, `changed ${ag.name}'s rule: ${mode === "auto" ? `${TRUST_COPY[type]} without asking${maxValue ? ` under ${pounds(maxValue)}` : ""}` : `ask before they ${TRUST_COPY[type]}`}`, { type: "agent", id: agentId }, 0);
  });
}

/** Credits: which mode an agent runs in, and its monthly credit budget (null for none). */
export function setAgentCredits(agentId: string, patch: { mode?: "quick" | "standard" | "deep" | "strategy"; monthlyBudget?: number | null }) {
  const ag = agent(getState(), agentId)!;
  return tx(`Changed ${ag.name}'s credits`, (t) => {
    t.update("agents", agentId, () => patch);
    // The Usage page's heatmap pins mode changes.
    if (patch.mode && patch.mode !== (ag.mode || "standard")) t.set("usage", { ...getState().usage, modeChanges: [...getState().usage.modeChanges, { at: t.now, agentId, from: ag.mode || "standard", to: patch.mode }] });
    t.event(DANA, patch.mode ? `switched ${ag.name} to ${patch.mode[0].toUpperCase() + patch.mode.slice(1)} mode` : patch.monthlyBudget ? `gave ${ag.name} a budget of ${patch.monthlyBudget.toLocaleString("en-GB")} credits a month` : `removed ${ag.name}'s monthly budget`, { type: "agent", id: agentId }, 0);
  });
}

/* ---------- Leaks ---------- */
export function fixLeak(id: string) {
  const s = getState();
  return tx("Fixed a leak", (t) => {
    t.set("prefs", { ...s.prefs, leaksDismissed: [...s.prefs.leaksDismissed, id] });
    if (id === "leak_quotes") {
      const all = s.quotes.filter((x) => x.status === "sent" && x.sentAt && Date.parse(x.sentAt) < Date.parse(s.now) - 5 * D);
      const preview = (list: typeof all): Preview => ({ kind: "email", to: list.map((x) => s.contacts.find((c) => c.companyId === x.companyId)?.email).join(", "), subject: "Your cleaning quote", body: "Hello,\n\nJust checking the quote I sent over last week reached you. Happy to walk round again or adjust the visits if that helps.\n\nKind regards,\nDana Price\nBrightwork Cleaning" });
      // Each quote's account is checked on its own: anyone on do not contact is skipped, and the guard log says so.
      const q = all.filter((x) => {
        const g = guardDraft(s, { agentId: "agt_sales", type: "follow_up_quote", linkedRecord: { type: "quote", id: x.id }, preview: preview([x]) });
        if (g.r && !g.r.send && g.acc) { park(t, s, g.acc, { id: "apr_n" + (seq++), agentId: "agt_sales", type: "follow_up_quote", risk: "routine", value: null, createdAt: t.now, linkedRecord: { type: "quote", id: x.id }, title: `Follow up ${x.number}`, reason: "", preview: preview([x]) }, g.r.log as "held" | "blocked", g.c!.ruleId!, g.c!.reason, true); return false; }
        return true;
      });
      if (q.length) {
        propose(t, { id: "apr_n" + (seq++), agentId: "agt_sales", type: "follow_up_quote", risk: "routine", value: null, createdAt: t.now, linkedRecord: { type: "quote", id: q[0].id },
          title: `Follow up ${q.length} ${q.length === 1 ? "quote" : "quotes"}`, reason: `Sent ${q.map((x) => x.number).join(", ")} · no answer after 5 days`, preview: preview(q) });
        t.event({ kind: "agent", id: "agt_sales" }, `drafted follow-ups for ${q.length} ${q.length === 1 ? "quote" : "quotes"}`, { type: "quote", id: q[0].id }, 15);
      }
    } else if (id.startsWith("leak_late_")) {
      const cid = id.slice(10);
      t.insert("tasks", { id: "task_n" + (seq++), title: `Agree upfront billing with ${company(s, cid)!.name}`, detail: "They've paid late every month since the summer. Suggest invoicing on the 1st with 7-day terms.", assignee: DANA, dueAt: new Date(Date.now() + 3 * D).toISOString(), linkedRecord: { type: "company", id: cid }, status: "open", createdAt: t.now, createdBy: { kind: "agent", id: "agt_credit" } });
      t.event({ kind: "agent", id: "agt_credit" }, `added a task to move ${company(s, cid)!.name} to upfront billing`, { type: "company", id: cid }, 5);
    } else if (id.startsWith("leak_draft_")) {
      const inv = s.invoices.find((x) => x.id === id.slice(11))!;
      const c = company(s, inv.companyId)!;
      propose(t, { id: "apr_n" + (seq++), agentId: "agt_fin", type: "send_invoice", risk: "routine", value: inv.total, createdAt: t.now, linkedRecord: { type: "invoice", id: inv.id },
        title: `Send ${inv.id} to ${c.name}`, reason: `${pounds(inv.total)} · first month · 30-day terms`,
        preview: { kind: "email", to: c.email || "", subject: `Invoice ${inv.id} from Brightwork Cleaning`, body: `Hello,\n\nPlease find attached invoice ${inv.id} for ${pounds(inv.total)}, for your first month of weekly cleaning. Payment is due within 30 days.\n\nThank you for choosing us.\nDana Price\nBrightwork Cleaning` } });
    }
  });
}

/* ---------- Records ---------- */
export function moveDeal(id: string, stage: DealStage) {
  const s = getState();
  const d = s.deals.find((x) => x.id === id);
  if (!d || d.stage === stage) return null;
  return tx("Moved a deal", (t) => {
    t.update("deals", id, () => ({ stage, updatedAt: t.now }));
    if (stage === "won") t.update("companies", d.companyId, () => ({ status: "customer" as const, customerSince: t.now.slice(0, 10) }));
    if (stage === "lost") t.update("companies", d.companyId, () => ({ status: "lost" as const }));
    t.event(DANA, `moved ${company(s, d.companyId)!.name} to ${stage[0].toUpperCase() + stage.slice(1)}`, { type: "deal", id });
  });
}
export function setTask(id: string, done: boolean) {
  const task = getState().tasks.find((x) => x.id === id)!;
  return tx(done ? "Task done" : "Task reopened", (t) => {
    t.update("tasks", id, () => ({ status: done ? ("done" as const) : ("open" as const) }));
    t.event(DANA, `${done ? "ticked off" : "reopened"} "${task.title}"`, { type: "task", id });
  });
}
export function addTask(input: { title: string; assignee: Actor; dueAt: string | null; linkedRecord: Ref | null }) {
  return tx("Task added", (t) => {
    const id = "task_n" + (seq++);
    t.insert("tasks", { id, detail: null, status: "open", createdAt: t.now, createdBy: DANA, ...input });
    t.event(DANA, `added a task: ${input.title}`, { type: "task", id }, 0);
  });
}
export function setConversation(id: string, status: "new" | "open" | "waiting" | "resolved") {
  return tx("Conversation updated", (t) => { t.update("conversations", id, () => ({ status })); t.event(DANA, `marked "${title(getState(), { type: "conversation", id })}" ${status}`, { type: "conversation", id }); });
}
export function markPaid(invoiceId: string) {
  const inv = getState().invoices.find((x) => x.id === invoiceId)!;
  return tx(`Marked ${invoiceId} paid`, (t) => {
    t.update("invoices", invoiceId, () => ({ status: "paid" as const, paidAt: t.now }));
    t.insert("payments", { id: "pay_n" + (seq++), invoiceId, amount: inv.total, at: t.now });
    t.set("org", { ...getState().org, cashBalance: getState().org.cashBalance + inv.total });
    t.event(DANA, `marked ${invoiceId} paid (${pounds(inv.total)})`, { type: "invoice", id: invoiceId });
  });
}

/* ---------- Shell ---------- */
export function togglePause() {
  const p = !getState().paused;
  return tx(p ? "Paused agents" : "Resumed agents", (t) => { t.set("paused", p); t.event(DANA, p ? "paused all agents" : "resumed all agents", null, 0, false); });
}
export function setView(view: "owner" | "accountant") { tx("View changed", (t) => t.set("prefs", { ...getState().prefs, view })); }
export function saveOs(os: OsConfig, summary: string) {
  return tx("Saved Setup", (t) => {
    const prev = getState().os;
    t.set("os", { ...os, version: prev.version + 1, history: [{ version: prev.version + 1, at: t.now, summary }, ...prev.history].slice(0, 20) });
    t.event(DANA, `changed Setup: ${summary}`, null, 0);
  });
}
/** Onboarding: start a fresh workspace on day one, in watch mode for 48 hours. */
export function startDayOne(input: { business: string; owner: string; description: string; tools: string[]; autonomy: Record<string, "watch" | "ask" | "limits"> }) {
  state = dayOne(input);
  undos = [];
  save(); emit();
}
export function finishOnboarding(input: { description: string; autonomy: Record<string, "watch" | "ask" | "limits"> }) {
  return tx("Set up the workspace", (t) => {
    t.set("prefs", { ...getState().prefs, onboarded: true });
    for (const a of getState().agents) {
      const lvl = input.autonomy[a.id];
      if (!lvl) continue;
      t.update("agents", a.id, (x: typeof a) => ({ autonomy: x.autonomy.map((r) => ({ ...r, mode: lvl === "limits" ? ("auto" as const) : ("ask" as const), maxValue: lvl === "limits" ? 50000 : null })) }));
    }
    t.event(DANA, "set up the workspace and switched on watch mode for 48 hours", null, 0, false);
  });
}

/* ---------- Team chat ---------- */
export function sendChat(channelId: string, body: string) {
  const s = getState();
  const text = body.trim();
  if (!text) return;
  const mentioned = s.agents.find((a) => new RegExp(`@(${a.name}|${a.roleName})\\b`, "i").test(text));
  tx("Message sent", (t) => t.insert("chat", { id: "ch_n" + (seq++), channelId, author: DANA, body: text, at: t.now, card: null }, false));
  if (mentioned) {
    // Agents answer a moment later, as they would after a run.
    setTimeout(() => {
      const a = answer(getState(), text.replace(/@\w+/g, "").trim(), mentioned.id);
      tx("Agent replied", (t) => t.insert("chat", { id: "ch_n" + (seq++), channelId, author: { kind: "agent", id: a.agentId }, body: a.text, at: new Date().toISOString(), card: a.card }, false));
    }, getState().paused ? 0 : 900);
  }
}

/** The undo token for an activity event made in the last minute, if it can still be undone. */
export function undoTokenForEvent(eventId: string) {
  const u = undos.find((x) => Date.now() - x.at < 60e3 && x.patches.some((p) => "coll" in p && p.coll === "activity" && p.id === eventId));
  return u?.token || null;
}

/** Ask Customer service to draft a reply to a conversation; it lands in the decision queue. */
export function draftReply(conversationId: string) {
  const s = getState();
  const cv = s.conversations.find((x) => x.id === conversationId)!;
  const c = cv.companyId ? company(s, cv.companyId) : null;
  const last = [...cv.messages].reverse().find((m) => m.direction === "in");
  const to = (cv.contactId && s.contacts.find((x) => x.id === cv.contactId)?.email) || c?.email || last?.from || "";
  let res: Guarded | null = null;
  const tok = tx("Reply drafted", (t) => {
    res = propose(t, { id: "apr_n" + (seq++), agentId: "agt_cs", type: "reply_enquiry", risk: "review", value: null, createdAt: t.now, linkedRecord: { type: "conversation", id: cv.id },
      title: `Reply to ${c ? c.short : last?.from}`, reason: `Drafted on request · ${cv.channel === "phone" ? "from a call note" : "answers their last message"}`,
      preview: { kind: "email", to, subject: "Re: " + cv.subject.replace(/^Re: /, ""), body: `Hello${last ? " " + last.from.split(" ")[0] : ""},\n\nThanks for this. ${cv.channel === "phone" ? "Following up on your call: " : ""}we can sort that for you this week. I'll confirm the day and time by tomorrow.\n\nKind regards,\nDana Price\nBrightwork Cleaning` } });
    t.event({ kind: "agent", id: "agt_cs" }, `drafted a reply to ${c ? c.name : cv.subject}`, { type: "conversation", id: cv.id }, 8);
  });
  outcomes.set(tok, res!);
  return tok;
}

/* ---------- Engagement ---------- */
export type LogInput = {
  account: AccountRef; actor: Actor; channel: TouchChannel; direction: "in" | "out"; text: string; at?: string;
  outcome?: "accepted" | "declined" | null; quiet?: boolean; thread?: string | null; contactId?: string | null;
};
/**
 * Log a touch. Outbound now: checked against the contact rules; a warning goes out only with a written reason, and is
 * logged as overridden. Outbound earlier (logged after the fact): judged by the rules as they stood then, and a breach
 * is logged. Inbound is recorded as heard by the person logging it. Returns null when a reason was needed and missing.
 */
export function logTouch(x: LogInput, reason?: string | null) {
  const s = getState();
  const now = Date.now(), at = x.at && Date.parse(x.at) < now - 5 * 60e3 ? x.at : null;
  const name = accountName(s, x.account), ch = x.channel;
  const contactId = x.contactId !== undefined ? x.contactId : x.account.kind === "company" ? s.contacts.find((c) => c.companyId === x.account.id)?.id || null : null;
  if (x.direction === "in") {
    return tx("Touch logged", (t) => {
      addTouch(t, x.account, { at: at || t.now, actor: null, heardBy: x.actor, channel: ch, direction: "in", text: x.text, outcome: x.outcome || null, quiet: !!x.quiet, thread: x.thread ?? null, contactId });
      if (x.outcome === "declined") { for (const q of s.sequences.filter((y) => sameAcc(y.account, x.account) && y.state !== "finished")) t.update<Sequence>("sequences", q.id, () => ({ state: "stopped" })); }
      t.event(x.actor, `logged ${x.outcome === "accepted" ? "an acceptance" : x.outcome === "declined" ? "a decline" : "a message"} from ${name}`, { type: x.account.kind, id: x.account.id }, 0);
    });
  }
  if (at) {
    const before = s.touches.filter((y) => sameAcc(y.account, x.account) && Date.parse(y.at) < Date.parse(at)).map(toC);
    const acc = x.account.kind === "company" ? company(s, x.account.id)! : s.suppliers.find((y) => y.id === x.account.id)!;
    const b = classifyLogged(acc, before, s.contactRules, { at, actor: x.actor, direction: "out", channel: ch, contactId, thread: x.thread ?? null });
    return tx(b.breach ? "Breach logged" : "Touch logged", (t) => {
      const id = addTouch(t, x.account, { at, loggedAt: t.now, actor: x.actor, channel: ch, direction: "out", text: x.text, thread: x.thread ?? null, contactId });
      if (b.breach) t.insert("guard", { id: "ge_n" + (seq++), account: x.account, at, actor: x.actor, channel: ch, attempted: x.text, ruleId: b.breach, decision: "breach", outcome: "Logged after it happened", pending: false, reason: b.reason, approvalId: null, touchId: id, decidedBy: null, decidedAt: null } as GuardEvent);
      t.event(x.actor, b.breach ? `logged a ${ch === "whatsapp" ? "WhatsApp" : ch} to ${name} that broke ${RULE_COPY[b.breach].name.toLowerCase()}` : `logged a ${ch === "whatsapp" ? "WhatsApp" : ch} to ${name}`, { type: x.account.kind, id: x.account.id }, 0);
    });
  }
  const c = checkAttempt(s, x.account, { actor: x.actor, channel: ch, contactId, newThread: !x.thread });
  const r = resolve(c, x.actor, reason);
  if (!r.send) return null;
  return tx(r.log === "overridden" ? "Sent with a reason" : "Touch logged", (t) => {
    const id = addTouch(t, x.account, { at: t.now, actor: x.actor, channel: ch, direction: "out", text: x.text, thread: x.thread ?? null, contactId });
    if (r.log === "overridden") t.insert("guard", { id: "ge_n" + (seq++), account: x.account, at: t.now, actor: x.actor, channel: ch, attempted: x.text, ruleId: c.ruleId!, decision: "overridden", outcome: "Sent with a reason", pending: false, reason: reason!.trim(), approvalId: null, touchId: id, decidedBy: x.actor.id, decidedAt: t.now } as GuardEvent);
    t.event(x.actor, `${r.log === "overridden" ? "overrode " + RULE_COPY[c.ruleId!].name.toLowerCase() + " and contacted" : "contacted"} ${name} by ${ch === "whatsapp" ? "WhatsApp" : ch}`, { type: x.account.kind, id: x.account.id }, 0);
  });
}
const toC = (t: Touch): CTouch => ({ at: t.at, actor: t.actor, direction: t.direction, channel: t.channel, outcome: t.outcome, quiet: t.quiet, contactId: t.contactId, thread: t.thread });
function closeHoldTask(t: Tx, s: State, g: GuardEvent) {
  const task = s.tasks.find((x) => x.status === "open" && x.linkedRecord?.type === g.account.kind && x.linkedRecord.id === g.account.id && /held message/.test(x.title));
  if (task) t.update("tasks", task.id, () => ({ status: "done" as const }));
}
/** A person sends a held message anyway: needs a written reason, and is logged as overridden. */
export function sendHeld(guardId: string, reason: string) {
  const s = getState();
  const g = s.guard.find((x) => x.id === guardId);
  if (!g || !g.pending || !reason.trim()) return null;
  const a = g.approvalId ? s.approvals.find((x) => x.id === g.approvalId) : null;
  return tx(`Sent: ${g.attempted}`, (t) => {
    t.update<GuardEvent>("guard", g.id, () => ({ decision: "overridden", pending: false, outcome: "Sent with a reason", reason: reason.trim(), decidedBy: "p_dana", decidedAt: t.now }));
    if (a) { t.update<Approval>("approvals", a.id, () => ({ status: "approved", decidedAt: t.now, decidedBy: "p_dana" })); carryOut(t, a, "approved"); }
    setSequence(t, s, g.account, g.actor.id, "active");
    closeHoldTask(t, s, g);
    t.event(DANA, `sent ${possessive(actorName(s, g.actor))} held message to ${accountName(s, g.account)}: ${reason.trim()}`, { type: g.account.kind, id: g.account.id }, 0);
  });
}
/** Drop a held message: nothing is sent, and the agent's sequence pauses. */
export function dropHeld(guardId: string) {
  const s = getState();
  const g = s.guard.find((x) => x.id === guardId);
  if (!g || !g.pending) return null;
  return tx(`Dropped: ${g.attempted}`, (t) => {
    t.update<GuardEvent>("guard", g.id, () => ({ pending: false, outcome: "Dropped", decidedBy: "p_dana", decidedAt: t.now }));
    if (g.approvalId) t.update<Approval>("approvals", g.approvalId, () => ({ status: "rejected", decidedAt: t.now, decidedBy: "p_dana" }));
    setSequence(t, s, g.account, g.actor.id, "paused");
    closeHoldTask(t, s, g);
    t.event(DANA, `dropped ${possessive(actorName(s, g.actor))} held message to ${accountName(s, g.account)}; nothing was sent`, { type: g.account.kind, id: g.account.id }, 0);
  });
}
export function assignOwner(refs: AccountRef[], owner: Actor) {
  const s = getState();
  return tx(`Owner changed on ${refs.length}`, (t) => {
    for (const r of refs) t.update(r.kind === "company" ? "companies" : "suppliers", r.id, () => ({ owner }));
    t.event(DANA, `made ${actorName(s, owner)} the owner of ${refs.length === 1 ? accountName(s, refs[0]) : refs.length + " accounts"}`, refs.length === 1 ? { type: refs[0].kind, id: refs[0].id } : null, 0);
  });
}
/** Pause every running agent sequence on these accounts. */
export function pauseSequences(refs: AccountRef[]) {
  const s = getState();
  const list = s.sequences.filter((x) => refs.some((r) => sameAcc(r, x.account)) && (x.state === "active" || x.state === "awaiting"));
  return tx(`Paused ${list.length} ${list.length === 1 ? "automation" : "automations"}`, (t) => {
    for (const x of list) t.update<Sequence>("sequences", x.id, () => ({ state: "paused" }));
    t.event(DANA, `paused ${list.length} agent ${list.length === 1 ? "sequence" : "sequences"}`, null, 0);
  });
}
export function setContactRule<K extends keyof ContactRules>(id: K, patch: Partial<ContactRules[K]>) {
  const s = getState();
  return tx(`Changed ${RULE_COPY[id].name.toLowerCase()}`, (t) => {
    t.set("contactRules", { ...s.contactRules, [id]: { ...s.contactRules[id], ...patch } });
    t.event(DANA, `changed the ${RULE_COPY[id].name.toLowerCase()} rule`, null, 0);
  });
}
/** Ask an agent to confirm an acceptance; the draft goes through the contact rules like any other. */
export function confirmAcceptance(acc: AccountRef) {
  const s = getState();
  const name = accountName(s, acc);
  const c = acc.kind === "company" ? s.contacts.find((x) => x.companyId === acc.id) : null;
  const accepted = s.touches.filter((x) => sameAcc(x.account, acc) && x.outcome === "accepted").sort((a, b) => b.at.localeCompare(a.at))[0];
  let res: Guarded | null = null;
  const tok = tx("Confirmation drafted", (t) => {
    res = propose(t, { id: "apr_n" + (seq++), agentId: "agt_cs", type: "reply_enquiry", risk: "review", value: null, createdAt: t.now, linkedRecord: { type: acc.kind, id: acc.id },
      title: `Confirm ${possessive(name)} acceptance`, reason: `They accepted${accepted ? ` by ${accepted.channel === "whatsapp" ? "WhatsApp" : accepted.channel}` : ""} · confirm within ${s.contactRules.R4.hours} hours`,
      preview: { kind: "email", to: c?.email || "", subject: `Confirming: ${name}`, body: `Hello${c ? " " + c.name.split(" ")[0] : ""},\n\nThank you for saying yes. I'm confirming it here so we're all agreed, and I'll send the details for the first visit today.\n\nKind regards,\nDana Price\nBrightwork Cleaning` } });
    t.event({ kind: "agent", id: "agt_cs" }, `drafted a confirmation for ${name}`, { type: acc.kind, id: acc.id }, 6);
  });
  outcomes.set(tok, res!);
  return tok;
}

/* ---------- Usage and credits ---------- */
export function topUp() {
  const s = getState();
  return tx("Topped up 1,000 credits", (t) => { t.set("usage", { ...s.usage, topups: [...s.usage.topups, { at: t.now, credits: 1000 }] }); t.event(DANA, "topped up 1,000 credits", null, 0); });
}
export function setPlan(plan: string) {
  const s = getState();
  if (plan === s.usage.plan) return null;
  return tx("Plan changed", (t) => {
    t.set("usage", { ...s.usage, plan, planChanges: [...s.usage.planChanges, { at: t.now, from: s.usage.plan, to: plan }] });
    t.event(DANA, `moved the plan to ${plan[0].toUpperCase() + plan.slice(1)}`, null, 0);
  });
}
