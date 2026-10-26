// Customers: the pipeline board (drag a deal to move it), leads, quotes and a three-pane inbox.
import React, { useState } from "react";
import { navigate, useRoute } from "../../router.jsx";
import { Icon, toast, useStore } from "../core.jsx";
import { AgentBadge, ActorName, Button, CONV_TONE, DEAL_TONE, DataTable, EmptyState, FilterChips, MetricTile, QUOTE_TONE, RecordDrawer, RecordLink, StatusChip, cap } from "../ui.jsx";
import { DecisionCard } from "../DecisionCard.jsx";
import { HubFrame, useTab } from "./Hub.jsx";
import { GenericApp } from "./Money.jsx";
import { Summary } from "../records/Summary.jsx";
import { draftReply, moveDeal, setConversation } from "../demo/store";
import * as q from "../demo/selectors";
import { plural, pounds, poundsRound, relative, ukShort } from "../demo/format";

function Pipeline() {
  const s = useStore();
  const [open, setOpen] = useState(null);
  const [over, setOver] = useState(null);
  const [drag, setDrag] = useState(null);
  const stages = q.STAGES.filter((x) => x.key !== "lost");
  const showWon = (d) => d.stage !== "won" || (d.value > 0 && Date.parse(d.updatedAt) > Date.parse(s.now) - 30 * 86400e3);
  const drop = (stage) => {
    setOver(null);
    if (!drag) return;
    const d = s.deals.find((x) => x.id === drag);
    const tok = moveDeal(drag, stage);
    setDrag(null);
    if (tok) toast(`${q.company(s, d.companyId).short} moved to ${cap(stage)}.`, { undo: tok });
  };
  return (
    <>
      <p className="w-sub" style={{ marginBottom: 12 }}>Forecast {pounds(q.forecast(s))} a year from {pounds(q.pipelineValue(s))} in open deals, weighted by stage. Drag a deal to move it, or open it to change its stage.</p>
      <div className="w-board" role="list" aria-label="Pipeline by stage">
        {stages.map((st) => {
          const list = s.deals.filter((d) => d.stage === st.key && showWon(d)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return (
            <div key={st.key} role="listitem" className={"w-col" + (over === st.key ? " is-over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(st.key); }} onDragLeave={() => setOver(null)} onDrop={() => drop(st.key)} aria-label={`${st.label}: ${list.length} deals`}>
              <div className="w-col-h"><b>{st.label}</b><StatusChip tone={DEAL_TONE[st.key]}>{list.length}</StatusChip><span className="tnum">{poundsRound(list.reduce((n, d) => n + d.value, 0))}</span></div>
              {list.map((d) => (
                <button key={d.id} type="button" className={"w-deal" + (drag === d.id ? " is-drag" : "")} draggable onDragStart={(e) => { setDrag(d.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", d.id); }} onDragEnd={() => setDrag(null)} onClick={() => setOpen(d.id)}>
                  <b>{q.company(s, d.companyId).short}</b>
                  <small>{d.title}</small>
                  <span className="w-deal-v"><span className="tnum">{poundsRound(d.value)}/yr</span><span className="w-sub">{relative(d.updatedAt, s.now > d.updatedAt ? s.now : undefined)}</span></span>
                  <small style={{ color: "var(--text-secondary)" }}>Next: {d.nextStep}</small>
                </button>
              ))}
              {!list.length && <p className="w-sub" style={{ padding: 8 }}>No deals here. Drag one in.</p>}
            </div>
          );
        })}
      </div>
      {open && (
        <RecordDrawer refTo={{ type: "deal", id: open }} onClose={() => setOpen(null)}>
          <Summary refTo={{ type: "deal", id: open }} />
          <div className="w-field" style={{ marginTop: 20 }}>
            <label htmlFor="w-stage">Move to stage</label>
            <select id="w-stage" className="w-input" value={s.deals.find((d) => d.id === open).stage} onChange={(e) => { const tok = moveDeal(open, e.target.value); if (tok) toast(`Moved to ${cap(e.target.value)}.`, { undo: tok }); }}>
              {q.STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
        </RecordDrawer>
      )}
    </>
  );
}

function Leads() {
  const s = useStore();
  const { query, path } = useRoute();
  const f = query.f || "week";
  const [open, setOpen] = useState(null);
  const week = q.newLeadsThisWeek(s), all = q.leads(s);
  const rows = (f === "week" ? week : f === "lost" ? s.companies.filter((c) => c.status === "lost") : all).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const replied = new Set(q.repliesThisWeek(s).map((c) => c.companyId));
  return (
    <>
      <FilterChips label="Show leads" value={f} onChange={(v) => navigate(path + (v === "week" ? "" : "?f=" + v))} options={[["week", "New this week", week.length], ["all", "All open leads", all.length], ["lost", "Lost", s.companies.filter((c) => c.status === "lost").length]]} />
      <DataTable caption="Leads" columns={[
        { key: "n", label: "Company", sort: (r) => r.name, render: (r) => <><span className="w-cell-main">{r.name}</span><span className="w-cell-sub">{r.type}{r.staff ? `, ${r.staff} staff` : ""}</span></> },
        { key: "p", label: "Area", sort: (r) => r.postcode, render: (r) => r.postcode.split(" ")[0], hideMobile: true },
        { key: "src", label: "Found via", render: (r) => r.source, hideMobile: true },
        { key: "st", label: "Where it's at", render: (r) => { const pend = s.approvals.find((a) => a.status === "pending" && a.linkedRecord.id === r.id); const d = s.deals.find((x) => x.companyId === r.id); return pend ? <StatusChip tone="attn">Email waiting for you</StatusChip> : replied.has(r.id) ? <StatusChip tone="done">Replied</StatusChip> : d ? <StatusChip tone={DEAL_TONE[d.stage]}>{cap(d.stage)}</StatusChip> : <StatusChip>New</StatusChip>; } },
        { key: "a", label: "Added", sort: (r) => r.createdAt, render: (r) => relative(r.createdAt, s.now) },
      ]} rows={rows} onRow={(r) => setOpen(r.id)} empty={<EmptyState icon="Target" title="No new leads this week" body="Maya looks for companies that fit every weekday morning; new ones appear here." action={<Button onClick={() => navigate(path + "?f=all")}>Show all leads</Button>} />} />
      {open && <RecordDrawer refTo={{ type: "company", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "company", id: open }} /></RecordDrawer>}
    </>
  );
}

function Quotes() {
  const s = useStore();
  const [open, setOpen] = useState(null);
  const unanswered = new Set(q.quotesUnanswered(s).map((x) => x.id));
  return (
    <>
      <DataTable caption="Quotes" initialSort={{ key: "sent", dir: "desc" }} columns={[
        { key: "n", label: "Quote", sort: (r) => r.number, render: (r) => <span className="w-cell-main mono">{r.number}</span> },
        { key: "c", label: "For", sort: (r) => q.company(s, r.companyId).name, render: (r) => <RecordLink refTo={{ type: "company", id: r.companyId }} /> },
        { key: "t", label: "A year", num: true, sort: (r) => r.total, render: (r) => pounds(r.total) },
        { key: "sent", label: "Sent", sort: (r) => r.sentAt || "9", render: (r) => (r.sentAt ? ukShort(r.sentAt) : "Not yet") },
        { key: "st", label: "Status", render: (r) => <span className="w-row" style={{ gap: 6 }}><StatusChip tone={QUOTE_TONE[r.status]}>{cap(r.status)}</StatusChip>{unanswered.has(r.id) && <StatusChip tone="attn">No answer in 5+ days</StatusChip>}</span> },
      ]} rows={s.quotes} onRow={(r) => setOpen(r.id)} empty={<EmptyState icon="FileText" title="No quotes yet" body="Maya prices quotes from your rates when a lead asks; they appear here before they're sent." />} />
      {open && <RecordDrawer refTo={{ type: "quote", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "quote", id: open }} /></RecordDrawer>}
    </>
  );
}

function Inbox() {
  const s = useStore();
  const { query, path } = useRoute();
  const f = query.f || "open";
  const counts = q.inboxCounts(s);
  const list = s.conversations.filter((c) => (f === "open" ? c.status === "new" || c.status === "open" : c.status === f)).sort((a, b) => b.messages.at(-1).at.localeCompare(a.messages.at(-1).at)).slice(0, 30);
  const sel = s.conversations.find((c) => c.id === query.c);
  const go = (o) => navigate(path + "?" + new URLSearchParams({ ...query, ...o }).toString());
  const draft = sel && s.approvals.find((a) => a.status === "pending" && a.linkedRecord.type === "conversation" && a.linkedRecord.id === sel.id);
  return (
    <>
      <FilterChips label="Show conversations" value={f} onChange={(v) => go({ f: v, c: "" })} options={[["open", "New and open", counts.new + counts.open], ["new", "New", counts.new], ["waiting", "Waiting on them", counts.waiting], ["resolved", "Resolved", counts.resolved]]} />
      <div className={"w-inbox" + (sel ? " has-sel" : "")}>
        <div className="w-pane w-pane-list" aria-label="Conversations">
          {list.map((c) => (
            <button key={c.id} type="button" className="w-conv" aria-current={sel?.id === c.id} onClick={() => go({ c: c.id })}>
              <span className="w-row" style={{ gap: 8, flexWrap: "nowrap" }}><b style={{ flex: 1 }}>{c.companyId ? q.company(s, c.companyId).short : c.messages[0].from}</b>{c.status === "new" && <StatusChip tone="attn">New</StatusChip>}</span>
              <p>{c.subject}</p>
              <p>{cap(c.channel)} · {relative(c.messages.at(-1).at, s.now > c.messages.at(-1).at ? s.now : undefined)}</p>
            </button>
          ))}
          {!list.length && <EmptyState icon="Inbox" title="Nothing here" body="Emails, web forms and call notes land here, and Theo drafts a reply." />}
        </div>
        <div className="w-pane" aria-label="Conversation">
          {sel ? (
            <>
              <div className="w-pane-h">
                <Button size="sm" variant="ghost" icon="ChevronLeft" className="w-only-m" onClick={() => go({ c: "" })}>Back</Button>
                <b style={{ flex: 1, minWidth: 0 }}>{sel.subject}</b>
                <StatusChip tone={CONV_TONE[sel.status]}>{cap(sel.status)}</StatusChip>
              </div>
              <div className="w-pane-b">
                <p className="w-sub" style={{ marginBottom: 12 }}>{sel.companyId && <><RecordLink refTo={{ type: "company", id: sel.companyId }} /> · </>}{cap(sel.channel)} · assigned to <ActorName actor={sel.assignedTo} /> · <RecordLink refTo={{ type: "conversation", id: sel.id }} className="w-link">Full record</RecordLink></p>
                {sel.messages.map((m) => (
                  <div key={m.id} className={"w-msg" + (m.direction === "out" ? " out" : "")}>
                    <div className="w-msg-m"><b>{m.from}</b>{m.actor?.kind === "agent" && <AgentBadge agentId={m.actor.id} role={false} />}<span>{relative(m.at, s.now > m.at ? s.now : undefined)}</span></div>
                    <p>{m.body}</p>
                  </div>
                ))}
                <div className="w-row" style={{ marginTop: 16 }}>
                  {sel.status !== "resolved" ? <Button size="sm" icon="CircleCheck" onClick={() => { const tok = setConversation(sel.id, "resolved"); toast("Marked resolved.", { undo: tok }); }}>Mark resolved</Button>
                    : <Button size="sm" onClick={() => setConversation(sel.id, "open")}>Reopen</Button>}
                </div>
              </div>
            </>
          ) : <EmptyState icon="MessageCircle" title="Pick a conversation" body="The thread opens here, with Theo's drafted reply alongside." />}
        </div>
        <div className="w-pane w-pane-draft" aria-label="Drafted reply">
          <div className="w-pane-h"><Icon name="Bot" size={16} /><b>Drafted reply</b></div>
          <div className="w-pane-b">
            {!sel ? <p className="w-sub">Choose a conversation to see what Theo would send.</p>
              : draft ? <DecisionCard a={draft} />
              : sel.status === "resolved" ? <p className="w-sub">Resolved. Nothing to send.</p>
              : <EmptyState icon="Pencil" title="No draft yet" body="Theo hasn't drafted a reply to this one." action={<Button variant="primary" icon="Sparkles" onClick={() => { const tok = draftReply(sel.id); toast("Theo drafted a reply for you to check.", { undo: tok }); }}>Ask Theo to draft one</Button>} />}
          </div>
        </div>
      </div>
    </>
  );
}

const VIEWS = { pipeline: Pipeline, leads: Leads, quotes: Quotes, inbox: Inbox };

export function Customers({ tab }) {
  const s = useStore();
  const app = useTab("customers", tab);
  const V = app && VIEWS[app.key];
  const c = q.inboxCounts(s);
  const metrics = [
    <MetricTile key="l" label="New leads this week" value={q.newLeadCount(s)} to="/workspace/customers/leads" sub={`${q.repliesThisWeek(s).length} replies, ${q.repliesToday(s).length} today`} />,
    <MetricTile key="p" label="Open pipeline" value={poundsRound(q.pipelineValue(s))} to="/workspace/customers/pipeline" sub={`Forecast ${poundsRound(q.forecast(s))} a year`} />,
    <MetricTile key="w" label="Won this week" value={q.wonThisWeek(s).length} tone={q.wonThisWeek(s).length ? "done" : undefined} to="/workspace/customers/pipeline" sub={q.wonThisWeek(s).map((d) => q.company(s, d.companyId).short).join(", ") || "None yet"} />,
    <MetricTile key="q" label="Quotes waiting 5+ days" value={q.quotesUnanswered(s).length} tone={q.quotesUnanswered(s).length ? "attn" : undefined} to="/workspace/customers/quotes" sub={plural(s.quotes.filter((x) => x.status === "sent").length, "quote") + " out"} />,
    <MetricTile key="i" label="Inbox to answer" value={c.new + c.open} to="/workspace/customers/inbox" sub={`${c.new} new`} />,
  ];
  return <HubFrame hub="customers" tab={app?.key} metrics={metrics}>{V ? <V /> : <GenericApp app={app} />}</HubFrame>;
}
