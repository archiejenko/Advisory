// Today: the workspace home. What needs you (approve in one go), what came in, what's at risk, how the week is going.
// And How we work: the house rules every agent follows, learned from your edits or added by you.
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "../router.jsx";
import { useWs, useCan } from "../layout.jsx";
import { Glyph } from "../kit.jsx";
import { api, useApi, useAction, pounds, dateOf } from "../api.js";
import { Shell, Notice, Loading, Failed, changed } from "./Live.jsx";
import { since, FirstAgent, ResearchAsk } from "./Ws.jsx";

const londonDate = () => new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const greeting = () => {
  const h = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function WsToday() {
  const { me } = useWs();
  const can = useCan();
  const { data: d, error, loading, reload } = useApi("/api/ws/today");
  const mine = useApi("/api/ws/my-agents");
  const [picked, setPicked] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState("");
  const act = useAction();
  const approvals = d?.needs_you.approvals || [];
  useEffect(() => { setPicked(new Set(approvals.map((a) => a.id))); }, [approvals.map((a) => a.id).join()]);
  const first = me.user.name ? me.user.name.split(" ")[0] : null;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const decide = (decision, ids) => act.run(async () => {
    const r = await api("POST", "/api/ws/actions/batch", { ids, decision });
    setNote(decision === "approve"
      ? `Sent ${plural(r.done, "email")}${r.failed ? `; ${r.failed} couldn't be sent and ${r.failed === 1 ? "is" : "are"} still waiting` : ""}.`
      : `Rejected ${plural(r.done, "draft")}. Nothing was sent.`);
    await reload(); changed();
  });
  const rule = (id, status) => act.run(async () => { await api("PATCH", `/api/ws/rules/${id}`, { status }); setNote(status === "active" ? "Rule saved. Every agent follows it from now on." : "Dismissed."); await reload(); });
  const ids = [...picked].filter((id) => approvals.some((a) => a.id === id));

  return (
    <Shell title={`${greeting()}${first ? ", " + first : ""}`} crumbs={[["Today"]]} actions={can("manager") && <Link to="/workspace/agents?s=hire" className="btn btn-sm">Hire an agent</Link>}>
      {error && <Failed error={error} retry={reload} />}
      {(loading && !d) || !mine.data ? <Loading /> : mine.data.agents.length === 0 ? <FirstAgent /> : d && (
        <div className="td">
          <p className="td-date">{londonDate()}</p>
          <p className="td-head" aria-live="polite">{d.headline}</p>
          <Notice>{note}</Notice>
          {act.error && <Notice signal>{act.error}</Notice>}
          <ResearchAsk agents={mine.data.agents} />

          <section className="td-card" aria-labelledby="td-needs">
            <div className="td-card-h"><h2 id="td-needs" className="h-sub">Needs you</h2>{d.needs_you.total > 0 && <span className="td-count">{d.needs_you.total}</span>}</div>
            {d.needs_you.total === 0 && <p className="empty">All clear. Drafts, tasks and anything at risk appear here as they come up.</p>}

            {approvals.length > 0 && (
              <div className="td-block">
                <div className="td-block-h">
                  <h3 className="td-sh">{plural(approvals.length, "email")} to approve</h3>
                  {can("manager") && (
                    <div className="td-bulk">
                      <button className="btn btn-sm" disabled={act.busy || !ids.length} onClick={() => decide("approve", ids)}>{act.busy ? "Sending…" : ids.length === approvals.length ? `Approve all ${ids.length}` : `Approve ${ids.length}`}</button>
                      <button className="btn btn-sm btn-line" disabled={act.busy || !ids.length} onClick={() => decide("reject", ids)}>Reject</button>
                    </div>
                  )}
                </div>
                <ul className="td-list">
                  {approvals.map((a) => (
                    <li key={a.id} className={"td-item" + (open === a.id ? " is-open" : "")}>
                      {can("manager") && <input type="checkbox" className="td-pick" checked={picked.has(a.id)} onChange={() => toggle(a.id)} aria-label={"Include " + a.title} />}
                      <button className="td-item-b" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                        <span className="td-item-t"><b>{a.title}</b><span className="dt">{a.agent}, {since(a.created_at)}</span></span>
                        {a.reason && <span className="td-item-r">{a.reason}</span>}
                      </button>
                      {open === a.id && (
                        <div className="td-mail">
                          <p className="dt">To <span className="mono">{a.payload.to}</span></p>
                          <p><b>{a.payload.subject}</b></p>
                          <p className="pre">{a.payload.body}</p>
                          <Link to={"/workspace/approvals?a=" + a.id} className="link link-s">Edit before sending</Link>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {d.needs_you.rules.length > 0 && (
              <div className="td-block">
                <h3 className="td-sh">Learned from your edits</h3>
                <ul className="td-list">
                  {d.needs_you.rules.map((r) => (
                    <li key={r.id} className="td-rule">
                      <span>{r.text}</span>
                      {can("manager") && <span className="td-rule-a"><button className="btn btn-sm" disabled={act.busy} onClick={() => rule(r.id, "active")}>Keep</button><button className="btn btn-sm btn-line" disabled={act.busy} onClick={() => rule(r.id, "dismissed")}>Dismiss</button></span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {d.at_risk.alerts.filter((a) => a.severity === "Critical").length > 0 && (
              <div className="td-block">
                <h3 className="td-sh">At risk</h3>
                <ul className="td-list">{d.at_risk.alerts.filter((a) => a.severity === "Critical").map((a) => <li key={a.id}><Link to={"/workspace/alerts?a=" + a.id} className="td-row td-row-alert"><span className="sev sev-crit">Critical</span><span>{a.name || a.number}: {a.title}</span></Link></li>)}</ul>
              </div>
            )}

            {d.needs_you.tasks.length > 0 && (
              <div className="td-block">
                <h3 className="td-sh">Tasks for you</h3>
                <ul className="td-list">{d.needs_you.tasks.map((t) => <li key={t.id}><Link to="/workspace/tasks" className="td-row"><span>{t.title}</span><span className="dt">{t.agent || "You"}{t.due_date ? ", due " + dateOf(t.due_date) : ""}</span></Link></li>)}</ul>
              </div>
            )}

            {d.needs_you.failed.length > 0 && (
              <div className="td-block">
                <h3 className="td-sh">Stopped with a problem</h3>
                <ul className="td-list">{d.needs_you.failed.map((r) => <li key={r.id}><Link to={"/workspace/runs/" + r.id} className="td-row"><span>{r.agent}: {r.error || "Stopped"}</span><span className="dt">{since(r.finished_at)}</span></Link></li>)}</ul>
              </div>
            )}
          </section>

          <div className="td-grid">
            <section className="td-card" aria-labelledby="td-money">
              <h2 id="td-money" className="h-sub">Money</h2>
              <div className="td-nums">
                <Link to="/workspace/invoices" className={"td-num" + (d.at_risk.overdue_pence ? " is-hot" : "")}><b>{pounds(d.at_risk.overdue_pence)}</b><span>overdue{d.at_risk.overdue_count ? `, ${plural(d.at_risk.overdue_count, "invoice")}` : ""}</span></Link>
                <Link to="/workspace/invoices" className="td-num"><b>{pounds(d.money.due_this_week_pence)}</b><span>due in the next 7 days</span></Link>
              </div>
              {d.at_risk.oldest_unpaid_days > 0 && <p className="dt">Oldest unpaid: {plural(d.at_risk.oldest_unpaid_days, "day")} late.</p>}
            </section>

            <section className="td-card" aria-labelledby="td-in">
              <h2 id="td-in" className="h-sub">Came in</h2>
              <div className="td-nums">
                <Link to="/workspace/inbox" className="td-num"><b>{d.came_in.inbox_new}</b><span>new {d.came_in.inbox_new === 1 ? "message" : "messages"}</span></Link>
                <Link to="/workspace/leads?status=replied" className="td-num"><b>{d.came_in.replies}</b><span>{d.came_in.replies === 1 ? "reply" : "replies"} today</span></Link>
                <Link to="/workspace/leads" className="td-num"><b>{d.came_in.leads}</b><span>new {d.came_in.leads === 1 ? "lead" : "leads"} today</span></Link>
              </div>
              {d.came_in.messages.length > 0 && <ul className="td-list td-list-s">{d.came_in.messages.slice(0, 3).map((m) => <li key={m.id}><Link to="/workspace/inbox" className="td-row"><span>{m.subject || m.from_addr}</span><span className="dt">{since(m.received_at)}</span></Link></li>)}</ul>}
            </section>
          </div>

          <section className="td-card" aria-labelledby="td-week">
            <h2 id="td-week" className="h-sub">This week</h2>
            <div className="td-nums td-nums-4">
              {[["replies", "Replies"], ["won", "New customers"], ["new_leads", "New leads"], ["emails_sent", "Emails sent"]].map(([k, t]) => <div key={k} className="td-num"><b>{d.week[k]}</b><span>{t}</span></div>)}
            </div>
            {d.next_runs.length > 0 && <p className="dt">Next up: {d.next_runs.map((a) => `${a.name} ${since(a.next_run_at)}`).join(" · ")}.</p>}
          </section>

          <p className="td-foot"><Link to="/floor" className="link link-s">Open the Floor</Link><Link to="/workspace/rules" className="link link-s">How we work</Link><Link to="/workspace/overview" className="link link-s">Agents and activity</Link></p>
        </div>
      )}
    </Shell>
  );
}

export function WsRules() {
  const can = useCan();
  const { data, error, loading, reload } = useApi("/api/ws/rules");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const act = useAction();
  const rules = data?.rules || [];
  const add = (e) => {
    e.preventDefault();
    if (text.trim().length < 4) return act.setError("Say the rule in a few words, for example “Never email anyone on a Sunday”.");
    act.run(async () => { const r = await api("POST", "/api/ws/rules", { text: text.trim() }); setText(""); setNote(r.duplicate ? "You already have that rule." : "Rule saved. Every agent follows it from now on."); await reload(); });
  };
  const set = (id, status) => act.run(async () => { await api("PATCH", `/api/ws/rules/${id}`, { status }); setNote(status === "active" ? "Rule saved." : "Removed. Agents stop following it from their next run."); await reload(); });
  const proposed = rules.filter((r) => r.status === "proposed"), active = rules.filter((r) => r.status === "active");
  return (
    <Shell title="How we work" crumbs={[["How we work"]]}>
      <p className="body ws-intro">House rules every agent follows in everything it writes and does. Add your own, or keep the ones learned when you edit a draft before sending it. You can also say one to the command bar: “rule: never email anyone on a Sunday”.</p>
      <Notice>{note}</Notice>
      {act.error && <Notice signal>{act.error}</Notice>}
      {error && <Failed error={error} retry={reload} />}
      {can("manager") && (
        <form className="askbar" onSubmit={add} noValidate>
          <label htmlFor="rule" className="askbar-l"><Glyph name="check" size={20} />Add a rule</label>
          <input id="rule" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Always mention the free first clean" />
          <button className="btn btn-sm" disabled={act.busy}>{act.busy ? "Saving…" : "Add"}</button>
        </form>
      )}
      {loading && !data ? <Loading /> : (
        <>
          {proposed.length > 0 && (
            <section className="panel">
              <div className="panel-h"><h2 className="h-sub">Learned from your edits</h2></div>
              <ul className="td-list">{proposed.map((r) => (
                <li key={r.id} className="td-rule"><span>{r.text}<span className="dt"> · {since(r.created_at)}</span></span>
                  {can("manager") && <span className="td-rule-a"><button className="btn btn-sm" disabled={act.busy} onClick={() => set(r.id, "active")}>Keep</button><button className="btn btn-sm btn-line" disabled={act.busy} onClick={() => set(r.id, "dismissed")}>Dismiss</button></span>}
                </li>))}
              </ul>
            </section>
          )}
          <section className="panel">
            <div className="panel-h"><h2 className="h-sub">Rules in force</h2><span className="dt">{active.length} of 30</span></div>
            {active.length === 0 ? <p className="empty">No rules yet. Agents follow your business profile and their standing orders until you add some.</p> : (
              <ul className="td-list">{active.map((r) => (
                <li key={r.id} className="td-rule"><span>{r.text}<span className="dt"> · {r.source === "edit" ? "learned from an edit" : "added by you"}</span></span>
                  {can("manager") && <span className="td-rule-a"><button className="btn btn-sm btn-line" disabled={act.busy} onClick={() => set(r.id, "dismissed")}>Remove</button></span>}
                </li>))}
              </ul>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
