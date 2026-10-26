// Record pages: the connective tissue. Every entity has a page, and every reference to another entity is a link, so
// from INV-1047 you can reach Tarnbrook, the job, the quote, the deal, the chase emails and the agent that sent them.
import React, { useEffect, useState } from "react";
import { Link, navigate, useRoute } from "../../router.jsx";
import { Icon, hrefFor, toast, useStore } from "../core.jsx";
import {
  ActorName, AgentBadge, Avatar, BILL_TONE, Button, CONV_TONE, Crumbs, DEAL_TONE, DataTable, EmptyState, InvoiceChip, QUOTE_TONE,
  RecordLink, Section, StatusChip, Tabs, Timeline, cap,
} from "../ui.jsx";
import { DecisionCard } from "../DecisionCard.jsx";
import { ChaseLine, InvoiceDoc, QuoteDoc } from "./Summary.jsx";
import { getState, draftReply, markPaid, moveDeal, setAutonomy, setConversation, setTask, undo, undoTokenForEvent } from "../demo/store";
import * as q from "../demo/selectors";
import { APPS, appName, hubDef } from "../demo/catalogue";
import { mins, pct, plural, pounds, relative, ukDate, ukDay, ukShort, ukTime } from "../demo/format";
import { useView } from "../view.js";

function RecordHeader({ crumbs, title, chips, facts, actions }) {
  useEffect(() => { document.title = `${title} | ${getState().org.name}`; }, [title]);
  return (
    <header>
      <Crumbs items={crumbs} />
      <div className="w-rec-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="w-row" style={{ gap: 12 }}><h1>{title}</h1>{chips}</div>
          {facts && <div className="w-rec-facts">{facts.filter(Boolean).map(([k, v], i) => <span key={i}>{k} <b>{v}</b></span>)}</div>}
        </div>
        {actions && <div className="w-row">{actions}</div>}
      </div>
    </header>
  );
}
const Card = ({ title, children, actions }) => <div className="w-card"><div className="w-row" style={{ marginBottom: 12 }}><h2 style={{ fontSize: 17, flex: 1 }}>{title}</h2>{actions}</div>{children}</div>;
const Pending = ({ refTo }) => {
  const s = useStore();
  const list = q.approvalsFor(s, refTo).filter((a) => a.status === "pending");
  if (!list.length) return null;
  return <div style={{ marginTop: 16 }} className="w-queue-list"><h2 style={{ fontSize: 17 }}>Waiting for your OK</h2>{list.map((a) => <DecisionCard key={a.id} a={a} />)}</div>;
};
const NotFound = ({ what }) => <EmptyState icon="Search" title={`That ${what} isn't here`} body="It may have been removed, or the link is out of date." action={<Button to="/workspace">Back to Home</Button>} />;

/* ---------- Company ---------- */
function CompanyPage({ id }) {
  const s = useStore();
  const { query, path } = useRoute();
  const c = q.company(s, id);
  if (!c) return <NotFound what="company" />;
  const tab = query.t || "overview";
  const contact = s.contacts.find((x) => x.companyId === id);
  const deals = s.deals.filter((x) => x.companyId === id), quotes = s.quotes.filter((x) => x.companyId === id), jobs = s.jobs.filter((x) => x.companyId === id);
  const invoices = s.invoices.filter((x) => x.companyId === id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), convs = s.conversations.filter((x) => x.companyId === id);
  const tabs = [["overview", "Overview"], ["deals", "Deals", deals.length], ["quotes", "Quotes", quotes.length], ["jobs", "Jobs", jobs.length], ["invoices", "Invoices", invoices.length], ["conversations", "Conversations", convs.length], ["files", "Files"]];
  const late = q.lateRun(s, id);
  return (
    <div>
      <RecordHeader crumbs={[["Customers", "/workspace/customers"], [c.status === "lead" ? "Leads" : "Companies", c.status === "lead" ? "/workspace/customers/leads" : "/workspace/customers/pipeline"], [c.short]]}
        title={c.name} chips={<StatusChip tone={c.status === "customer" ? "done" : c.status === "lead" ? "agent" : "neutral"}>{cap(c.status)}</StatusChip>}
        facts={[contact && ["Key contact", <RecordLink refTo={{ type: "contact", id: contact.id }} key="c" />], ["Lifetime value", pounds(q.lifetimeValue(s, id))], ["Pays", c.paymentBehaviour + (late >= 3 ? ` (late ${late} months running)` : "")], ["Where", c.postcode]]} />
      <Tabs label="Company" current={tab} tabs={tabs.map(([k, l, n]) => ({ key: k, label: n !== undefined ? `${l} ${n}` : l, to: path + (k === "overview" ? "" : "?t=" + k) }))} />
      <div className="w-rec-grid">
        <div>
          {tab === "overview" && (
            <div className="w-stack">
              <Card title="About"><dl className="w-dl"><dt>What they are</dt><dd>{c.type}{c.staff ? `, ${c.staff} staff` : ""}</dd><dt>Notes</dt><dd>{c.notes}</dd><dt>Found via</dt><dd>{c.source}</dd>{c.customerSince && <><dt>Customer since</dt><dd>{ukDate(c.customerSince)}</dd></>}{c.email && <><dt>Email</dt><dd>{c.email}</dd></>}</dl></Card>
              <Card title="Open now">
                <ul className="w-related">
                  {invoices.filter(q.isUnpaid).map((i) => <li key={i.id}><RecordLink refTo={{ type: "invoice", id: i.id }} /><span className="tnum">{pounds(i.total)}</span><InvoiceChip invoice={i} /></li>)}
                  {deals.filter((d) => d.stage !== "won" && d.stage !== "lost").map((d) => <li key={d.id}><RecordLink refTo={{ type: "deal", id: d.id }}>{d.title}</RecordLink><StatusChip tone={DEAL_TONE[d.stage]}>{cap(d.stage)}</StatusChip></li>)}
                  {convs.filter((x) => x.status !== "resolved").map((x) => <li key={x.id}><RecordLink refTo={{ type: "conversation", id: x.id }} /><StatusChip tone={CONV_TONE[x.status]}>{cap(x.status)}</StatusChip></li>)}
                  {s.tasks.filter((t) => t.status === "open" && t.linkedRecord?.id === id).map((t) => <li key={t.id}><RecordLink refTo={{ type: "task", id: t.id }} /><StatusChip tone="attn">Task</StatusChip></li>)}
                </ul>
              </Card>
              <Pending refTo={{ type: "company", id }} />
            </div>
          )}
          {tab === "deals" && <List rows={deals} empty="No deals with them yet." render={(d) => [<RecordLink key="l" refTo={{ type: "deal", id: d.id }}>{d.title}</RecordLink>, pounds(d.value) + " a year", <StatusChip key="s" tone={DEAL_TONE[d.stage]}>{cap(d.stage)}</StatusChip>]} />}
          {tab === "quotes" && <List rows={quotes} empty="No quotes sent." render={(x) => [<RecordLink key="l" refTo={{ type: "quote", id: x.id }} />, pounds(x.total), <StatusChip key="s" tone={QUOTE_TONE[x.status]}>{cap(x.status)}</StatusChip>]} />}
          {tab === "jobs" && <List rows={jobs} empty="No jobs booked." render={(j) => [<RecordLink key="l" refTo={{ type: "job", id: j.id }}>{j.title}</RecordLink>, q.scheduleText(j), <StatusChip key="s" tone={j.status === "proposed" ? "attn" : "done"}>{cap(j.status)}</StatusChip>]} />}
          {tab === "invoices" && <List rows={invoices} empty="No invoices yet." render={(i) => [<RecordLink key="l" refTo={{ type: "invoice", id: i.id }} />, pounds(i.total), <InvoiceChip key="s" invoice={i} />]} />}
          {tab === "conversations" && <List rows={convs} empty="No conversations yet." render={(x) => [<RecordLink key="l" refTo={{ type: "conversation", id: x.id }} />, cap(x.channel), <StatusChip key="s" tone={CONV_TONE[x.status]}>{cap(x.status)}</StatusChip>]} />}
          {tab === "files" && <div className="w-card"><EmptyState icon="FileText" title="No files yet" body="Contracts, risk assessments and photos from site visits appear here once they're attached." action={<Button icon="Plus" onClick={() => toast("In your own workspace, files upload here. The demo doesn't keep files.")}>Add a file</Button>} /></div>}
        </div>
        <Card title="Timeline"><Timeline events={q.timelineFor(s, q.companyRefs(s, id))} /></Card>
      </div>
    </div>
  );
}
function List({ rows, render, empty }) {
  if (!rows.length) return <div className="w-card"><EmptyState title={empty} body="When there is one, it shows here and links to its full record." /></div>;
  return <div className="w-card"><ul className="w-related">{rows.map((r) => { const [a, ...rest] = render(r); return <li key={r.id}>{a}{rest.map((x, i) => <span key={i} className="tnum">{x}</span>)}</li>; })}</ul></div>;
}

/* ---------- Invoice ---------- */
function InvoicePage({ id }) {
  const s = useStore();
  const { say } = useView();
  const inv = s.invoices.find((x) => x.id === id);
  const [openMail, setOpenMail] = useState(null);
  if (!inv) return <NotFound what="invoice" />;
  const c = q.company(s, inv.companyId);
  const job = s.jobs.find((j) => j.id === inv.jobId);
  const quote = job?.quoteId ? s.quotes.find((x) => x.id === job.quoteId) : null;
  const deal = quote ? s.deals.find((d) => d.id === quote.dealId) : null;
  return (
    <div>
      <RecordHeader crumbs={[["Money", "/workspace/money"], ["Invoices", "/workspace/money/invoices"], [inv.id]]} title={inv.id} chips={<InvoiceChip invoice={inv} />}
        facts={[["Customer", <RecordLink key="c" refTo={{ type: "company", id: c.id }} />], ["Amount", pounds(inv.total)], ["Issued", ukDate(inv.issuedAt)], ["Due", ukDate(inv.dueAt)], inv.paidAt && ["Paid", ukDate(inv.paidAt)]]}
        actions={q.isUnpaid(inv) && <Button icon="CircleCheck" onClick={() => { const tok = markPaid(inv.id); toast(`${inv.id} marked paid.`, { undo: tok }); }}>Mark paid</Button>} />
      <div className="w-rec-grid">
        <div className="w-stack">
          <Card title="How it got here">
            <ul className="w-related">
              {deal && <li><span>Deal</span><RecordLink refTo={{ type: "deal", id: deal.id }}>{deal.title}</RecordLink></li>}
              {quote && <li><span>Quote</span><RecordLink refTo={{ type: "quote", id: quote.id }} /></li>}
              {job && <li><span>Job</span><RecordLink refTo={{ type: "job", id: job.id }}>{job.title}</RecordLink></li>}
              <li><span>Raised by</span><AgentBadge agentId="agt_fin" /></li>
              <li><span>Chased by</span><AgentBadge agentId="agt_credit" /></li>
            </ul>
          </Card>
          <Card title={inv.status === "paid" ? "How it was chased" : `Chasing (${say("owed").toLowerCase()})`}>
            <ChaseLine inv={inv} />
            <ol className="w-tl" style={{ marginTop: 16 }}>
              {inv.chaseLog.map((ch, i) => {
                const a = ch.approvalId && s.approvals.find((x) => x.id === ch.approvalId);
                return (
                  <li key={i}>
                    <Avatar actor={ch.agentId ? { kind: "agent", id: ch.agentId } : { kind: "person", id: ch.actorId || "p_dana" }} />
                    <div className="w-tl-b">
                      <p>{ch.summary}</p>
                      <div className="w-tl-m">{ch.agentId && <AgentBadge agentId={ch.agentId} />}<span>{ukDate(ch.at)}</span>{a && a.preview.kind === "email" && <button type="button" className="w-link" onClick={() => setOpenMail(openMail === i ? null : i)} aria-expanded={openMail === i}>{openMail === i ? "Hide the email" : "Read the email"}</button>}</div>
                      {openMail === i && a && <div className="w-preview"><div className="w-preview-m"><span>To</span><b>{a.preview.to}</b><span>Subject</span><b>{a.preview.subject}</b></div><p className="w-preview-body is-open">{a.preview.body}</p></div>}
                    </div>
                  </li>
                );
              })}
              {!inv.chaseLog.length && <li><span /><p className="w-sub">No reminders yet.</p></li>}
            </ol>
            <Pending refTo={{ type: "invoice", id }} />
          </Card>
          <InvoiceDoc inv={inv} />
        </div>
        <Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "invoice", id }])} /></Card>
      </div>
    </div>
  );
}

/* ---------- Deal, quote, job ---------- */
function DealPage({ id }) {
  const s = useStore();
  const d = s.deals.find((x) => x.id === id);
  if (!d) return <NotFound what="deal" />;
  const c = q.company(s, d.companyId);
  const quote = s.quotes.find((x) => x.dealId === id);
  const job = quote && s.jobs.find((j) => j.quoteId === quote.id);
  return (
    <div>
      <RecordHeader crumbs={[["Customers", "/workspace/customers"], ["Pipeline", "/workspace/customers/pipeline"], [c.short]]} title={`${c.short}: ${d.title}`} chips={<StatusChip tone={DEAL_TONE[d.stage]}>{cap(d.stage)}</StatusChip>}
        facts={[["Company", <RecordLink key="c" refTo={{ type: "company", id: c.id }} />], ["Value", pounds(d.value) + " a year"], ["Owner", <AgentBadge key="o" agentId={d.ownerId} />], ["Updated", relative(d.updatedAt, s.now > d.updatedAt ? s.now : undefined)]]} />
      <div className="w-rec-grid">
        <div className="w-stack">
          <Card title="Next step"><p>{d.nextStep}</p>
            <div className="w-field" style={{ marginTop: 16, maxWidth: 280 }}><label htmlFor="w-dstage">Stage</label>
              <select id="w-dstage" className="w-input" value={d.stage} onChange={(e) => { const tok = moveDeal(id, e.target.value); if (tok) toast(`Moved to ${cap(e.target.value)}.`, { undo: tok }); }}>{q.STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
            </div>
          </Card>
          <Card title="Linked"><ul className="w-related">
            {quote ? <li><span>Quote</span><RecordLink refTo={{ type: "quote", id: quote.id }} /></li> : <li><span>Quote</span><span className="w-sub">None yet</span></li>}
            {job && <li><span>Job</span><RecordLink refTo={{ type: "job", id: job.id }}>{job.title}</RecordLink></li>}
            {s.conversations.filter((x) => x.companyId === c.id).map((x) => <li key={x.id}><span>Conversation</span><RecordLink refTo={{ type: "conversation", id: x.id }} /></li>)}
          </ul></Card>
          <Pending refTo={{ type: "company", id: c.id }} />
        </div>
        <Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "deal", id }, { type: "company", id: c.id }, ...(quote ? [{ type: "quote", id: quote.id }] : [])])} /></Card>
      </div>
    </div>
  );
}
function QuotePage({ id }) {
  const s = useStore();
  const x = s.quotes.find((y) => y.id === id);
  if (!x) return <NotFound what="quote" />;
  const c = q.company(s, x.companyId);
  const job = s.jobs.find((j) => j.quoteId === id);
  return (
    <div>
      <RecordHeader crumbs={[["Customers", "/workspace/customers"], ["Quotes", "/workspace/customers/quotes"], [x.number]]} title={`Quote ${x.number}`} chips={<StatusChip tone={QUOTE_TONE[x.status]}>{cap(x.status)}</StatusChip>}
        facts={[["For", <RecordLink key="c" refTo={{ type: "company", id: c.id }} />], ["Deal", <RecordLink key="d" refTo={{ type: "deal", id: x.dealId }}>{s.deals.find((d) => d.id === x.dealId)?.title}</RecordLink>], ["Total", pounds(x.total) + " a year"], ["Sent", x.sentAt ? ukDate(x.sentAt) : "Not yet"], job && ["Job", <RecordLink key="j" refTo={{ type: "job", id: job.id }}>{job.title}</RecordLink>]]} />
      <div className="w-rec-grid"><QuoteDoc quote={x} /><Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "quote", id }, { type: "deal", id: x.dealId }])} /></Card></div>
    </div>
  );
}
function JobPage({ id }) {
  const s = useStore();
  const j = s.jobs.find((x) => x.id === id);
  if (!j) return <NotFound what="job" />;
  const c = q.company(s, j.companyId);
  const invs = s.invoices.filter((i) => i.jobId === id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 6);
  return (
    <div>
      <RecordHeader crumbs={[["Work", "/workspace/work"], ["Jobs", "/workspace/work/jobs"], [c.short]]} title={`${c.short}: ${j.title}`} chips={<StatusChip tone={j.status === "proposed" ? "attn" : j.status === "scheduled" ? "agent" : "done"}>{cap(j.status)}</StatusChip>}
        facts={[["Customer", <RecordLink key="c" refTo={{ type: "company", id: c.id }} />], ["When", q.scheduleText(j)], ["Site", j.site], j.monthlyValue && ["Worth", pounds(j.monthlyValue) + " a month"]]} />
      <div className="w-rec-grid">
        <div className="w-stack">
          <Card title="Crew"><ul className="w-related">{j.crewIds.map((p) => <li key={p}><span className="w-row" style={{ gap: 8 }}><Avatar actor={{ kind: "person", id: p }} /><RecordLink refTo={{ type: "person", id: p }} /></span><span className="w-sub">{q.person(s, p)?.role}</span></li>)}</ul></Card>
          <Card title="Linked"><ul className="w-related">
            {j.quoteId && <li><span>Quote</span><RecordLink refTo={{ type: "quote", id: j.quoteId }} /></li>}
            {j.contractId && <li><span>Contract</span><Link to="/workspace/work/contracts" className="w-reflink">{s.contracts.find((x) => x.id === j.contractId)?.title}</Link></li>}
            {invs.map((i) => <li key={i.id}><RecordLink refTo={{ type: "invoice", id: i.id }} /><span className="tnum">{pounds(i.total)}</span><InvoiceChip invoice={i} /></li>)}
            <li><span>Run by</span><AgentBadge agentId="agt_ops" /></li>
          </ul></Card>
          <Pending refTo={{ type: "job", id }} />
        </div>
        <Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "job", id }])} /></Card>
      </div>
    </div>
  );
}

/* ---------- Conversation, contact, bill, task, generic ---------- */
function ConversationPage({ id }) {
  const s = useStore();
  const c = s.conversations.find((x) => x.id === id);
  if (!c) return <NotFound what="conversation" />;
  const draft = q.approvalsFor(s, { type: "conversation", id }).find((a) => a.status === "pending");
  return (
    <div>
      <RecordHeader crumbs={[["Customers", "/workspace/customers"], ["Inbox", "/workspace/customers/inbox"], [c.companyId ? q.company(s, c.companyId).short : "Conversation"]]} title={c.subject} chips={<StatusChip tone={CONV_TONE[c.status]}>{cap(c.status)}</StatusChip>}
        facts={[c.companyId && ["With", <RecordLink key="c" refTo={{ type: "company", id: c.companyId }} />], c.contactId && ["Contact", <RecordLink key="p" refTo={{ type: "contact", id: c.contactId }} />], ["Channel", cap(c.channel)], ["Assigned", <ActorName key="a" actor={c.assignedTo} />]]}
        actions={c.status !== "resolved" ? <Button icon="CircleCheck" onClick={() => { const tok = setConversation(id, "resolved"); toast("Marked resolved.", { undo: tok }); }}>Mark resolved</Button> : <Button onClick={() => setConversation(id, "open")}>Reopen</Button>} />
      <div className="w-rec-grid">
        <div>
          <div className="w-card">{c.messages.map((m) => <div key={m.id} className={"w-msg" + (m.direction === "out" ? " out" : "")}><div className="w-msg-m"><b>{m.from}</b>{m.actor?.kind === "agent" && <AgentBadge agentId={m.actor.id} role={false} />}<span>{ukShort(m.at)}, {ukTime(m.at)}</span></div><p>{m.body}</p></div>)}</div>
          {draft ? <div style={{ marginTop: 16 }}><DecisionCard a={draft} /></div> : c.status !== "resolved" && <div style={{ marginTop: 16 }}><Button icon="Sparkles" onClick={() => { const tok = draftReply(id); toast("Theo drafted a reply.", { undo: tok }); }}>Ask Theo to draft a reply</Button></div>}
        </div>
        <Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "conversation", id }])} /></Card>
      </div>
    </div>
  );
}
function ContactPage({ id }) {
  const s = useStore();
  const p = s.contacts.find((x) => x.id === id);
  if (!p) return <NotFound what="contact" />;
  const c = q.company(s, p.companyId);
  return (
    <div>
      <RecordHeader crumbs={[["Customers", "/workspace/customers"], [c.short, hrefFor({ type: "company", id: c.id })], [p.name]]} title={p.name} facts={[["Role", p.role], ["At", <RecordLink key="c" refTo={{ type: "company", id: c.id }} />], p.email && ["Email", p.email], p.phone && ["Phone", p.phone]]} />
      <div className="w-rec-grid"><Card title="Conversations"><ul className="w-related">{s.conversations.filter((x) => x.contactId === id).map((x) => <li key={x.id}><RecordLink refTo={{ type: "conversation", id: x.id }} /><StatusChip tone={CONV_TONE[x.status]}>{cap(x.status)}</StatusChip></li>)}</ul></Card><Card title="Timeline"><Timeline events={q.timelineFor(s, s.conversations.filter((x) => x.contactId === id).map((x) => ({ type: "conversation", id: x.id })))} /></Card></div>
    </div>
  );
}
function BillPage({ id }) {
  const s = useStore();
  const b = s.bills.find((x) => x.id === id);
  if (!b) return <NotFound what="bill" />;
  const st = b.status !== "paid" && Date.parse(b.dueAt) < Date.parse(s.now) ? "overdue" : b.status;
  return (
    <div>
      <RecordHeader crumbs={[["Money", "/workspace/money"], ["Bills", "/workspace/money/bills"], [b.supplier]]} title={`${b.supplier}: ${b.category}`} chips={<StatusChip tone={BILL_TONE[st]}>{cap(st)}</StatusChip>} facts={[["Amount", pounds(b.total)], ["Due", ukDate(b.dueAt)], b.paidAt && ["Paid", ukDate(b.paidAt)], ["Recorded by", <AgentBadge key="a" agentId="agt_fin" />]]} />
      <div className="w-rec-grid"><div><Pending refTo={{ type: "bill", id }} />{st !== "paid" && !q.approvalsFor(s, { type: "bill", id }).some((a) => a.status === "pending") && <p className="w-sub">Fern drafts the payment a few days before it's due.</p>}</div><Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "bill", id }])} /></Card></div>
    </div>
  );
}
function TaskPage({ id }) {
  const s = useStore();
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return <NotFound what="task" />;
  return (
    <div>
      <RecordHeader crumbs={[["Work", "/workspace/work"], ["Tasks", "/workspace/work/tasks"], [t.title]]} title={t.title} chips={<StatusChip tone={t.status === "done" ? "done" : "attn"}>{t.status === "done" ? "Done" : "Open"}</StatusChip>}
        facts={[["For", <ActorName key="a" actor={t.assignee} />], ["Due", t.dueAt ? `${ukDay(t.dueAt)}, ${ukTime(t.dueAt)}` : "No date"], ["Added by", <ActorName key="b" actor={t.createdBy} />], t.linkedRecord && ["About", <RecordLink key="r" refTo={t.linkedRecord} />]]}
        actions={<Button variant={t.status === "open" ? "primary" : undefined} icon="Check" onClick={() => { const tok = setTask(id, t.status === "open"); toast(t.status === "open" ? "Ticked off." : "Reopened.", { undo: tok }); }}>{t.status === "open" ? "Mark done" : "Reopen"}</Button>} />
      <div className="w-rec-grid"><Card title="Detail"><p>{t.detail || "No detail added."}</p></Card><Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "task", id }])} /></Card></div>
    </div>
  );
}
function GenericPage({ id, hub }) {
  const s = useStore();
  const r = s.records.find((x) => x.id === id);
  if (!r) return <NotFound what="record" />;
  const app = APPS.find((a) => a.key === r.appKey);
  const task = s.tasks.find((t) => t.linkedRecord?.id === id);
  return (
    <div>
      <RecordHeader crumbs={[[hubDef(hub).name, "/workspace/" + hub], [app.name, `/workspace/${hub}/${app.key}`], [r.title]]} title={r.title} chips={<StatusChip tone={/needs|open|low/i.test(r.status) ? "attn" : "neutral"}>{r.status}</StatusChip>}
        facts={[r.ownerId && ["Owner", <RecordLink key="o" refTo={{ type: "person", id: r.ownerId }} />], r.companyId && ["Site", <RecordLink key="c" refTo={{ type: "company", id: r.companyId }} />], r.dueAt && ["Due", ukDate(r.dueAt)], app.agentId && ["Kept by", <AgentBadge key="a" agentId={app.agentId} />]]} />
      <div className="w-rec-grid"><Card title="Detail"><p>{r.detail}</p>{task && <p style={{ marginTop: 12 }}>Task: <RecordLink refTo={{ type: "task", id: task.id }} /></p>}</Card><Card title="Timeline"><Timeline events={q.timelineFor(s, [{ type: "record", id }])} /></Card></div>
    </div>
  );
}

/* ---------- People and agents ---------- */
function PersonPage({ id }) {
  const s = useStore();
  const p = q.person(s, id);
  if (!p) return <NotFound what="person" />;
  const jobs = s.jobs.filter((j) => j.crewIds.includes(id));
  const tasks = s.tasks.filter((t) => t.assignee.id === id && t.status === "open");
  return (
    <div>
      <RecordHeader crumbs={[["Team", "/workspace/team"], ["People", "/workspace/team/roster"], [p.name]]} title={p.name} chips={<Avatar actor={{ kind: "person", id }} />} facts={[["Role", p.role], ["Started", ukDate(p.startedOn)], ["Email", p.email], ["Phone", p.phone]]} />
      <div className="w-rec-grid">
        <div className="w-stack">
          <Card title="Regular jobs">{jobs.length ? <ul className="w-related">{jobs.map((j) => <li key={j.id}><RecordLink refTo={{ type: "job", id: j.id }}>{q.company(s, j.companyId).short}</RecordLink><span className="w-sub">{q.scheduleText(j)}</span></li>)}</ul> : <p className="w-sub">Not on any regular jobs.</p>}</Card>
          <Card title="Open tasks">{tasks.length ? <ul className="w-related">{tasks.map((t) => <li key={t.id}><RecordLink refTo={{ type: "task", id: t.id }} /><span className="w-sub">{t.dueAt ? ukDay(t.dueAt) : ""}</span></li>)}</ul> : <p className="w-sub">Nothing open.</p>}</Card>
        </div>
        <Card title="Timeline"><Timeline events={s.activity.filter((e) => e.actor.kind === "person" && e.actor.id === id).slice(0, 30)} /></Card>
      </div>
    </div>
  );
}
function AgentPage({ id }) {
  const s = useStore();
  const a = q.agent(s, id);
  const [limits, setLimits] = useState({});
  if (!a) return <NotFound what="agent" />;
  const st = q.agentStats(s, id);
  const recent = s.activity.filter((e) => e.actor.kind === "agent" && e.actor.id === id).slice(0, 12);
  return (
    <div>
      <RecordHeader crumbs={[["Team", "/workspace/team"], ["Agents", "/workspace/team/roster"], [a.name]]} title={`${a.name} · ${a.roleName}`} chips={<StatusChip tone="agent">{s.paused ? "Paused" : "Agent"}</StatusChip>}
        facts={[["Actions this week", st.actionsThisWeek], ["Approval rate", st.approvalRate === null ? "No decisions yet" : pct(st.approvalRate)], ["Time saved this week", mins(st.minutesSavedThisWeek)], ["Waiting for you", st.waiting]]} />
      <p style={{ marginTop: 12, color: "var(--text-secondary)", maxWidth: "70ch" }}>{a.description}{a.subAgents.length ? ` Uses ${a.subAgents.join(" and ")} for parts of the work.` : ""}</p>
      <div className="w-rec-grid">
        <div className="w-stack">
          <Card title="Works in">
            <ul className="w-related">{st.apps.map((x) => <li key={x.key}><Link to={`/workspace/${x.hub}/${x.key}`} className="w-reflink">{appName(x, s.prefs.view)}</Link><span className="w-sub">{hubDef(x.hub).name}</span></li>)}</ul>
          </Card>
          <Card title="What it may do without asking">
            {a.autonomy.map((r) => {
              const lim = limits[r.type] ?? (r.maxValue ? r.maxValue / 100 : "");
              return (
                <div key={r.type} className="w-rule">
                  <div><b style={{ fontWeight: 500 }}>{r.label}</b><div className="w-sub">{r.mode === "auto" ? `Does it on its own${r.maxValue ? ` under ${pounds(r.maxValue)}` : ""}, and tells you after` : "Asks you first, every time"}</div></div>
                  <div className="w-rule-c">
                    <label className="w-toggle"><input type="checkbox" checked={r.mode === "auto"} onChange={(e) => { const tok = setAutonomy(id, r.type, e.target.checked ? "auto" : "ask", r.maxValue); toast("Rule changed.", { undo: tok }); }} aria-label={`${a.name} may ${r.label.toLowerCase()} without asking`} /><span className="w-sub">On its own</span></label>
                    {r.mode === "auto" && ["send_reminder", "pay_bill", "send_invoice"].includes(r.type) && (
                      <form onSubmit={(e) => { e.preventDefault(); const v = Math.round(Number(String(lim).replace(/[£,]/g, "")) * 100); const tok = setAutonomy(id, r.type, "auto", v > 0 ? v : null); toast(v > 0 ? `Limit set to ${pounds(v)}.` : "Limit removed.", { undo: tok }); }} className="w-row" style={{ gap: 6 }}>
                        <label className="sr-only" htmlFor={"lim-" + r.type}>Limit in pounds</label>
                        <span className="w-sub">under £</span><input id={"lim-" + r.type} className="w-input" inputMode="decimal" value={lim} onChange={(e) => setLimits({ ...limits, [r.type]: e.target.value })} placeholder="No limit" />
                        <Button size="sm" type="submit">Set</Button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
        <Card title="Recent actions">
          <ul className="w-feed">{recent.map((e) => { const tok = e.undoable ? undoTokenForEvent(e.id) : null; return <li key={e.id}><div className="w-feed-b"><p>{e.verb}</p><p className="w-feed-m">{relative(e.at, s.now > e.at ? s.now : undefined)}{e.linkedRecord && <> · <RecordLink refTo={e.linkedRecord} /></>}</p></div>{tok && <Button size="sm" icon="Undo2" onClick={() => { undo(tok); toast("Undone."); }}>Undo</Button>}</li>; })}</ul>
          {!recent.length && <EmptyState icon="Bot" title="Nothing yet" body={`What ${a.name} does shows here, with Undo where it can be reversed.`} />}
        </Card>
      </div>
    </div>
  );
}

/** /workspace/:hub/:tab/:id → the right record page. */
export function RecordPage({ hub, tab, id }) {
  const P = {
    companies: CompanyPage, contacts: ContactPage, pipeline: DealPage, leads: CompanyPage, quotes: QuotePage, inbox: ConversationPage,
    invoices: InvoicePage, owed: InvoicePage, bills: BillPage, jobs: JobPage, tasks: TaskPage, people: PersonPage, agents: AgentPage, roster: PersonPage,
  }[tab];
  if (P) return <P id={decodeURIComponent(id)} />;
  if (APPS.some((a) => a.key === tab)) return <GenericPage id={id} hub={hub} />;
  return <NotFound what="page" />;
}
export { navigate };
