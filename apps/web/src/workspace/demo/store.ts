// The demo store: one state object, changed only through the actions below. Every change can be undone for
// 30 seconds (the store records what each action touched), and the state is saved to this browser so the demo
// survives a reload. "Reset demo" in the avatar menu starts again from the seed.
import type { Approval, ApprovalType, Collection, DealStage, OsConfig, Preview, Ref, State, ActivityEvent, Actor } from "./types";
import { seed, dayOne } from "./seed";
import { pounds } from "./format";
import { agent, company, title, TRUST_COPY } from "./selectors";
import { answer } from "./ask";

const KEY = "bw:demo:v1";
const D = 86400e3;
const dayKey = () => new Date().toISOString().slice(0, 10);

type Patch = { coll: Collection; id: string; before: unknown } | { field: "org" | "os" | "paused" | "prefs"; before: unknown };
type Undo = { token: string; label: string; patches: Patch[]; at: number };

let state: State;
let undos: Undo[] = [];
const subs = new Set<() => void>();
let seq = 1;

function load(): State {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) { const v = JSON.parse(raw); if (v.day === dayKey() && v.state?.agents) return v.state; }
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
  set<K extends "org" | "os" | "paused" | "prefs">(field: K, v: State[K]): void;
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

/* ---------- Decisions ---------- */
const DANA: Actor = { kind: "person", id: "p_dana" };
/** What approving does, beyond marking the decision. Shared by approve and by rules that let agents act alone. */
function carryOut(t: Tx, a: Approval, how: "approved" | "auto") {
  const s = getState();
  const ag: Actor = { kind: "agent", id: a.agentId };
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
    for (const a of list) { t.update<Approval>("approvals", a.id, () => ({ status: "approved", decidedAt: t.now, decidedBy: "p_dana" })); if (!a.watch) carryOut(t, a, "approved"); }
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
    t.event(DANA, patch.mode ? `switched ${ag.name} to ${patch.mode[0].toUpperCase() + patch.mode.slice(1)} mode` : patch.monthlyBudget ? `gave ${ag.name} a budget of ${patch.monthlyBudget.toLocaleString("en-GB")} credits a month` : `removed ${ag.name}'s monthly budget`, { type: "agent", id: agentId }, 0);
  });
}

/* ---------- Leaks ---------- */
export function fixLeak(id: string) {
  const s = getState();
  return tx("Fixed a leak", (t) => {
    t.set("prefs", { ...s.prefs, leaksDismissed: [...s.prefs.leaksDismissed, id] });
    if (id === "leak_quotes") {
      const q = s.quotes.filter((x) => x.status === "sent" && x.sentAt && Date.parse(x.sentAt) < Date.parse(s.now) - 5 * D);
      t.insert("approvals", { id: "apr_n" + (seq++), agentId: "agt_sales", type: "follow_up_quote", risk: "routine", value: null, createdAt: t.now, linkedRecord: { type: "quote", id: q[0].id },
        title: `Follow up ${q.length} quotes`, reason: `Sent ${q.map((x) => x.number).join(", ")} · no answer after 5 days`, status: "pending", decidedAt: null, decidedBy: null, edited: false, note: null,
        preview: { kind: "email", to: q.map((x) => s.contacts.find((c) => c.companyId === x.companyId)?.email).join(", "), subject: "Your cleaning quote", body: "Hello,\n\nJust checking the quote I sent over last week reached you. Happy to walk round again or adjust the visits if that helps.\n\nKind regards,\nDana Price\nBrightwork Cleaning" } } as Approval);
      t.event({ kind: "agent", id: "agt_sales" }, `drafted follow-ups for ${q.length} quotes`, { type: "quote", id: q[0].id }, 15);
    } else if (id.startsWith("leak_late_")) {
      const cid = id.slice(10);
      t.insert("tasks", { id: "task_n" + (seq++), title: `Agree upfront billing with ${company(s, cid)!.name}`, detail: "They've paid late every month since the summer. Suggest invoicing on the 1st with 7-day terms.", assignee: DANA, dueAt: new Date(Date.now() + 3 * D).toISOString(), linkedRecord: { type: "company", id: cid }, status: "open", createdAt: t.now, createdBy: { kind: "agent", id: "agt_credit" } });
      t.event({ kind: "agent", id: "agt_credit" }, `added a task to move ${company(s, cid)!.name} to upfront billing`, { type: "company", id: cid }, 5);
    } else if (id.startsWith("leak_draft_")) {
      const inv = s.invoices.find((x) => x.id === id.slice(11))!;
      const c = company(s, inv.companyId)!;
      t.insert("approvals", { id: "apr_n" + (seq++), agentId: "agt_fin", type: "send_invoice", risk: "routine", value: inv.total, createdAt: t.now, linkedRecord: { type: "invoice", id: inv.id },
        title: `Send ${inv.id} to ${c.name}`, reason: `${pounds(inv.total)} · first month · 30-day terms`, status: "pending", decidedAt: null, decidedBy: null, edited: false, note: null,
        preview: { kind: "email", to: c.email || "", subject: `Invoice ${inv.id} from Brightwork Cleaning`, body: `Hello,\n\nPlease find attached invoice ${inv.id} for ${pounds(inv.total)}, for your first month of weekly cleaning. Payment is due within 30 days.\n\nThank you for choosing us.\nDana Price\nBrightwork Cleaning` } } as Approval);
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
  return tx("Reply drafted", (t) => {
    t.insert("approvals", { id: "apr_n" + (seq++), agentId: "agt_cs", type: "reply_enquiry", risk: "review", value: null, createdAt: t.now, linkedRecord: { type: "conversation", id: cv.id },
      title: `Reply to ${c ? c.short : last?.from}`, reason: `Drafted on request · ${cv.channel === "phone" ? "from a call note" : "answers their last message"}`, status: "pending", decidedAt: null, decidedBy: null, edited: false, note: null,
      preview: { kind: "email", to, subject: "Re: " + cv.subject.replace(/^Re: /, ""), body: `Hello${last ? " " + last.from.split(" ")[0] : ""},\n\nThanks for this. ${cv.channel === "phone" ? "Following up on your call: " : ""}we can sort that for you this week. I'll confirm the day and time by tomorrow.\n\nKind regards,\nDana Price\nBrightwork Cleaning` } } as Approval);
    t.event({ kind: "agent", id: "agt_cs" }, `drafted a reply to ${c ? c.name : cv.subject}`, { type: "conversation", id: cv.id }, 8);
  });
}
