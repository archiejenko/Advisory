// "Ask anything": plain-English questions answered by the agent that owns the subject, from the store.
// In the demo the matching is by keyword; a real workspace sends the question to the agent's model with these
// same selectors as its tools.
import type { ActionCard, State } from "./types";
import * as q from "./selectors";
import { pounds, plural, ukDay, clock, ukTime } from "./format";

export type Answer = { agentId: string; text: string; card: ActionCard | null };

const TOPICS: [RegExp, string][] = [
  [/\b(owe us|owed|overdue|chase|late pay|debtor|receivable|unpaid)\b/i, "agt_credit"],
  [/\b(we owe|bills?|pay(ables)?|suppliers?|cash|bank|afford|forecast|balance|invoice)\b/i, "agt_fin"],
  [/\b(leads?|pipeline|quotes?|deals?|prospects?|sales|won)\b/i, "agt_sales"],
  [/\b(inbox|enquir|messages?|emails?|reply|replies|complain)\b/i, "agt_cs"],
  [/\b(jobs?|today|rota|crew|shift|site|clean|tasks?|coshh|stock|tomorrow)\b/i, "agt_ops"],
];

export function routeAgent(text: string) { return (TOPICS.find(([re]) => re.test(text)) || [null, "agt_brief"])[1]; }

export function answer(s: State, text: string, agentId = routeAgent(text)): Answer {
  if (s.paused) return { agentId, text: "Agents are paused, so I can't look into that right now. Resume them from the top bar and ask again.", card: null };
  const t = text.toLowerCase();
  switch (agentId) {
    case "agt_credit": {
      const o = q.overdueInvoices(s);
      if (!o.length) return { agentId, text: "Nobody is overdue. Everything sent is within its terms.", card: null };
      const worst = o[0];
      return { agentId, text: `${plural(o.length, "invoice")} overdue, ${pounds(q.overdueTotal(s))} in total: ${o.map((i) => `${q.company(s, i.companyId)!.short} ${pounds(i.total)} (${q.daysLate(s, i)} days)`).join(", ")}. Another ${pounds(q.dueSoonTotal(s))} is due in the next 7 days.`, card: { label: `${pounds(worst.total)} overdue from ${q.company(s, worst.companyId)!.short}`, ref: { type: "invoice", id: worst.id } } };
    }
    case "agt_fin": {
      if (/cash|bank|balance|afford|forecast/.test(t)) {
        const f = q.cashForecast(s);
        const low = f.reduce((m, w) => (w.balance < m.balance ? w : m), f[0]);
        return { agentId, text: `You have ${pounds(s.org.cashBalance)} in the bank. Over the next six weeks the lowest point is ${pounds(low.balance)} in week ${low.week}, after payroll.`, card: null };
      }
      const due = q.billsDue(s, 7), over = q.billsOverdue(s);
      return { agentId, text: `Due in the next 7 days: ${due.length ? due.map((b) => `${b.supplier} ${pounds(b.total)}`).join(", ") : "nothing"}.${over.length ? ` Overdue: ${over.map((b) => `${b.supplier} ${pounds(b.total)}`).join(", ")}; payment is drafted for your OK.` : ""}`, card: over[0] ? { label: `Pay ${over[0].supplier} ${pounds(over[0].total)}`, ref: { type: "bill", id: over[0].id } } : null };
    }
    case "agt_sales": {
      const n = q.newLeadCount(s), un = q.quotesUnanswered(s);
      return { agentId, text: `${plural(n, "new lead")} this week, ${plural(q.repliesThisWeek(s).length, "reply", "replies")}, and ${q.wonThisWeek(s).length} won. Open pipeline is ${pounds(q.pipelineValue(s))} a year, forecast ${pounds(q.forecast(s))}. ${un.length ? `${plural(un.length, "quote")} have had no answer for over 5 days.` : ""}`.trim(), card: { label: "Open the pipeline", ref: { type: "deal", id: q.openDeals(s)[0]?.id || "" } } };
    }
    case "agt_cs": {
      const c = q.inboxCounts(s);
      const first = q.openConversations(s)[0];
      return { agentId, text: `${c.new} new and ${c.open} open in the inbox, ${c.waiting} waiting on the customer. This week I've answered in ${q.responseMinutes(s, 7)} minutes on average.`, card: first ? { label: first.subject, ref: { type: "conversation", id: first.id } } : null };
    }
    case "agt_ops": {
      const j = q.jobsToday(s);
      const d = q.diaryAhead(s, 7)[0];
      return { agentId, text: j.length ? `${plural(j.length, "job")} today: ${j.map((x) => `${q.company(s, x.companyId)!.short} at ${clock(x.schedule.time)} (${x.crewIds.map((p) => q.person(s, p)?.name.split(" ")[0]).join(" and ")})`).join("; ")}.${d ? ` Next in the diary: ${d.title}, ${ukDay(d.at)} at ${ukTime(d.at)}.` : ""}` : "No cleans booked today.", card: j[0] ? { label: q.title(s, { type: "job", id: j[0].id }), ref: { type: "job", id: j[0].id } } : null };
    }
    default: {
      const o = q.outcomes(s);
      return { agentId, text: `This week: ${pounds(o.collected)} collected, ${o.hoursSaved} hours saved, enquiries answered in ${o.responseMins} minutes on average. ${plural(q.pendingCount(s), "decision")} waiting for you, ${pounds(q.overdueTotal(s))} overdue.`, card: null };
    }
  }
}

/** The weekly briefing, written from the store. */
export function briefing(s: State) {
  const o = q.outcomes(s);
  const won = q.wonThisWeek(s).map((d) => q.company(s, d.companyId)!.short).join(" and ");
  return [
    `Here's Brightwork this week.`,
    `${pounds(o.collected)} came in, and the team saved you about ${o.hoursSaved} hours.`,
    won ? `${won} signed.` : "",
    `${plural(q.newLeadCount(s), "new lead")}, ${plural(q.repliesThisWeek(s).length, "reply", "replies")}.`,
    `${pounds(q.overdueTotal(s))} is overdue across ${plural(q.overdueCount(s), "invoice")}, and ${pounds(q.dueSoonTotal(s))} is due in the next 7 days.`,
    `${plural(q.pendingCount(s), "decision")} ${q.pendingCount(s) === 1 ? "is" : "are"} waiting for you.`,
  ].filter(Boolean).join(" ");
}
