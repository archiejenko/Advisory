// Compact summaries of any record, for drawers, plus the invoice and quote documents.
import React from "react";
import { useStore } from "../core.jsx";
import { AgentBadge, ActorName, BILL_TONE, CONV_TONE, DEAL_TONE, InvoiceChip, QUOTE_TONE, RecordLink, StatusChip, cap } from "../ui.jsx";
import * as q from "../demo/selectors";
import { pounds, ukDate, relative, plural } from "../demo/format";

export function InvoiceDoc({ inv }) {
  const s = useStore();
  const c = q.company(s, inv.companyId);
  const net = Math.round(inv.total / 1.2);
  return (
    <div className="w-doc" aria-label={`Invoice ${inv.id} preview`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div><h3>Invoice {inv.id}</h3><p>Brightwork Cleaning Ltd · Unit 4, Redhill Street, Manchester M4 6DE</p></div>
        <div style={{ textAlign: "right" }}><p>Issued {ukDate(inv.issuedAt)}</p><p>Due {ukDate(inv.dueAt)}</p></div>
      </div>
      <p style={{ marginTop: 16 }}><b>Bill to</b><br />{c.name}<br />{c.postcode}</p>
      <table><thead><tr><th>Description</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {inv.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{pounds(Math.round(l.qty * l.unit / 1.2))}</td></tr>)}
          <tr><td>VAT at 20%</td><td className="num">{pounds(inv.total - net)}</td></tr>
          <tr><td className="w-doc-t">Total</td><td className="num w-doc-t">{pounds(inv.total)}</td></tr>
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>Pay by bank transfer to Brightwork Cleaning Ltd, sort code 40-11-62, account 31926819, reference {inv.id}.</p>
    </div>
  );
}

export function QuoteDoc({ quote }) {
  const s = useStore();
  const c = q.company(s, quote.companyId);
  return (
    <div className="w-doc" aria-label={`Quote ${quote.number} preview`}>
      <h3>Quote {quote.number}</h3>
      <p>For {c.name}{quote.sentAt ? ` · sent ${ukDate(quote.sentAt)}` : " · not sent yet"}</p>
      <table><thead><tr><th>What</th><th className="num">Visits</th><th className="num">Each</th><th className="num">A year</th></tr></thead>
        <tbody>
          {quote.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{pounds(l.unit)}</td><td className="num">{pounds(l.qty * l.unit)}</td></tr>)}
          <tr><td className="w-doc-t" colSpan={3}>Total a year, including VAT</td><td className="num w-doc-t">{pounds(quote.total)}</td></tr>
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>Fixed price for 12 months. Includes all products and equipment. Cancel with a month's notice.</p>
    </div>
  );
}

/** A chase timeline for one invoice: what Credit control sent, when, and what happens next. */
export function ChaseLine({ inv }) {
  const s = useStore();
  const pend = s.approvals.find((a) => a.status === "pending" && a.linkedRecord.type === "invoice" && a.linkedRecord.id === inv.id);
  const late = q.daysLate(s, inv);
  const n = q.remindersSent(inv);
  const next = pend ? <RecordLink refTo={{ type: "approval", id: pend.id }} className="w-link">Waiting for your OK: {n === 0 ? "1st" : "2nd"} reminder</RecordLink>
    : inv.status === "paid" ? "Paid" : !q.isOverdue(s, inv) ? "Reminder the day after it's due" : n >= 2 ? "Time to call: Rosa has drafted talking points" : `${n === 0 ? "1st" : "2nd"} reminder goes out tomorrow`;
  return (
    <div className="w-chase">
      {inv.chaseLog.map((c, i) => <i key={i} title={c.summary}>{c.kind === "reminder" ? "✉" : "✎"} {c.kind === "reminder" ? `Reminder ${ukDate(c.at).replace(/ \d{4}$/, "")}` : c.summary}</i>)}
      {inv.chaseLog.length > 0 && <span aria-hidden="true">→</span>}
      <i className={inv.status === "paid" ? "" : "next"}>Next: {next}{late > 0 && inv.status !== "paid" ? "" : ""}</i>
    </div>
  );
}

export function Summary({ refTo }) {
  const s = useStore();
  const { type, id } = refTo;
  if (type === "invoice") {
    const inv = s.invoices.find((x) => x.id === id);
    return (
      <div className="w-stack">
        <dl className="w-dl">
          <dt>Customer</dt><dd><RecordLink refTo={{ type: "company", id: inv.companyId }} /></dd>
          <dt>Amount</dt><dd className="tnum">{pounds(inv.total)}</dd>
          <dt>Status</dt><dd><InvoiceChip invoice={inv} /></dd>
          <dt>Due</dt><dd>{ukDate(inv.dueAt)}</dd>
          {inv.jobId && <><dt>Job</dt><dd><RecordLink refTo={{ type: "job", id: inv.jobId }} /></dd></>}
          <dt>Chasing</dt><dd><ChaseLine inv={inv} /></dd>
        </dl>
        <InvoiceDoc inv={inv} />
      </div>
    );
  }
  if (type === "quote") {
    const x = s.quotes.find((y) => y.id === id);
    return <div className="w-stack"><dl className="w-dl"><dt>Customer</dt><dd><RecordLink refTo={{ type: "company", id: x.companyId }} /></dd><dt>Deal</dt><dd><RecordLink refTo={{ type: "deal", id: x.dealId }} /></dd><dt>Status</dt><dd><StatusChip tone={QUOTE_TONE[x.status]}>{cap(x.status)}</StatusChip></dd></dl><QuoteDoc quote={x} /></div>;
  }
  if (type === "company") {
    const c = q.company(s, id);
    const contact = s.contacts.find((x) => x.companyId === id);
    const open = s.invoices.filter((i) => i.companyId === id && q.isUnpaid(i));
    return (
      <dl className="w-dl">
        <dt>Status</dt><dd><StatusChip tone={c.status === "customer" ? "done" : c.status === "lead" ? "agent" : "neutral"}>{cap(c.status)}</StatusChip></dd>
        <dt>What they are</dt><dd>{c.type}{c.staff ? `, ${c.staff} staff` : ""}, {c.postcode}</dd>
        {contact && <><dt>Contact</dt><dd><RecordLink refTo={{ type: "contact", id: contact.id }} />, {contact.role}</dd></>}
        <dt>Notes</dt><dd>{c.notes}</dd>
        {c.status === "customer" && <><dt>Unpaid</dt><dd>{open.length ? open.map((i) => <div key={i.id}><RecordLink refTo={{ type: "invoice", id: i.id }} /> {pounds(i.total)}</div>) : "Nothing"}</dd></>}
        <dt>Source</dt><dd>{c.source}, added {relative(c.createdAt, s.now)}</dd>
      </dl>
    );
  }
  if (type === "deal") {
    const d = s.deals.find((x) => x.id === id);
    const qt = s.quotes.find((x) => x.dealId === id);
    return <dl className="w-dl"><dt>Company</dt><dd><RecordLink refTo={{ type: "company", id: d.companyId }} /></dd><dt>Stage</dt><dd><StatusChip tone={DEAL_TONE[d.stage]}>{cap(d.stage)}</StatusChip></dd><dt>Value</dt><dd className="tnum">{pounds(d.value)} a year</dd><dt>Next step</dt><dd>{d.nextStep}</dd><dt>Owner</dt><dd><AgentBadge agentId={d.ownerId} /></dd>{qt && <><dt>Quote</dt><dd><RecordLink refTo={{ type: "quote", id: qt.id }} /></dd></>}</dl>;
  }
  if (type === "bill") {
    const b = s.bills.find((x) => x.id === id);
    return <dl className="w-dl"><dt>Supplier</dt><dd>{b.supplier}</dd><dt>For</dt><dd>{b.category}</dd><dt>Amount</dt><dd className="tnum">{pounds(b.total)}</dd><dt>Due</dt><dd>{ukDate(b.dueAt)}</dd><dt>Status</dt><dd><StatusChip tone={BILL_TONE[b.status]}>{cap(b.status)}</StatusChip></dd><dt>Recorded by</dt><dd><AgentBadge agentId="agt_fin" /></dd></dl>;
  }
  if (type === "job") {
    const j = s.jobs.find((x) => x.id === id);
    return <dl className="w-dl"><dt>Customer</dt><dd><RecordLink refTo={{ type: "company", id: j.companyId }} /></dd><dt>Site</dt><dd>{j.site}</dd><dt>When</dt><dd>{q.scheduleText(j)}</dd><dt>Crew</dt><dd>{j.crewIds.map((p, i) => <React.Fragment key={p}>{i > 0 && ", "}<RecordLink refTo={{ type: "person", id: p }} /></React.Fragment>)}</dd><dt>Status</dt><dd><StatusChip tone={j.status === "proposed" ? "attn" : j.status === "scheduled" ? "agent" : "done"}>{cap(j.status)}</StatusChip></dd></dl>;
  }
  if (type === "conversation") {
    const c = s.conversations.find((x) => x.id === id);
    return <dl className="w-dl"><dt>With</dt><dd>{c.companyId ? <RecordLink refTo={{ type: "company", id: c.companyId }} /> : c.messages[0].from}</dd><dt>Channel</dt><dd>{cap(c.channel)}</dd><dt>Status</dt><dd><StatusChip tone={CONV_TONE[c.status]}>{cap(c.status)}</StatusChip></dd><dt>Assigned</dt><dd><ActorName actor={c.assignedTo} /></dd><dt>Messages</dt><dd>{plural(c.messages.length, "message")}</dd></dl>;
  }
  if (type === "task") {
    const t = s.tasks.find((x) => x.id === id);
    return <dl className="w-dl"><dt>For</dt><dd><ActorName actor={t.assignee} /></dd><dt>Due</dt><dd>{t.dueAt ? ukDate(t.dueAt) : "No date"}</dd><dt>About</dt><dd>{t.linkedRecord ? <RecordLink refTo={t.linkedRecord} /> : "—"}</dd><dt>Detail</dt><dd>{t.detail || "—"}</dd></dl>;
  }
  if (type === "record") {
    const r = s.records.find((x) => x.id === id);
    return <dl className="w-dl"><dt>Status</dt><dd>{r.status}</dd><dt>Owner</dt><dd>{r.ownerId ? <RecordLink refTo={{ type: "person", id: r.ownerId }} /> : "—"}</dd>{r.companyId && <><dt>Site</dt><dd><RecordLink refTo={{ type: "company", id: r.companyId }} /></dd></>}<dt>Detail</dt><dd>{r.detail}</dd></dl>;
  }
  return null;
}
