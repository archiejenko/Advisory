// The agent workspace: overview, agents, approvals, activity, and the work agents do (leads, inbox, invoices, tasks).
// Same components signed in and in the demo; the demo answers from demo.js.
import React, { useEffect, useMemo, useState } from "react";
import { Link, navigate, useRoute } from "../router.jsx";
import { useWs, useCan } from "../layout.jsx";
import { Glyph } from "../kit.jsx";
import { api, useApi, useAction, dateOf, dateTimeOf, pounds, LIVE } from "../api.js";
import { Shell, Notice, Loading, Failed, changed } from "./Live.jsx";

/* ---------- Shared bits ---------- */
export function since(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) {
    const a = -s;
    if (a < 3600) return `in ${Math.max(1, Math.round(a / 60))} min`;
    const d = new Date(iso), opt = { timeZone: "Europe/London" };
    const t = d.toLocaleTimeString("en-GB", { ...opt, hour: "2-digit", minute: "2-digit" });
    const key = (x) => x.toLocaleDateString("en-GB", opt);
    if (key(d) === key(new Date())) return "today, " + t;
    if (key(d) === key(new Date(Date.now() + 864e5))) return "tomorrow, " + t;
    if (a < 6 * 86400) return d.toLocaleDateString("en-GB", { ...opt, weekday: "long" }) + ", " + t;
    return dateTimeOf(iso);
  }
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} ${Math.round(s / 3600) === 1 ? "hour" : "hours"} ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} ${Math.round(s / 86400) === 1 ? "day" : "days"} ago`;
  return dateOf(iso);
}
const RUN = { queued: "Queued", running: "Working", waiting: "Needs you", done: "Done", failed: "Failed" };
export const RunStatus = ({ s }) => <span className={"st st-" + s}>{RUN[s] || s}</span>;
const AgentTile = ({ glyph, on = true }) => <span className={"tile tile-agent" + (on ? "" : " is-off")}><Glyph name={glyph || "workspace"} /></span>;
export const AUTONOMY = [
  ["approve_all", "Ask me before every email", "Nothing leaves without your approval. Best while you get to know the agent."],
  ["approve_first", "Ask me the first time", "You approve the first email to each lead or invoice. Follow-ups to the same person go automatically."],
  ["auto", "Send without asking", "Emails go straight away. Everything is still recorded in Activity, and replies come to you."],
];
const RHYTHMS = [["weekdays", "Every weekday"], ["daily", "Every day"], ["weekly", "Every Monday"], ["monthly", "First working day of each month"], ["on_demand", "Only when I ask"]];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const hh = (h) => String(h).padStart(2, "0") + ":00";
const ENGINE_LINKS = {
  watch: [["Alerts", "/workspace/alerts"], ["Customers", "/workspace/clients"], ["Import customers", "/workspace/import"]],
  check: [["Run a company check", "/workspace/check"]],
  prospect: [["Lead lists and settings", "/workspace/prospects"]],
};
const ENGINE_NOTE = {
  watch: "Reads Companies House and The Gazette continuously for every customer and supplier you add. Critical changes are sent straight away; the rest come as a weekly digest.",
  check: "Builds a sourced one-page brief on any UK company when you ask. Use it before you sign a contract or give credit.",
  prospect: "Builds a list of established companies in the postcode districts and trades you choose, on the first working day of each month.",
};

/* ---------- Overview ---------- */
/** Ask the research agent a question, from Today or the overview. Shown only to managers, once Research is hired. */
export function ResearchAsk({ agents }) {
  const can = useCan();
  const research = agents?.find((a) => a.template === "research");
  const [q, setQ] = useState("");
  const act = useAction();
  if (!research || !can("manager")) return null;
  const ask = (e) => {
    e.preventDefault();
    if (q.trim().length < 5) return act.setError("Ask a full question, for example “Who are the biggest cleaning firms in Salford?”");
    act.run(async () => { const r = await api("POST", `/api/ws/my-agents/${research.id}/run`, { input: q.trim() }); navigate("/workspace/runs/" + r.run_id); });
  };
  return (
    <form className="askbar" onSubmit={ask} noValidate>
      <label htmlFor="ask" className="askbar-l"><Glyph name="search" size={20} />Ask the research agent</label>
      <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which offices in Salford are moving this year?" />
      <button className="btn btn-sm" disabled={act.busy}>{act.busy ? "Asking…" : "Ask"}</button>
      {act.error && <p className="form-err" role="alert">{act.error}</p>}
    </form>
  );
}

export function WsOverview() {
  const can = useCan();
  const o = useApi("/api/ws/overview");
  const waiting = useApi("/api/ws/actions?status=proposed");
  const mine = useApi("/api/ws/my-agents");
  const d = o.data;
  return (
    <Shell title="Agents and activity" crumbs={[["Agents and activity"]]} actions={can("manager") && <Link to="/workspace/agents?s=hire" className="btn btn-sm">Hire an agent</Link>}>
      {o.error && <Failed error={o.error} retry={o.reload} />}
      {!d ? <Loading /> : mine.data && mine.data.agents.length === 0 ? <FirstAgent /> : (
        <>
          <div className="kpis">
            <Link to="/workspace/approvals" className={"kpi" + (d.waiting ? " kpi-hot" : "")}><span className="dt">Waiting for you</span><b>{d.waiting}</b><span className="kpi-sub">{d.waiting ? "Review and approve" : "All clear"}</span></Link>
            <Link to="/workspace/agents" className="kpi"><span className="dt">Agents working</span><b>{d.agents_running}</b><span className="kpi-sub">{mine.data?.agents.length || 0} hired</span></Link>
            <Link to="/workspace/activity" className="kpi"><span className="dt">Runs this week</span><b>{d.runs_week}</b><span className="kpi-sub">Every step recorded</span></Link>
            <Link to="/workspace/approvals?f=sent" className="kpi"><span className="dt">Emails sent this week</span><b>{d.sent_week}</b><span className="kpi-sub">From your address</span></Link>
          </div>
          <ResearchAsk agents={mine.data?.agents} />
          <div className="ov-grid">
            <section className="panel">
              <div className="panel-h"><h2 className="h-sub">Needs you</h2>{d.waiting > 0 && <Link to="/workspace/approvals" className="link link-s">See all {d.waiting}</Link>}</div>
              {(waiting.data?.actions || []).length === 0 ? <p className="empty">Nothing waiting. When an agent drafts an email that needs your approval, it appears here.</p> : (
                <ul className="needs">
                  {waiting.data.actions.slice(0, 4).map((a) => (
                    <li key={a.id}>
                      <Link to={"/workspace/approvals?a=" + a.id} className="need">
                        <span className="need-t"><b>{a.title}</b><span className="dt">{a.agent}, {since(a.created_at)}</span></span>
                        <span className="need-r">{a.reason}</span>
                        <span className="need-go">Review<Glyph name="right" size={16} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="today">
                {[["Overdue invoices", d.overdue_invoices, "/workspace/invoices"], ["New messages", d.inbox_new, "/workspace/inbox"], ["Open alerts", d.open_alerts, "/workspace/alerts"], ["Open tasks", d.open_tasks, "/workspace/tasks"], ["Leads", d.leads, "/workspace/leads"]].map(([t, n, to]) => (
                  <Link key={t} to={to} className="today-i"><b>{n}</b><span>{t}</span></Link>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-h"><h2 className="h-sub">Recent activity</h2><Link to="/workspace/activity" className="link link-s">All activity</Link></div>
              <Feed runs={d.activity} />
            </section>
          </div>
        </>
      )}
    </Shell>
  );
}

export function FirstAgent() {
  return (
    <div className="first">
      <p className="label">Start here</p>
      <h2 className="h-small">Hire your first agent</h2>
      <p className="body">Pick the job that eats most of your week. Each agent uses your business profile, asks before it sends anything, and records every step it takes.</p>
      <div className="first-row">
        {[["send", "Outreach", "outreach"], ["inbox", "Inbox", "inbox"], ["pound", "Credit control", "credit-control"]].map(([g, t, k]) => (
          <Link key={k} to={"/workspace/agents/new?t=" + k} className="first-i"><AgentTile glyph={g} /><b>{t}</b><Glyph name="right" size={18} /></Link>
        ))}
      </div>
      <p className="more"><Link to="/workspace/settings?s=profile" className="link link-s">Check your business profile first</Link></p>
    </div>
  );
}

export function Feed({ runs }) {
  if (!runs?.length) return <p className="empty">No runs yet. Scheduled agents run at their set time; you can also run one now from its page.</p>;
  return (
    <ul className="feed">
      {runs.map((r) => (
        <li key={r.id}>
          <Link to={"/workspace/runs/" + r.id} className="feed-i">
            <span className="feed-top"><b>{r.agent}</b><RunStatus s={r.status} /><span className="dt">{since(r.created_at)}</span></span>
            <span className="feed-s">{r.summary ? r.summary.split("\n")[0] : r.status === "failed" ? r.error || "The run failed." : "Working on it…"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Agents: yours and the catalogue ---------- */
const CATS = [["Grow", "Win more work"], ["Run", "Keep the day running"], ["Get paid", "Get paid on time"], ["Protect", "Avoid bad debts"], ["Know", "Know what's going on"]];

export function WsAgents() {
  const can = useCan();
  const mine = useApi("/api/ws/my-agents");
  const tpls = useApi("/api/ws/templates");
  return (
    <Shell title="Agents" crumbs={[["Agents"]]} actions={can("manager") && <a href="#/workspace/agents?s=hire" className="btn btn-sm">Hire an agent</a>}>
      {mine.error && <Failed error={mine.error} retry={mine.reload} />}
      {!mine.data ? <Loading /> : (
        <div className="agent-grid">
          {mine.data.agents.length === 0 && <p className="empty">No agents yet. Hire one from the list below.</p>}
          {mine.data.agents.map((a) => (
            <Link key={a.id} to={"/workspace/agents/" + a.id} className="agent-card">
              <span className="ac-top"><AgentTile glyph={a.glyph} on={a.status === "running"} /><span className={"st st-" + (a.status === "running" ? "done" : "paused")}>{a.status === "running" ? "Running" : "Paused"}</span></span>
              <b className="ac-name">{a.name}</b>
              <span className="ac-meta">{a.rhythm_label}{a.engine === "llm" && a.status === "running" && a.next_run_at ? `, next ${since(a.next_run_at)}` : ""}</span>
              <span className="ac-foot">
                {a.waiting > 0 ? <span className="st st-waiting">{a.waiting} waiting</span> : <span className="dt">{a.last_run_at ? "Last ran " + since(a.last_run_at) : a.engine === "llm" ? "Not run yet" : "Watching continuously"}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
      <div id="hire" className="cat">
        <h2 className="h-sub mt-l">Hire an agent</h2>
        <p className="body ws-intro">Every agent works from your business profile, uses tools from the Agent House catalogue, and asks before it sends anything unless you tell it otherwise.</p>
        {!tpls.data ? <Loading what="Loading the catalogue" /> : CATS.map(([cat, line]) => (
          <section key={cat} className="cat-group">
            <h3 className="cat-h">{cat}<span>{line}</span></h3>
            <div className="cat-grid">
              {tpls.data.templates.filter((t) => t.category === cat).map((t) => {
                const single = t.engine !== "llm" && t.hired > 0;
                return (
                  <article key={t.key} className={"cat-card" + (t.status === "next" ? " is-next" : "")}>
                    <span className="ac-top"><AgentTile glyph={t.glyph} on={t.status === "live"} />{t.status === "next" ? <span className="st st-paused">Coming soon</span> : t.hired ? <span className="st st-done">Hired{t.hired > 1 ? ` ×${t.hired}` : ""}</span> : null}</span>
                    <b className="ac-name">{t.name}</b>
                    <p className="cat-d">{t.short}</p>
                    <p className="dt">{t.status === "next" ? "Needs " + t.needs : t.rhythm_label}</p>
                    <div className="cat-act">
                      {t.status === "live" && can("manager") && !single && <Link to={"/workspace/agents/new?t=" + t.key} className="btn btn-sm btn-line">{t.hired ? "Hire another" : "Hire"}</Link>}
                      <Link to={"/agents/" + t.key} className="link link-s">How it works</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}

/* ---------- Hire one ---------- */
export function WsHire() {
  const { query } = useRoute();
  const { me } = useWs();
  const tpls = useApi("/api/ws/templates");
  const chans = useApi("/api/ws/channels");
  const t = tpls.data?.templates.find((x) => x.key === query.t);
  const [f, setF] = useState(null);
  const act = useAction();
  useEffect(() => { if (t && !f) setF({ name: t.name, brief: t.default_brief, rhythm: t.rhythm, run_hour: t.key === "briefing" ? 7 : 8, autonomy: t.key === "briefing" ? "auto" : "approve_all", channel_id: "" }); }, [t]);
  if (tpls.error) return <Shell title="Hire an agent" crumbs={[["Agents", "/workspace/agents"], ["Hire"]]}><Failed error={tpls.error} retry={tpls.reload} /></Shell>;
  if (!tpls.data) return <Shell title="Hire an agent" crumbs={[["Agents", "/workspace/agents"], ["Hire"]]}><Loading /></Shell>;
  if (!t) return <Shell title="Choose an agent" crumbs={[["Agents", "/workspace/agents"], ["Hire"]]}><p className="body">That agent isn't in the catalogue. <Link to="/workspace/agents?s=hire" className="link">See every agent</Link></p></Shell>;
  const profileThin = !me.org.profile?.what || !me.org.profile?.customers;
  const chooseRhythm = t.engine === "llm" && !["on_event", "on_demand"].includes(t.rhythm);
  const sends = ["outreach", "inbox", "credit-control"].includes(t.key);
  const submit = (e) => {
    e.preventDefault();
    if (!f.brief.trim()) return act.setError("Tell the agent what to do. The suggested brief is a good start.");
    act.run(async () => {
      const r = await api("POST", "/api/ws/my-agents", { template: t.key, name: f.name.trim() || t.name, brief: f.brief.trim(), rhythm: f.rhythm, run_hour: Number(f.run_hour), autonomy: f.autonomy, channel_id: f.channel_id || null });
      changed();
      navigate("/workspace/agents/" + r.id + "?hired=1");
    });
  };
  return (
    <Shell title={"Hire " + t.name.toLowerCase().replace(/^./, (c) => c.toUpperCase())} crumbs={[["Agents", "/workspace/agents"], ["Hire " + t.name]]}>
      <div className="hire">
        <div className="hire-main">
          {t.status !== "live" ? <Notice signal>{t.name} isn't available yet. It needs {t.needs}.</Notice> : !f ? <Loading /> : (
            <form className="form" onSubmit={submit} noValidate>
              {profileThin && t.engine === "llm" && <Notice>Your business profile is thin, so the agent will know less about you. <Link to="/workspace/settings?s=profile" className="link link-s">Fill it in</Link> (two minutes) before you hire.</Notice>}
              <div className="field"><label htmlFor="h-name">Name</label><input id="h-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></div>
              {t.engine === "llm" && (
                <div className="field">
                  <label htmlFor="h-brief">Brief</label>
                  <textarea id="h-brief" rows={5} value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} maxLength={4000} />
                  <p className="hint">Plain English. Who to look for, what to say, what to avoid. We've started it from your business profile.</p>
                </div>
              )}
              {chooseRhythm && (
                <div className="grid-2">
                  <div className="field"><label htmlFor="h-rhythm">Runs</label><select id="h-rhythm" value={f.rhythm} onChange={(e) => setF({ ...f, rhythm: e.target.value })}>{RHYTHMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                  {f.rhythm !== "on_demand" && <div className="field"><label htmlFor="h-hour">At</label><select id="h-hour" value={f.run_hour} onChange={(e) => setF({ ...f, run_hour: e.target.value })}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}, UK time</option>)}</select></div>}
                </div>
              )}
              {sends && (
                <fieldset className="opts">
                  <legend className="flabel">Before it sends an email</legend>
                  {AUTONOMY.map(([v, l, d]) => (
                    <label key={v} className={"opt" + (f.autonomy === v ? " is-on" : "")}>
                      <input type="radio" name="autonomy" value={v} checked={f.autonomy === v} onChange={() => setF({ ...f, autonomy: v })} />
                      <span><b>{l}</b><span>{d}</span></span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="field">
                <label htmlFor="h-ch">Tell me about its work in</label>
                <select id="h-ch" value={f.channel_id} onChange={(e) => setF({ ...f, channel_id: e.target.value })}>
                  <option value="">Email to {me.user.email}</option>
                  {(chans.data?.channels || []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <p className="hint">Add Slack, Teams or a shared inbox in <Link to="/workspace/settings?s=channels" className="link link-s">Settings</Link>.</p>
              </div>
              {act.error && <Notice signal>{act.error}</Notice>}
              <div className="actions actions-tight"><button className="btn" disabled={act.busy}>{act.busy ? "Hiring…" : "Hire " + (f.name || t.name)}</button><Link to="/workspace/agents" className="link">Cancel</Link></div>
            </form>
          )}
        </div>
        <aside className="hire-side">
          <AgentTile glyph={t.glyph} />
          <h2 className="h-small mt-s">{t.name}</h2>
          <p className="body">{t.description}</p>
          <h3 className="flabel mt-s">What it does</h3>
          <ul className="ticks">{t.does.map((x) => <li key={x}>{x}</li>)}</ul>
          {t.tools?.length > 0 && <><h3 className="flabel mt-s">Tools it can use</h3><p className="chips">{t.tools.map((x) => <span key={x} className="chip mono">{x}</span>)}</p></>}
          <p className="dt mt-s">{t.rhythm_label}. Each tool call counts as one action against your plan.</p>
        </aside>
      </div>
    </Shell>
  );
}

/* ---------- One agent ---------- */
export function WsAgent({ id }) {
  const { query } = useRoute();
  const { me } = useWs();
  const can = useCan();
  const { data, error, reload } = useApi("/api/ws/my-agents/" + id);
  const chans = useApi("/api/ws/channels");
  const [f, setF] = useState(null);
  const [input, setInput] = useState("");
  const [note, setNote] = useState(query.hired ? "Hired. It's working for you now." : "");
  const [confirm, setConfirm] = useState(false);
  const act = useAction();
  useEffect(() => { if (data && !f) setF(data.agent); }, [data]);
  if (error?.status === 404) return <Shell title="Agent not found" crumbs={[["Agents", "/workspace/agents"], ["Not found"]]}><p className="body">This agent has been removed. <Link to="/workspace/agents" className="link">Back to your agents</Link></p></Shell>;
  if (!data || !f) return <Shell title="Agent" crumbs={[["Agents", "/workspace/agents"], ["…"]]}>{error ? <Failed error={error} retry={reload} /> : <Loading />}</Shell>;
  const a = data.agent, t = data.template, llm = a.engine === "llm";
  const dirty = ["name", "brief", "rhythm", "run_hour", "autonomy", "channel_id", "monthly_cap"].some((k) => String(f[k] ?? "") !== String(a[k] ?? ""));
  const save = (e) => {
    e?.preventDefault();
    act.run(async () => {
      await api("PATCH", "/api/ws/my-agents/" + id, { name: f.name, ...(llm ? { brief: f.brief, rhythm: f.rhythm, run_hour: Number(f.run_hour), autonomy: f.autonomy, monthly_cap: Number(f.monthly_cap) } : {}), channel_id: f.channel_id || null });
      const r = await api("GET", "/api/ws/my-agents/" + id); setF(r.agent); await reload(); setNote("Saved.");
    });
  };
  const toggle = () => act.run(async () => {
    const status = a.status === "running" ? "paused" : "running";
    await api("PATCH", "/api/ws/my-agents/" + id, { status }); await reload(); setF({ ...f, status }); changed();
    setNote(status === "paused" ? `${a.name} is paused. It won't run until you start it again.` : `${a.name} is running again.`);
  });
  const runNow = (e) => {
    e?.preventDefault();
    if (a.template === "research" && input.trim().length < 5) return act.setError("Ask the research agent a question first.");
    act.run(async () => { const r = await api("POST", `/api/ws/my-agents/${id}/run`, { input: input.trim() || undefined }); navigate("/workspace/runs/" + r.run_id); });
  };
  const remove = () => act.run(async () => { await api("DELETE", "/api/ws/my-agents/" + id); changed(); navigate("/workspace/agents"); });
  const pct = Math.min(100, Math.round((data.actions_this_month / a.monthly_cap) * 100));
  const canEdit = can("manager");
  return (
    <Shell title={a.name} crumbs={[["Agents", "/workspace/agents"], [a.name]]}
      actions={canEdit && <>
        <button role="switch" aria-checked={a.status === "running"} className={"toggle toggle-s" + (a.status === "running" ? " is-on" : "")} onClick={toggle} disabled={act.busy}><span className="t-on">Running</span><span className="t-off">Paused</span></button>
        {llm && a.template !== "research" && <button className="btn btn-sm" onClick={runNow} disabled={act.busy || a.status !== "running"}>Run now</button>}
      </>}>
      <p className="body ws-intro">{t.short} <Link to={"/agents/" + t.key} className="link link-s">How it works</Link></p>
      <Notice>{note}</Notice>
      {act.error && <Notice signal>{act.error}</Notice>}
      {a.template === "research" && canEdit && (
        <form className="askbar" onSubmit={runNow} noValidate>
          <label htmlFor="ask" className="askbar-l"><Glyph name="search" size={20} />Ask a question</label>
          <input id="ask" value={input} onChange={(e) => setInput(e.target.value)} placeholder="What do office cleaners in Salford charge per hour?" />
          <button className="btn btn-sm" disabled={act.busy || a.status !== "running"}>{act.busy ? "Asking…" : "Ask"}</button>
        </form>
      )}
      <div className="stat-row">
        <div><span className="dt">Status</span><b className="b-s">{a.status === "running" ? "Running" : "Paused"}</b></div>
        <div><span className="dt">{llm ? "Next run" : "Runs"}</span><b className="b-s">{llm ? (a.status !== "running" ? "Paused" : a.next_run_at ? since(a.next_run_at) : a.rhythm_label) : a.rhythm_label}</b></div>
        <div><span className="dt">Last run</span><b className="b-s">{a.last_run_at ? since(a.last_run_at) : "Not yet"}</b></div>
        {llm && <div><span className="dt">Actions this month</span><b className="b-s">{data.actions_this_month} of {a.monthly_cap}</b><span className="meter" aria-hidden="true"><i style={{ width: pct + "%" }} /></span></div>}
      </div>
      {!llm && (
        <section className="panel mt-l">
          <h2 className="h-sub">Where its work shows</h2>
          <p className="body">{ENGINE_NOTE[a.engine]}</p>
          <div className="actions actions-tight">{ENGINE_LINKS[a.engine].map(([t2, to], i) => <Link key={to} to={to} className={i ? "link" : "btn btn-line btn-sm"}>{t2}</Link>)}</div>
        </section>
      )}
      <div className="agent-cols mt-l">
        <section>
          <div className="panel-h"><h2 className="h-sub">Runs</h2>{llm && <Link to={"/workspace/activity?agent=" + id} className="link link-s">All runs</Link>}</div>
          {llm ? <Feed runs={data.runs.map((r) => ({ ...r, agent: dateTimeOf(r.created_at).replace(/,? \d{4}/, "") + (r.trigger === "manual" ? ", by hand" : r.trigger === "event" ? ", on a new message" : "") }))} /> : <p className="empty">This agent works from the registers, so its work shows as alerts and briefs rather than runs.</p>}
        </section>
        <form className="panel" onSubmit={save} noValidate>
          <h2 className="h-sub">Settings</h2>
          <fieldset disabled={!canEdit || act.busy} className="plain">
            <div className="field"><label htmlFor="a-name">Name</label><input id="a-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            {llm && <div className="field"><label htmlFor="a-brief">Brief</label><textarea id="a-brief" rows={6} value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} /></div>}
            {llm && !["on_event", "on_demand"].includes(t.rhythm) && (
              <div className="grid-2">
                <div className="field"><label htmlFor="a-rhythm">Runs</label><select id="a-rhythm" value={f.rhythm} onChange={(e) => setF({ ...f, rhythm: e.target.value })}>{RHYTHMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                {f.rhythm !== "on_demand" && <div className="field"><label htmlFor="a-hour">At</label><select id="a-hour" value={f.run_hour} onChange={(e) => setF({ ...f, run_hour: e.target.value })}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></div>}
              </div>
            )}
            {llm && ["outreach", "inbox", "credit-control"].includes(a.template) && (
              <div className="field"><label htmlFor="a-auto">Before it sends an email</label><select id="a-auto" value={f.autonomy} onChange={(e) => setF({ ...f, autonomy: e.target.value })}>{AUTONOMY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><p className="hint">{AUTONOMY.find(([v]) => v === f.autonomy)?.[2]}</p></div>
            )}
            <div className="field">
              <label htmlFor="a-ch">Tell me about its work in</label>
              <select id="a-ch" value={f.channel_id || ""} onChange={(e) => setF({ ...f, channel_id: e.target.value })}>
                <option value="">Email to the workspace owner</option>
                {(chans.data?.channels || []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            {llm && <div className="field"><label htmlFor="a-cap">Monthly limit, in actions</label><input id="a-cap" type="number" min={10} max={10000} value={f.monthly_cap} onChange={(e) => setF({ ...f, monthly_cap: e.target.value })} /><p className="hint">The agent stops for the month when it reaches this, and tells you.</p></div>}
          </fieldset>
          {canEdit && <div className="actions actions-tight"><button className="btn btn-sm" disabled={!dirty || act.busy}>Save changes</button>{dirty && <button type="button" className="link link-s" onClick={() => setF(a)}>Undo</button>}</div>}
          {canEdit && (
            <p className="danger mt-l">{confirm ? <><button type="button" className="btn btn-line btn-sm" onClick={remove} disabled={act.busy}>Confirm: remove {a.name}</button> <button type="button" className="link link-s" onClick={() => setConfirm(false)}>Keep it</button></> : <button type="button" className="link link-s" onClick={() => setConfirm(true)}>Remove this agent</button>}</p>
          )}
        </form>
      </div>
    </Shell>
  );
}

/* ---------- One run ---------- */
export function WsRun({ id }) {
  const { data, error, reload } = useApi("/api/ws/runs/" + id);
  const live = data && ["queued", "running"].includes(data.run.status);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => reload(), 1500);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => { if (data && !live) changed(); }, [live]);
  if (error?.status === 404) return <Shell title="Run not found" crumbs={[["Activity", "/workspace/activity"], ["Not found"]]}><p className="body"><Link to="/workspace/activity" className="link">Back to activity</Link></p></Shell>;
  if (!data) return <Shell title="Run" crumbs={[["Activity", "/workspace/activity"], ["…"]]}>{error ? <Failed error={error} retry={reload} /> : <Loading />}</Shell>;
  const r = data.run;
  const [answer, ...rest] = (r.summary || "").split(/\n\s*Sources:\s*\n/);
  const sources = rest.join("\n").split("\n").map((l) => l.replace(/^[-•]\s*/, "").trim()).filter((l) => /^https?:\/\//.test(l));
  return (
    <Shell title={r.agent || "Run"} crumbs={[["Activity", "/workspace/activity"], [dateTimeOf(r.created_at)]]} actions={<RunStatus s={r.status} />}>
      {r.input && <p className="q-line"><span className="dt">You asked</span>{r.input}</p>}
      {live ? (
        <div className="working" aria-live="polite"><span className="dots"><i /><i /><i /></span>{r.status === "queued" ? "Starting…" : "Working. Each step appears below as it finishes."}</div>
      ) : (
        <section className="panel answer">
          <h2 className="h-sub">{r.status === "failed" ? "What went wrong" : "Outcome"}</h2>
          <p className="body pre">{r.status === "failed" ? r.error : answer}</p>
          {sources.length > 0 && <><h3 className="flabel mt-s">Sources</h3><ol className="sources">{sources.map((s) => <li key={s}><a href={s} target="_blank" rel="noopener noreferrer" className="link link-s">{s.replace(/^https?:\/\//, "")}</a></li>)}</ol></>}
          {data.actions.length > 0 && (
            <div className="mt-s">
              <h3 className="flabel">What it drafted</h3>
              <ul className="needs">{data.actions.map((x) => (
                <li key={x.id}><Link to={"/workspace/approvals?a=" + x.id + (x.status !== "proposed" ? "&f=all" : "")} className="need"><span className="need-t"><b>{x.title}</b><span className={"st st-" + (x.status === "proposed" ? "waiting" : x.status === "sent" ? "done" : "paused")}>{x.status === "proposed" ? "Waiting for you" : x.status[0].toUpperCase() + x.status.slice(1)}</span></span><span className="need-go">Open<Glyph name="right" size={16} /></span></Link></li>
              ))}</ul>
            </div>
          )}
        </section>
      )}
      <h2 className="h-sub mt-l">Steps</h2>
      {data.steps.length === 0 ? <p className="empty">{live ? "The first step is under way." : "No tool calls recorded for this run."}</p> : (
        <ol className="steps">
          {data.steps.map((s, i) => (
            <li key={i} className={s.ok ? "" : "is-bad"}>
              <span className="step-n">{i + 1}</span>
              <div className="step-b">
                <p><b className="mono">{s.tool}</b>{!s.ok && <span className="st st-failed">Error</span>}</p>
                {s.input && Object.keys(s.input).length > 0 && <p className="mono step-in">{JSON.stringify(s.input)}</p>}
                <details><summary className="link link-s">Result</summary><pre className="step-out">{pretty(s.result)}</pre></details>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="source">{r.steps} {r.steps === 1 ? "turn" : "turns"}, {r.tool_calls} tool {r.tool_calls === 1 ? "call" : "calls"}{r.cost_pence ? `, model cost ${pounds(r.cost_pence)}` : ""}. Started {dateTimeOf(r.created_at)}{r.finished_at ? `, finished ${dateTimeOf(r.finished_at)}` : ""}. {r.trigger === "schedule" ? "Scheduled run." : r.trigger === "event" ? "Started by a new message." : "Started by hand."}</p>
    </Shell>
  );
}
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2).slice(0, 3000); } catch { return String(s || "").slice(0, 3000); } };

/* ---------- Approvals ---------- */
export function WsApprovals() {
  const { query } = useRoute();
  const can = useCan();
  const view = query.f || "proposed";
  const { data, error, loading, reload } = useApi("/api/ws/actions?status=" + view);
  const list = data?.actions || [];
  const sel = list.find((a) => a.id === query.a) || (!query.a ? list[0] : null);
  const [ed, setEd] = useState(null);
  const [note, setNote] = useState("");
  const act = useAction();
  useEffect(() => { setEd(sel && sel.status === "proposed" ? { subject: sel.payload.subject, body: sel.payload.body } : null); act.setError(""); }, [sel?.id]);
  const go = (f, a) => navigate("/workspace/approvals?" + new URLSearchParams({ ...(f !== "proposed" ? { f } : {}), ...(a ? { a } : {}) }));
  const nextId = () => { const i = list.findIndex((x) => x.id === sel.id); return (list[i + 1] || list[i - 1])?.id; };
  const decide = (kind) => act.run(async () => {
    const edited = ed && (ed.subject !== sel.payload.subject || ed.body !== sel.payload.body);
    await api("POST", `/api/ws/actions/${sel.id}/${kind}`, kind === "approve" && edited ? ed : {});
    const n = nextId(), msg = kind === "approve" ? `Sent to ${sel.payload.to}${edited ? " with your edits. If they're how you'd always want it, a rule to keep will appear in How we work" : ""}.` : "Rejected. Nothing was sent.";
    await reload(); changed(); go(view, n);
    setNote(msg);
  });
  const counts = data?.counts || {};
  return (
    <Shell title="Approvals" crumbs={[["Approvals"]]}>
      <p className="body ws-intro">Emails your agents want to send. Edit anything before you approve; it goes from your address, and replies come back to you.</p>
      <div className="filter" role="group" aria-label="Show">
        {[["proposed", "Waiting"], ["sent", "Sent"], ["rejected", "Rejected"], ["all", "All"]].map(([v, t]) => (
          <button key={v} aria-pressed={view === v} className={view === v ? "is-on" : ""} onClick={() => go(v)}>{t} {v !== "all" && <span className="muted">{counts[v] || 0}</span>}</button>
        ))}
      </div>
      <Notice>{note}</Notice>
      {error && <Failed error={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="inbox">
          <ul className="inbox-list" aria-label="Emails">
            {list.length === 0 && <li className="empty">{view === "proposed" ? "Nothing waiting for you. Agents add drafts here as they work." : "Nothing here yet."}</li>}
            {list.map((a) => (
              <li key={a.id}>
                <Link to={"/workspace/approvals?" + new URLSearchParams({ ...(view !== "proposed" ? { f: view } : {}), a: a.id })} className={"inbox-item" + (sel && a.id === sel.id ? " is-sel" : "")}>
                  <span className="ii-top"><b>{a.title}</b>{view === "all" && <span className={"st st-" + (a.status === "proposed" ? "waiting" : a.status === "sent" ? "done" : "paused")}>{a.status === "proposed" ? "Waiting" : a.status}</span>}</span>
                  <span className="ii-co">{a.agent}</span>
                  <span className="dt">{since(a.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <article className="inbox-detail" aria-live="polite">
            {!sel ? <p className="empty">{list.length ? "Choose an email to read it." : "When an agent drafts an email, you'll read it here before it goes."}</p> : (
              <>
                <p className="dt"><Link to={"/workspace/agents/" + sel.agent_id} className="link link-s">{sel.agent}</Link>, <Link to={"/workspace/runs/" + sel.run_id} className="link link-s">see the run</Link></p>
                <h2 className="h-small">{sel.title}</h2>
                {sel.reason && <p className="why"><span className="dt">Why</span>{sel.reason}</p>}
                <dl className="mail">
                  <div><dt>To</dt><dd className="mono">{sel.payload.to}</dd></div>
                  <div><dt>Subject</dt><dd>{ed && can("manager") ? <input aria-label="Subject" value={ed.subject} onChange={(e) => setEd({ ...ed, subject: e.target.value })} /> : sel.payload.subject}</dd></div>
                </dl>
                {ed && can("manager") ? <textarea aria-label="Email body" className="mail-body" rows={12} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} /> : <p className="mail-body pre">{sel.payload.body}</p>}
                {sel.status !== "proposed" && <p className="dt mt-s">{sel.status === "sent" ? `Sent ${dateTimeOf(sel.decided_at)}${sel.decided_by === "auto" ? ", automatically" : sel.decided_by ? ", approved by " + sel.decided_by : ""}.` : sel.status === "rejected" ? `Rejected ${dateTimeOf(sel.decided_at)}${sel.decided_by && sel.decided_by !== "removed" ? " by " + sel.decided_by : ""}.` : `Failed: ${sel.result || "the email couldn't be sent."}`}</p>}
                {act.error && <Notice signal>{act.error}</Notice>}
                {sel.status === "proposed" && can("manager") && (
                  <div className="actions actions-tight">
                    <button className="btn" disabled={act.busy || !ed?.subject.trim() || !ed?.body.trim()} onClick={() => decide("approve")}>{act.busy ? "Sending…" : "Approve and send"}</button>
                    <button className="btn btn-line" disabled={act.busy} onClick={() => decide("reject")}>Reject</button>
                  </div>
                )}
                {sel.status === "proposed" && !can("manager") && <p className="dt mt-s">A manager or owner can approve this.</p>}
              </>
            )}
          </article>
        </div>
      )}
    </Shell>
  );
}

/* ---------- Activity ---------- */
export function WsActivity() {
  const { query } = useRoute();
  const runs = useApi("/api/ws/runs" + (query.agent ? "?agent=" + query.agent : ""));
  const mine = useApi("/api/ws/my-agents");
  const llm = (mine.data?.agents || []).filter((a) => a.engine === "llm");
  return (
    <Shell title="Activity" crumbs={[["Activity"]]}>
      <div className="toolbar">
        <p className="body">Every run, step by step. Open one to see each tool it used and what came back.</p>
        <div className="field field-inline">
          <label htmlFor="act-agent">Agent</label>
          <select id="act-agent" value={query.agent || ""} onChange={(e) => navigate("/workspace/activity" + (e.target.value ? "?agent=" + e.target.value : ""))}>
            <option value="">All agents</option>
            {llm.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      {runs.error && <Failed error={runs.error} retry={runs.reload} />}
      {!runs.data ? <Loading /> : (
        <table className="ledger ws-table">
          <thead><tr><th>When</th><th>Agent</th><th>Outcome</th><th className="num">Steps</th></tr></thead>
          <tbody>
            {runs.data.runs.length === 0 && <tr><td colSpan={4} className="empty">No runs yet.</td></tr>}
            {runs.data.runs.map((r) => (
              <tr key={r.id} className="click-row" onClick={() => navigate("/workspace/runs/" + r.id)}>
                <td className="dt nowrap">{since(r.created_at)}</td>
                <td><Link to={"/workspace/runs/" + r.id} className="row-link" onClick={(e) => e.stopPropagation()}>{r.agent}</Link><br /><RunStatus s={r.status} /></td>
                <td className="clamp">{r.summary ? r.summary.split("\n")[0] : r.error || "Working…"}</td>
                <td className="num">{r.tool_calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

/* ---------- Leads ---------- */
const LEAD = [["new", "New"], ["contacted", "Contacted"], ["replied", "Replied"], ["won", "Won"], ["lost", "Lost"], ["unsubscribed", "Unsubscribed"]];
export function WsLeads() {
  const can = useCan();
  const [show, setShow] = useState("all");
  const { data, error, reload } = useApi("/api/ws/leads");
  const [open, setOpen] = useState(null);
  const act = useAction();
  const all = data?.leads || [];
  const list = show === "all" ? all : all.filter((l) => l.status === show);
  const set = (l, b) => act.run(async () => { await api("PATCH", "/api/ws/leads/" + l.id, b); await reload(); });
  return (
    <Shell title="Leads" crumbs={[["Leads"]]} actions={<Link to="/workspace/agents" className="link link-s">Outreach settings</Link>}>
      <p className="body ws-intro">Companies your outreach agent found and researched. Nobody is emailed twice, and anyone who replies STOP is never contacted again.</p>
      <div className="filter" role="group" aria-label="Show leads">
        {[["all", "All"], ...LEAD.slice(0, 5)].map(([v, t]) => <button key={v} aria-pressed={show === v} className={show === v ? "is-on" : ""} onClick={() => setShow(v)}>{t} <span className="muted">{v === "all" ? all.length : all.filter((l) => l.status === v).length}</span></button>)}
      </div>
      {error && <Failed error={error} retry={reload} />}
      {act.error && <Notice signal>{act.error}</Notice>}
      {!data ? <Loading /> : (
        <table className="ledger ws-table">
          <thead><tr><th>Company</th><th className="hide-sm">Email</th><th>Status</th><th className="hide-sm num">Emails</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={4} className="empty">{all.length ? "No leads with that status." : "No leads yet. Hire the outreach agent and it adds companies here as it researches them."}</td></tr>}
            {list.map((l) => (
              <React.Fragment key={l.id}>
                <tr className="click-row" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <td><button className="row-link" aria-expanded={open === l.id}>{l.company}</button>{l.number && <span className="mono muted"> {l.number}</span>}<br /><span className="dt">Added {since(l.created_at)}</span></td>
                  <td className="hide-sm mono">{l.email || <span className="muted">No email found</span>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select aria-label={"Status for " + l.company} value={l.status} disabled={!can("manager") || act.busy || l.status === "unsubscribed"} onChange={(e) => set(l, { status: e.target.value })}>
                      {LEAD.map(([v, t]) => <option key={v} value={v} disabled={v === "unsubscribed" && l.status !== v}>{t}</option>)}
                    </select>
                  </td>
                  <td className="hide-sm num">{l.emails_sent}</td>
                </tr>
                {open === l.id && (
                  <tr className="row-more"><td colSpan={4}>
                    <p className="body">{l.notes || "No research notes."}</p>
                    <p className="dt">{l.website && <><a href={l.website} target="_blank" rel="noopener noreferrer" className="link link-s">{l.website.replace(/^https?:\/\//, "")}</a>. </>}{l.last_contact_at ? "Last emailed " + since(l.last_contact_at) + "." : "Not contacted yet."}</p>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

/* ---------- Inbox ---------- */
const URG = { high: "sev sev-crit", normal: "sev sev-rev", low: "sev" };
export function WsInbox() {
  const { query } = useRoute();
  const { data, error, reload } = useApi("/api/ws/inbox");
  const acts = useApi("/api/ws/actions?status=all");
  const [copied, setCopied] = useState(false);
  const list = data?.messages || [];
  const sel = list.find((m) => m.id === query.m) || (!query.m ? list[0] : null);
  const reply = sel && (acts.data?.actions || []).find((a) => a.payload.message_id === sel.id);
  const copy = async () => { try { await navigator.clipboard.writeText(data.address); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} };
  return (
    <Shell title="Inbox" crumbs={[["Inbox"]]}>
      {data?.address && (
        <div className="addr">
          <div><span className="dt">Forward enquiries to</span><b className="mono">{data.address}</b></div>
          <button className="btn btn-line btn-sm" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
          <p className="hint">Set your enquiries inbox to forward a copy here. The inbox agent sorts each message, drafts a reply, and flags anything urgent. Replies go from your own address.</p>
        </div>
      )}
      {error && <Failed error={error} retry={reload} />}
      {!data ? <Loading /> : (
        <div className="inbox">
          <ul className="inbox-list" aria-label="Messages">
            {list.length === 0 && <li className="empty">No messages yet. Forward an email to the address above to try it.</li>}
            {list.map((m) => (
              <li key={m.id}>
                <Link to={"/workspace/inbox?m=" + m.id} className={"inbox-item" + (sel && m.id === sel.id ? " is-sel" : "") + (m.status === "new" ? " is-new" : "")}>
                  <span className="ii-top"><b>{m.subject || "(no subject)"}</b>{m.urgency && <span className={URG[m.urgency]}>{m.urgency === "high" ? "Urgent" : m.urgency === "low" ? "Low" : "Normal"}</span>}</span>
                  <span className="ii-co">{m.from_addr}</span>
                  <span className="dt">{since(m.received_at)}{m.category ? `, ${m.category}` : ""}{m.status === "replied" ? ", replied" : m.status === "ignored" ? ", ignored" : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
          <article className="inbox-detail">
            {!sel ? <p className="empty">Choose a message.</p> : (
              <>
                <p className="dt">From <span className="mono">{sel.from_addr}</span>, {dateTimeOf(sel.received_at)}</p>
                <h2 className="h-small">{sel.subject || "(no subject)"}</h2>
                {sel.summary && <p className="why"><span className="dt">Inbox agent</span>{sel.summary}</p>}
                <p className="mail-body pre">{sel.body}</p>
                {reply ? (
                  <p className="mt-s"><Link to={"/workspace/approvals?a=" + reply.id + (reply.status !== "proposed" ? "&f=all" : "")} className={reply.status === "proposed" ? "btn btn-sm" : "link"}>{reply.status === "proposed" ? "Review the drafted reply" : reply.status === "sent" ? "See the reply that was sent" : "See the drafted reply"}</Link></p>
                ) : sel.status === "new" ? <p className="dt mt-s">The inbox agent will read this shortly.</p> : null}
              </>
            )}
          </article>
        </div>
      )}
    </Shell>
  );
}

/* ---------- Invoices ---------- */
export function WsInvoices() {
  const can = useCan();
  const { data, error, reload } = useApi("/api/ws/invoices");
  const [show, setShow] = useState("unpaid");
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const act = useAction();
  const all = data?.invoices || [];
  const overdue = all.filter((i) => i.status === "unpaid" && i.days_overdue > 0);
  const list = show === "all" ? all : show === "overdue" ? overdue : all.filter((i) => i.status === show);
  const upload = (e) => {
    e.preventDefault();
    if (!file) return act.setError("Choose a CSV file first.");
    act.run(async () => {
      const fd = new FormData(); fd.append("file", file);
      const r = await api("POST", "/api/ws/invoices/import", fd);
      setNote(`${r.imported} added, ${r.updated} updated${r.skipped_rows.length ? `. Skipped rows ${r.skipped_rows.slice(0, 8).join(", ")}${r.skipped_rows.length > 8 ? "…" : ""}: check the date and amount` : ""}.`);
      setFile(null); e.target.reset(); await reload(); changed();
    });
  };
  const set = (i, status) => act.run(async () => { await api("PATCH", "/api/ws/invoices/" + i.id, { status }); await reload(); changed(); setNote(`${i.ref} marked ${status}.`); });
  return (
    <Shell title="Invoices" crumbs={[["Invoices"]]}>
      <p className="body ws-intro">Your unpaid invoices. The credit control agent sends a polite reminder when one is overdue, a firmer one after a week, and tells you when it's time to call.</p>
      {data && (
        <div className="stat-row">
          <div><span className="dt">Overdue</span><b>{pounds(overdue.reduce((n, i) => n + i.amount_pence, 0))}</b></div>
          <div><span className="dt">Overdue invoices</span><b>{overdue.length}</b></div>
          <div><span className="dt">Unpaid, not yet due</span><b>{pounds(all.filter((i) => i.status === "unpaid" && i.days_overdue <= 0).reduce((n, i) => n + i.amount_pence, 0))}</b></div>
        </div>
      )}
      <div className="toolbar mt-l">
        <div className="filter" role="group" aria-label="Show invoices">
          {[["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["disputed", "Disputed"], ["all", "All"]].map(([v, t]) => <button key={v} aria-pressed={show === v} className={show === v ? "is-on" : ""} onClick={() => setShow(v)}>{t}</button>)}
        </div>
      </div>
      <Notice>{note}</Notice>
      {(error || act.error) && <Notice signal>{error?.message || act.error}</Notice>}
      {!data ? <Loading /> : (
        <table className="ledger ws-table">
          <thead><tr><th>Invoice</th><th className="num">Amount</th><th>Due</th><th className="hide-sm num">Reminders</th><th>Status</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} className="empty">{all.length ? "None with that status." : "No invoices yet. Upload a CSV from your accounts software below."}</td></tr>}
            {list.map((i) => (
              <tr key={i.id}>
                <td><b>{i.ref}</b><br /><span className="dt">{i.customer}</span></td>
                <td className="num">{pounds(i.amount_pence)}</td>
                <td>{dateOf(i.due_date)}{i.status === "unpaid" && i.days_overdue > 0 && <><br /><span className="sev sev-crit">{i.days_overdue} days late</span></>}</td>
                <td className="hide-sm num">{i.reminders}{i.last_reminder_at ? <><br /><span className="dt">{since(i.last_reminder_at)}</span></> : ""}</td>
                <td><select aria-label={"Status for " + i.ref} value={i.status} disabled={!can("manager") || act.busy} onChange={(e) => set(i, e.target.value)}><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="disputed">Disputed</option></select></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {can("manager") && (
        <form className="inline-form inline-form-1 mt-l" onSubmit={upload} noValidate>
          <div className="field">
            <span className="flabel">Upload invoices</span>
            <label className={"file" + (file ? " has-file" : "")} htmlFor="inv-file">
              <span>{file ? file.name : "Choose a CSV file"}</span><span className="file-btn">{file ? "Change" : "Browse"}</span>
              <input id="inv-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0] || null)} />
            </label>
            <p className="hint">Columns for invoice number, customer, email, amount and due date. Xero, QuickBooks and Sage exports work as they are. Uploading again updates invoices with the same number.</p>
          </div>
          <button className="btn btn-sm" disabled={act.busy}>{act.busy ? "Uploading…" : "Upload"}</button>
        </form>
      )}
    </Shell>
  );
}

/* ---------- Tasks ---------- */
export function WsTasks() {
  const can = useCan();
  const { data, error, reload } = useApi("/api/ws/tasks");
  const [t, setT] = useState({ title: "", due_date: "" });
  const act = useAction();
  const add = (e) => {
    e.preventDefault();
    if (!t.title.trim()) return act.setError("Say what needs doing.");
    act.run(async () => { await api("POST", "/api/ws/tasks", { title: t.title.trim(), ...(t.due_date ? { due_date: t.due_date } : {}) }); setT({ title: "", due_date: "" }); await reload(); changed(); });
  };
  const toggle = (x) => act.run(async () => { await api("PATCH", "/api/ws/tasks/" + x.id, { status: x.status === "done" ? "open" : "done" }); await reload(); changed(); });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Shell title="Tasks" crumbs={[["Tasks"]]}>
      <p className="body ws-intro">Things only a person can do: a call to make, a visit to book. Agents add them when they reach a step they shouldn't take alone.</p>
      {can("manager") && (
        <form className="inline-form inline-form-2" onSubmit={add} noValidate>
          <div className="field"><label htmlFor="t-title">New task</label><input id="t-title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="Call Salford Quays Media about the quote" /></div>
          <div className="field"><label htmlFor="t-due">Due</label><input id="t-due" type="date" value={t.due_date} onChange={(e) => setT({ ...t, due_date: e.target.value })} /></div>
          <button className="btn btn-sm" disabled={act.busy}>Add</button>
        </form>
      )}
      {(error || act.error) && <Notice signal>{error?.message || act.error}</Notice>}
      {!data ? <Loading /> : (
        <ul className="tasks">
          {data.tasks.length === 0 && <li className="empty">No tasks. Nice.</li>}
          {data.tasks.map((x) => (
            <li key={x.id} className={x.status === "done" ? "is-done" : ""}>
              <label className="check">
                <input type="checkbox" checked={x.status === "done"} disabled={!can("manager") || act.busy} onChange={() => toggle(x)} />
                <span className="box" aria-hidden="true" />
                <span className="task-b"><b>{x.title}</b>{x.detail && <span className="body">{x.detail}</span>}<span className="dt">{x.agent ? `From ${x.agent}` : "Added by you"}{x.due_date ? `, due ${dateOf(x.due_date)}` : ""}{x.status === "open" && x.due_date && x.due_date < today ? " (late)" : ""}</span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
