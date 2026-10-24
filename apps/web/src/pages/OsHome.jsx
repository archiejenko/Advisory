// The OS home: one screen in fixed zones. The status core and "Brief me"; Needs you (approve in one go, or
// swipe on a phone); a grid of widgets the owner adds, removes, resizes and reorders; and the dock below.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, navigate } from "../router.jsx";
import { useWs, useCan } from "../layout.jsx";
import { Glyph, Tile } from "../kit.jsx";
import { api, useApi, useAction, pounds, dateOf } from "../api.js";
import { speakText, stopSpeaking } from "../voice.js";
import { Shell, Notice, Loading, Failed, changed } from "./Live.jsx";
import { since } from "./Ws.jsx";
import { Core, statusOf, briefing, useCounts } from "./OsShell.jsx";
import { useOs } from "../osStore.js";
import { facet, areaOf } from "../../../../packages/core/os.ts";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const greeting = () => {
  const h = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const narrow = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 700px)").matches;

/* ---------- Needs you ---------- */
function SwipeCard({ a, onDecide, can, busy }) {
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const [open, setOpen] = useState(false);
  const end = () => {
    if (dx > 90) onDecide("approve", [a.id]); else if (dx < -90) onDecide("reject", [a.id]);
    setDx(0); start.current = null;
  };
  return (
    <li className={"ny-card" + (dx > 40 ? " is-yes" : dx < -40 ? " is-no" : "")}
      onPointerDown={(e) => { if (can && e.pointerType !== "mouse") start.current = e.clientX; }}
      onPointerMove={(e) => { if (start.current !== null) setDx(e.clientX - start.current); }}
      onPointerUp={end} onPointerCancel={() => { setDx(0); start.current = null; }}>
      <div className="ny-card-in" style={{ transform: dx ? `translateX(${dx}px)` : undefined }}>
        <button className="ny-card-b" onClick={() => setOpen(!open)} aria-expanded={open}>
          <b>{a.title}</b><span>{a.agent}, {since(a.created_at)}</span>
          {a.reason && <span className="ny-why">{a.reason}</span>}
        </button>
        {open && <div className="ny-mail"><p className="dt">To <span className="mono">{a.payload.to}</span></p><p><b>{a.payload.subject}</b></p><p className="pre">{a.payload.body}</p></div>}
        {can && (
          <div className="ny-acts">
            <button className="btn btn-sm" disabled={busy} onClick={() => onDecide("approve", [a.id])}>Approve</button>
            <Link to={"/workspace/approvals?a=" + a.id} className="btn btn-sm btn-line">Edit</Link>
            <button className="btn btn-sm btn-line" disabled={busy} onClick={() => onDecide("reject", [a.id])}>Reject</button>
          </div>
        )}
      </div>
      <span className="ny-hint" aria-hidden="true">{dx > 40 ? "Approve" : dx < -40 ? "Reject" : ""}</span>
    </li>
  );
}
function NeedsYou({ d, reload }) {
  const can = useCan();
  const act = useAction();
  const [note, setNote] = useState("");
  const approvals = d.needs_you.approvals || [];
  const decide = (decision, ids) => act.run(async () => {
    const r = await api("POST", "/api/ws/actions/batch", { ids, decision });
    setNote(decision === "approve" ? `Sent ${plural(r.done, "email")}${r.failed ? `; ${r.failed} still waiting` : ""}.` : `Rejected ${plural(r.done, "draft")}. Nothing was sent.`);
    await reload(); changed();
  });
  const rule = (id, status) => act.run(async () => { await api("PATCH", `/api/ws/rules/${id}`, { status }); await reload(); });
  const crit = (d.at_risk.alerts || []).filter((a) => a.severity === "Critical");
  return (
    <section className="os-zone ny" aria-labelledby="ny-h">
      <div className="os-zone-h"><h2 id="ny-h">Needs you</h2>{d.needs_you.total > 0 && <span className="os-badge">{d.needs_you.total}</span>}
        {can("manager") && approvals.length > 1 && <button className="btn btn-sm os-zone-a" disabled={act.busy} onClick={() => decide("approve", approvals.map((a) => a.id))}>{act.busy ? "Sending…" : `Approve all ${approvals.length}`}</button>}
      </div>
      <Notice>{note}</Notice>
      {act.error && <Notice signal>{act.error}</Notice>}
      {d.needs_you.total === 0 && <p className="empty">All clear. Drafts, tasks and anything at risk land here.</p>}
      {approvals.length > 0 && <ul className="ny-list">{approvals.map((a) => <SwipeCard key={a.id} a={a} onDecide={decide} can={can("manager")} busy={act.busy} />)}</ul>}
      {approvals.length > 0 && <p className="dt ny-tip">On a phone, swipe right to approve and left to reject.</p>}
      {crit.length > 0 && <ul className="ny-rows">{crit.map((a) => <li key={a.id}><Link to={"/workspace/alerts?a=" + a.id}><span className="sev sev-crit">Critical</span>{a.name || a.number}: {a.title}</Link></li>)}</ul>}
      {d.needs_you.tasks.length > 0 && <ul className="ny-rows">{d.needs_you.tasks.slice(0, 4).map((t) => <li key={t.id}><Link to="/workspace/tasks"><span className="st">Task</span>{t.title}<i>{t.due_date ? "due " + dateOf(t.due_date) : t.agent || ""}</i></Link></li>)}</ul>}
      {d.needs_you.rules.length > 0 && (
        <ul className="ny-rows">{d.needs_you.rules.map((r) => <li key={r.id} className="ny-rule"><span><span className="st st-waiting">Learned</span>{r.text}</span>{can("manager") && <span className="ny-rule-a"><button className="btn btn-sm" onClick={() => rule(r.id, "active")}>Keep</button><button className="btn btn-sm btn-line" onClick={() => rule(r.id, "dismissed")}>Dismiss</button></span>}</li>)}</ul>
      )}
      {d.needs_you.failed.length > 0 && <ul className="ny-rows">{d.needs_you.failed.map((r) => <li key={r.id}><Link to={"/workspace/runs/" + r.id}><span className="sev sev-rev">Stopped</span>{r.agent}: {r.error || "Stopped"}</Link></li>)}</ul>}
    </section>
  );
}

/* ---------- Widgets ---------- */
const TYPES = {
  money: ["Money", "Overdue and due this week"], pipeline: ["Pipeline", "New customers this week"], today: ["Came in", "Inbox, replies and leads today"],
  team: ["AI Team", "Who's working and what they did"], activity: ["Activity", "The latest work, step by step"], status: ["Status", "The AI Team's state in one line"],
  ask: ["Ask", "A shortcut to the command bar"], module: ["App", "Open records in one app"], "needs-you": ["Needs you", "How many things wait for you"], cash: ["Cash", "Overdue invoices"],
};
const SIZES = [[1, 1], [2, 1], [2, 2]];
function WidgetBody({ w, d, n, cat }) {
  switch (w.type) {
    case "money": case "cash":
      return (
        <div className="wd-nums">
          <Link to="/workspace/invoices" className={"wd-num" + (d.at_risk.overdue_pence ? " is-hot" : "")}><b>{pounds(d.at_risk.overdue_pence)}</b><span>overdue{d.at_risk.overdue_count ? ` · ${plural(d.at_risk.overdue_count, "invoice")}` : ""}</span></Link>
          {w.type === "money" && <Link to="/workspace/invoices" className="wd-num"><b>{pounds(d.money.due_this_week_pence)}</b><span>due in 7 days</span></Link>}
        </div>
      );
    case "pipeline":
      return <div className="wd-nums">{[["new_leads", "new leads"], ["replies", "replies"], ["won", "won"]].map(([k, t]) => <Link key={k} to="/workspace/leads" className="wd-num"><b>{d.week[k]}</b><span>{t} this week</span></Link>)}</div>;
    case "today":
      return <div className="wd-nums"><Link to="/workspace/inbox" className="wd-num"><b>{d.came_in.inbox_new}</b><span>new messages</span></Link><Link to="/workspace/leads" className="wd-num"><b>{d.came_in.replies}</b><span>replies today</span></Link></div>;
    case "team":
      return (
        <div className="wd-team">
          <div className="wd-nums"><div className="wd-num"><b>{n.agents_running ?? 0}</b><span>working</span></div><div className="wd-num"><b>{n.runs_week ?? 0}</b><span>jobs this week</span></div><div className="wd-num"><b>{n.sent_week ?? 0}</b><span>emails sent</span></div></div>
          <Link to="/floor" className="link link-s">Open the Floor</Link>
        </div>
      );
    case "activity":
      return <ul className="wd-list">{(n.activity || []).slice(0, w.h > 1 ? 7 : 3).map((a) => <li key={a.id}><Link to={"/workspace/runs/" + a.id}><b>{a.agent}</b><span>{(a.summary || a.status || "").slice(0, 90)}</span></Link></li>)}{!(n.activity || []).length && <li className="dt">Nothing yet.</li>}</ul>;
    case "status": { const s = statusOf(n, false); return <div className="wd-status"><Core state={s.key} size={30} /><p>{s.line}</p></div>; }
    case "needs-you": return <div className="wd-nums"><div className="wd-num"><b>{d.needs_you.total}</b><span>waiting for you</span></div></div>;
    case "ask": return <button className="wd-ask" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}><Glyph name="search" size={16} />Ask or open anything</button>;
    case "module": {
      const m = cat?.modules?.find((x) => x.key === w.module); const f = facet(w.module);
      if (!f) return <p className="dt">This app isn't in the OS.</p>;
      return <Link to={"/workspace/app/" + f.key} className="wd-num"><b>{m?.open ?? 0}</b><span>open in {f.app}{m?.mode && m.mode !== "here" ? ` (${m.mode === "outsourced" ? "outsourced" : "kept elsewhere"})` : ""}</span></Link>;
    }
    default: return null;
  }
}
function Widgets({ d, n }) {
  const can = useCan();
  const space = narrow() ? "phone" : "desktop";
  const lay = useApi("/api/ws/os/layout?space=" + space);
  const cat = useApi("/api/ws/os/catalogue");
  const o = useOs();
  const [edit, setEdit] = useState(false);
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (lay.data) setList(lay.data.widgets); }, [lay.data]);
  const save = async (next) => {
    setList(next);
    try { await api("PUT", "/api/ws/os/layout?space=" + space, { widgets: next, dock: lay.data?.dock || [] }); setErr(""); } catch (e) { setErr(e.message); }
  };
  if (!list) return <Loading />;
  const move = (i, by) => { const j = i + by; if (j < 0 || j >= list.length) return; const x = [...list]; [x[i], x[j]] = [x[j], x[i]]; save(x); };
  const size = (i) => { const w = list[i]; const k = SIZES.findIndex(([a, b]) => a === w.w && b === w.h); const [nw, nh] = SIZES[(k + 1) % SIZES.length]; save(list.map((x, j) => (j === i ? { ...x, w: nw, h: nh } : x))); };
  const remove = (i) => save(list.filter((_, j) => j !== i));
  const add = (type, module) => { save([...list, { id: "w" + Date.now().toString(36), type, w: 1, h: 1, ...(module ? { module } : {}) }]); setAdding(false); };
  const apps = (o?.os?.modules || []).filter((m) => m.mode !== "off");
  return (
    <section className="os-zone" aria-labelledby="wd-h">
      <div className="os-zone-h"><h2 id="wd-h">Your business</h2>
        {can("manager") && <button className="btn btn-sm btn-line os-zone-a" onClick={() => { setEdit(!edit); setAdding(false); }} aria-pressed={edit}>{edit ? "Done" : "Edit widgets"}</button>}
      </div>
      {err && <Notice signal>{err}</Notice>}
      <div className={"wd-grid" + (edit ? " is-edit" : "")}>
        {list.map((w, i) => (
          <article key={w.id} className={`wd wd-${w.w}x${w.h}`} aria-label={TYPES[w.type]?.[0]}>
            <header className="wd-h"><b>{w.type === "module" ? facet(w.module)?.app || "App" : TYPES[w.type]?.[0]}</b>
              {edit && (
                <span className="wd-ctl">
                  <button onClick={() => move(i, -1)} aria-label="Move earlier" disabled={i === 0}><Glyph name="left" size={14} /></button>
                  <button onClick={() => move(i, 1)} aria-label="Move later" disabled={i === list.length - 1}><Glyph name="right" size={14} /></button>
                  <button onClick={() => size(i)} aria-label={`Resize, now ${w.w} by ${w.h}`}><Glyph name="expand" size={14} /></button>
                  <button onClick={() => remove(i)} aria-label="Remove widget"><Glyph name="close" size={14} /></button>
                </span>
              )}
            </header>
            <WidgetBody w={w} d={d} n={n} cat={cat.data} />
          </article>
        ))}
        {edit && (
          <div className="wd wd-1x1 wd-add">
            {!adding ? <button onClick={() => setAdding(true)}><Glyph name="plus" size={18} />Add a widget</button> : (
              <div className="wd-pick">
                {Object.entries(TYPES).filter(([k]) => k !== "module").map(([k, [t, s]]) => <button key={k} onClick={() => add(k)}><b>{t}</b><span>{s}</span></button>)}
                {apps.slice(0, 12).map((m) => <button key={m.key} onClick={() => add("module", m.key)}><b>{facet(m.key)?.app}</b><span>Open records</span></button>)}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function WsHome() {
  const { me } = useWs();
  const { data: d, error, loading, reload } = useApi("/api/ws/today");
  const n = useCounts();
  const o = useOs();
  const [speaking, setSpeaking] = useState(false);
  const paused = !!o?.os?.ai_paused;
  const st = statusOf(n, paused);
  const first = me.user.name ? me.user.name.split(" ")[0] : null;
  useEffect(() => () => stopSpeaking(), []);
  // A new workspace opens on the OS Builder until the owner launches an OS.
  useEffect(() => { if (o && o.os && !o.os.built && me.role === "owner" && !me.demo) navigate("/workspace/build"); }, [o]);
  const brief = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    try { await speakText(briefing(n, paused, me.org.name)); } catch {} finally { setSpeaking(false); }
  };
  return (
    <Shell title={`${greeting()}${first ? ", " + first : ""}`} bare>
      <div className="oh">
        <section className="oh-status" aria-label="The AI Team">
          <Core state={st.key} size={56} onClick={brief} label={speaking ? "Stop" : "Brief me"} />
          <div><p className="oh-greet">{greeting()}{first ? ", " + first : ""}</p><h1 className="oh-line">{d?.headline || st.line}</h1></div>
          <button className="btn btn-sm btn-line oh-brief" onClick={brief}><Glyph name={speaking ? "mute" : "speaker"} size={16} />{speaking ? "Stop" : "Brief me"}</button>
        </section>
        {error && <Failed error={error} retry={reload} />}
        {loading && !d ? <Loading /> : d && (
          <div className="oh-zones">
            <NeedsYou d={d} reload={reload} />
            <Widgets d={d} n={n} />
          </div>
        )}
      </div>
    </Shell>
  );
}
