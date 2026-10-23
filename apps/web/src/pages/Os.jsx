// The business OS in the workspace: Apps (every module, by area), one screen per module (records, a record
// drawer with its thread, and the module's agent), and Messages (channels where people and agents talk).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, navigate, useRoute } from "../router.jsx";
import { useWs, useCan } from "../layout.jsx";
import { Glyph } from "../kit.jsx";
import { api, useApi, useAction, pounds, dateOf } from "../api.js";
import { Shell, Notice, Loading, Failed, changed } from "./Live.jsx";
import { since } from "./Ws.jsx";
import { AREAS, FACETS, KINDS, facet, areaOf } from "../../../../packages/core/os.ts";

export const DEPTH = {
  full: { label: "Native", note: "A full native screen with its agent." },
  partial: { label: "Partly built", note: "Some of this runs natively today; records and the agent fill the rest." },
  basic: { label: "Records + agent", note: "Keep the records here and ask the module's agent. The full native screen is still being built." },
};
/** Where a module's questions go when asked from its own screen: the area's team channel. */
const AREA_CHANNEL = { S: "sales", M: "sales", CS: "sales", F: "finance", P: "finance", PB: "finance", H: "people", W: "people", O: "operations", SC: "operations", FA: "operations" };
const channelFor = (area) => AREA_CHANNEL[area] || "general";
const initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export function DepthPill({ depth }) {
  return <span className={"os-depth os-depth-" + depth} title={DEPTH[depth].note}>{DEPTH[depth].label}</span>;
}

/* ---------- Apps: every module, grouped by area ---------- */
export function WsApps() {
  const { data, error, reload } = useApi("/api/ws/os/catalogue");
  const { query } = useRoute();
  const [q, setQ] = useState(query.q || "");
  const [depth, setDepth] = useState("all");
  const counts = useMemo(() => Object.fromEntries((data?.modules || []).map((m) => [m.key, m])), [data]);
  const words = q.trim().toLowerCase();
  const shown = FACETS.filter((f) => (depth === "all" || f.depth === depth) && (!words || [f.name, f.app, f.agent || "", areaOf(f.area).name].some((s) => s.toLowerCase().includes(words))));
  const byDepth = (d) => FACETS.filter((f) => f.depth === d).length;
  return (
    <Shell title="Apps" crumbs={[["Apps"]]} wide>
      <div className="os-hero">
        <p className="body ws-intro">Every part of running the business, in one place: {FACETS.length} apps across {AREAS.length} areas. Each keeps its own records, has an agent you can ask, and a thread on every record where people and agents work it together.</p>
        {data && <p className="os-totals"><b>{data.totals.records}</b> records <span aria-hidden="true">·</span> <b>{data.totals.agents}</b> app agents at work</p>}
      </div>
      <div className="os-tools">
        <div className="field os-search"><label htmlFor="os-q" className="sr">Find an app</label><input id="os-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an app: payroll, rota, contracts…" /></div>
        <div className="os-seg" role="group" aria-label="Show">
          {[["all", `All ${FACETS.length}`], ["full", `Native ${byDepth("full")}`], ["partial", `Partly built ${byDepth("partial")}`], ["basic", `Records + agent ${byDepth("basic")}`]].map(([k, t]) => (
            <button key={k} className={"os-seg-b" + (depth === k ? " is-on" : "")} aria-pressed={depth === k} onClick={() => setDepth(k)}>{t}</button>
          ))}
        </div>
      </div>
      {error && <Failed error={error} retry={reload} />}
      {shown.length === 0 && <p className="empty">No app matches “{q}”.</p>}
      {AREAS.map((a) => {
        const list = shown.filter((f) => f.area === a.key);
        if (!list.length) return null;
        return (
          <section key={a.key} className="os-area" aria-labelledby={"area-" + a.key} id={"area-" + a.key}>
            <h2 className="os-area-h" id={"area-" + a.key}><span className="os-area-g"><Glyph name={a.glyph} size={18} /></span>{a.name}<span className="dt">{list.length}</span></h2>
            <ul className="os-grid">
              {list.map((f) => {
                const c = counts[f.key];
                return (
                  <li key={f.key}>
                    <Link to={"/workspace/app/" + f.key} className="os-app">
                      <span className="os-app-t"><b>{f.app}</b><DepthPill depth={f.depth} /></span>
                      <span className="os-app-n">{f.name}</span>
                      <span className="os-app-f dt">{c ? (c.records ? `${c.open} open of ${c.records}` : "No records yet") : "…"}{f.agent ? ` · ${f.agent}` : " · People only"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Shell>
  );
}

/* ---------- One module ---------- */
const fieldShown = (f, r, key) => {
  const v = key === "amount" ? r.amount_pence : r.fields[key];
  if (v === null || v === undefined || v === "") return "";
  const fd = KINDS[f.kind].fields.find((x) => x.key === key);
  if (fd?.type === "money") return pounds(r.amount_pence);
  if (fd?.type === "date") { const d = new Date(v + "T12:00:00"); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }); }
  return String(v);
};

export function WsModule({ module }) {
  const f = facet(module);
  const can = useCan();
  const { query } = useRoute();
  const [status, setStatus] = useState("");
  const path = f ? `/api/ws/os/m/${f.key}/records${status ? "?status=" + encodeURIComponent(status) : ""}` : null;
  const { data, error, reload } = useApi(path);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(query.r || null);
  useEffect(() => { setOpen(query.r || null); }, [query.r]);
  if (!f) return <Shell title="App not found" crumbs={[["Apps", "/workspace/apps"], ["Not found"]]}><p className="body">There's no app by that name. <Link to="/workspace/apps" className="link">See every app</Link>.</p></Shell>;
  const k = KINDS[f.kind];
  const area = areaOf(f.area);
  const cols = k.fields.filter((x) => x.type !== "long").slice(0, 3);
  const pick = (id) => navigate(`/workspace/app/${f.key}${id ? "?r=" + id : ""}`);
  return (
    <Shell title={f.app} crumbs={[["Apps", "/workspace/apps"], [area.name, "/workspace/apps?q=" + encodeURIComponent(area.name)], [f.app]]} wide
      actions={can("manager") && <button className="btn btn-sm" onClick={() => setAdding(true)}>New {k.label.toLowerCase()}</button>}>
      <div className="os-mod-head">
        <div className="os-mod-copy">
          <p className="os-mod-name"><Glyph name={area.glyph} size={18} /> {f.name} <DepthPill depth={f.depth} /></p>
          <p className="body">{f.optimal}.</p>
          <p className="dt">{DEPTH[f.depth].note}{f.people ? ` Used by ${f.people.charAt(0).toLowerCase() + f.people.slice(1)}.` : ""}</p>
          {f.link && <p><Link to={f.link} className="link link-s">Open the full {f.app.toLowerCase()} screen</Link></p>}
        </div>
        <AgentCard f={f} />
      </div>

      {adding && <RecordForm f={f} onDone={async (r) => { setAdding(false); if (r) { await reload(); changed(); pick(r.id); } }} />}

      <div className="os-filter" role="group" aria-label="Filter by status">
        {["", ...k.statuses].map((s) => <button key={s || "all"} className={"os-chip" + (status === s ? " is-on" : "")} aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : "All"}</button>)}
      </div>
      {error && <Failed error={error} retry={reload} />}
      {!data ? <Loading /> : data.records.length === 0 ? (
        <div className="os-empty">
          <p className="body"><b>No {k.label.toLowerCase()}s{status ? ` marked ${status}` : ""} yet.</b></p>
          <p className="body">{can("manager") ? `Add the first one, or ask ${f.agent || "a colleague"} to draft some from what you tell it.` : "Records added by your team show here."}</p>
        </div>
      ) : (
        <div className="os-table" role="table" aria-label={f.app + " records"}>
          <div className="os-tr os-th" role="row"><span role="columnheader">Title</span><span role="columnheader">Status</span>{cols.map((c) => <span key={c.key} role="columnheader" className="os-col">{c.label}</span>)}<span role="columnheader" className="os-col">Updated</span></div>
          {data.records.map((r) => (
            <button key={r.id} className={"os-tr" + (open === r.id ? " is-open" : "")} role="row" onClick={() => pick(r.id)}>
              <span role="cell" className="os-title">{r.title}</span>
              <span role="cell"><span className={"os-status os-st-" + k.statuses.indexOf(r.status)}>{r.status}</span></span>
              {cols.map((c) => <span key={c.key} role="cell" className="os-col">{fieldShown(f, r, c.key)}</span>)}
              <span role="cell" className="os-col dt">{since(r.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
      {open && <RecordDrawer f={f} id={open} onClose={() => pick(null)} onChanged={reload} />}
    </Shell>
  );
}

function AgentCard({ f }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const act = useAction();
  const ch = channelFor(f.area);
  if (!f.agent) return (
    <aside className="os-agent os-agent-none"><p className="td-sh">People only</p><p className="body">No agent works {f.app.toLowerCase()}: reports stay between people, and only the people named in your policy see them.</p></aside>
  );
  const ask = (e) => {
    e.preventDefault();
    if (!text.trim()) return act.setError(`Ask ${f.agent} something.`);
    act.run(async () => {
      const { channels } = await api("GET", "/api/ws/os/channels");
      const c = channels.find((x) => x.name === ch) || channels[0];
      const r = await api("POST", `/api/ws/os/channels/${c.id}/messages`, { body: `@${f.agent} ${text.trim()}` });
      setText("");
      setNote(r.asked?.[0]?.error ? r.asked[0].error : `Asked in #${c.name}. The answer comes back there.`);
      setTimeout(() => navigate(`/workspace/messages?c=${c.id}`), 900);
    });
  };
  return (
    <aside className="os-agent" aria-label={f.agent}>
      <p className="os-agent-h"><span className="os-av os-av-agent" aria-hidden="true"><Glyph name="agent" size={16} /></span><span><b>{f.agent}</b><span className="dt">Works {f.app}, asked in #{ch}</span></span></p>
      <form onSubmit={ask} className="os-ask" noValidate>
        <label htmlFor={"ask-" + f.key} className="sr">Ask {f.agent}</label>
        <input id={"ask-" + f.key} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask ${f.agent}…`} />
        <button className="btn btn-sm" disabled={act.busy}>{act.busy ? "Asking…" : "Ask"}</button>
      </form>
      {(act.error || note) && <Notice signal={!!act.error}>{act.error || note}</Notice>}
    </aside>
  );
}

function FieldInput({ fd, value, onChange, id }) {
  const common = { id, value: value ?? "", onChange: (e) => onChange(e.target.value) };
  if (fd.type === "long") return <textarea rows={3} {...common} />;
  if (fd.type === "date") return <input type="date" {...common} />;
  if (fd.type === "money") return <input inputMode="decimal" placeholder="£" {...common} />;
  if (fd.type === "number") return <input inputMode="decimal" {...common} />;
  if (fd.type === "url") return <input type="url" placeholder="https://" {...common} />;
  return <input {...common} />;
}

function RecordForm({ f, onDone }) {
  const k = KINDS[f.kind];
  const [v, setV] = useState({ title: "", status: k.statuses[0], fields: {} });
  const act = useAction();
  const save = (e) => {
    e.preventDefault();
    if (!v.title.trim()) return act.setError("Give it a title.");
    act.run(async () => { const r = await api("POST", `/api/ws/os/m/${f.key}/records`, { title: v.title.trim(), status: v.status, fields: v.fields }); onDone(r.record); });
  };
  return (
    <form className="td-card os-form" onSubmit={save} noValidate>
      <p className="td-sh">New {k.label.toLowerCase()} in {f.app}</p>
      <div className="os-form-g">
        <div className="field os-span"><label htmlFor="nr-title">Title</label><input id="nr-title" autoFocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></div>
        <div className="field"><label htmlFor="nr-status">Status</label><select id="nr-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{k.statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
        {k.fields.map((fd) => (
          <div key={fd.key} className={"field" + (fd.type === "long" ? " os-span" : "")}><label htmlFor={"nr-" + fd.key}>{fd.label}</label><FieldInput fd={fd} id={"nr-" + fd.key} value={v.fields[fd.key]} onChange={(x) => setV({ ...v, fields: { ...v.fields, [fd.key]: x } })} /></div>
        ))}
      </div>
      {act.error && <Notice signal>{act.error}</Notice>}
      <div className="row-actions"><button className="btn btn-sm" disabled={act.busy}>{act.busy ? "Saving…" : "Save"}</button><button type="button" className="btn btn-sm btn-line" onClick={() => onDone(null)}>Cancel</button></div>
    </form>
  );
}

function RecordDrawer({ f, id, onClose, onChanged }) {
  const can = useCan();
  const k = KINDS[f.kind];
  const { data, error, reload } = useApi("/api/ws/os/records/" + id);
  const [v, setV] = useState(null);
  const [note, setNote] = useState("");
  const act = useAction();
  const ref = useRef(null);
  useEffect(() => { if (data?.record) setV({ title: data.record.title, status: data.record.status, fields: { ...data.record.fields, amount: data.record.fields.amount ?? "" } }); }, [data]);
  useEffect(() => { ref.current?.focus(); const esc = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [id]);
  const save = (e) => {
    e.preventDefault();
    act.run(async () => { await api("PATCH", "/api/ws/os/records/" + id, v); setNote("Saved."); await reload(); await onChanged(); changed(); });
  };
  const remove = () => act.run(async () => { await api("DELETE", "/api/ws/os/records/" + id); await onChanged(); onClose(); });
  return (
    <div className="os-drawer-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="os-drawer" role="dialog" aria-modal="true" aria-label={data?.record?.title || "Record"} tabIndex={-1} ref={ref}>
        <div className="os-drawer-h"><p className="dt">{f.app} · {k.label}</p><button className="os-x" onClick={onClose} aria-label="Close"><Glyph name="close" size={18} /></button></div>
        {error && <Failed error={error} retry={reload} />}
        {!v ? <Loading /> : (
          <>
            <form onSubmit={save} noValidate className="os-drawer-f">
              <div className="field"><label htmlFor="rd-title">Title</label><input id="rd-title" value={v.title} disabled={!can("manager")} onChange={(e) => setV({ ...v, title: e.target.value })} /></div>
              <div className="field"><label htmlFor="rd-status">Status</label><select id="rd-status" value={v.status} disabled={!can("manager")} onChange={(e) => setV({ ...v, status: e.target.value })}>{k.statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
              {k.fields.map((fd) => <div key={fd.key} className="field"><label htmlFor={"rd-" + fd.key}>{fd.label}</label><fieldset disabled={!can("manager")} className="os-fs"><FieldInput fd={fd} id={"rd-" + fd.key} value={v.fields[fd.key]} onChange={(x) => setV({ ...v, fields: { ...v.fields, [fd.key]: x } })} /></fieldset></div>)}
              {(act.error || note) && <Notice signal={!!act.error}>{act.error || note}</Notice>}
              {can("manager") && <div className="row-actions"><button className="btn btn-sm" disabled={act.busy}>Save</button><button type="button" className="btn btn-sm btn-line" disabled={act.busy} onClick={remove}>Delete</button></div>}
              <p className="dt">Added by {data.record.created_by} {since(data.record.created_at)}.</p>
            </form>
            <div className="os-drawer-t">
              <p className="td-sh">Thread</p>
              <Thread path={`/api/ws/os/records/${id}/messages`} hint={f.agent ? `Write to the team, or @${f.agent} to ask about this ${k.label.toLowerCase()}` : "Write to the team"} compact />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/* ---------- Threads and channels ---------- */
const POLL_MS = 3000;

/** A message stream with a composer. @ suggests people and agents; mentioning an agent asks it. */
export function Thread({ path, hint, compact }) {
  const { me } = useWs();
  const dir = useApi("/api/ws/os/directory");
  const [msgs, setMsgs] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState("");
  const [sug, setSug] = useState(null);
  const act = useAction();
  const end = useRef(null), input = useRef(null), last = useRef(null);
  const load = async (fresh) => {
    try {
      const after = !fresh && last.current ? "?after=" + encodeURIComponent(last.current) : "";
      const r = await api("GET", path + after);
      setMsgs((m) => { const next = fresh || !m ? r.messages : [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))]; if (next.length) last.current = next[next.length - 1].at; return next; });
      setErr(null);
    } catch (e) { setErr(e); }
  };
  useEffect(() => { last.current = null; setMsgs(null); load(true); const t = setInterval(() => load(false), POLL_MS); return () => clearInterval(t); }, [path]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs?.length]);
  const everyone = useMemo(() => [...(dir.data?.agents || []).map((a) => ({ name: a.name, kind: "agent", hired: a.hired })), ...(dir.data?.people || []).map((p) => ({ name: p.name, kind: "person" }))], [dir.data]);
  const onType = (val) => {
    setText(val);
    const m = val.slice(0, input.current?.selectionStart ?? val.length).match(/@([\w -]{0,30})$/);
    if (!m) return setSug(null);
    const w = m[1].toLowerCase();
    setSug(everyone.filter((x) => x.name.toLowerCase().startsWith(w) || x.name.toLowerCase().includes(" " + w)).sort((a, b) => (b.kind === "person") - (a.kind === "person") || (b.hired ? 1 : 0) - (a.hired ? 1 : 0)).slice(0, 6));
  };
  const choose = (x) => {
    const pos = input.current?.selectionStart ?? text.length;
    const before = text.slice(0, pos).replace(/@([\w -]{0,30})$/, "@" + x.name + " ");
    setText(before + text.slice(pos)); setSug(null); input.current?.focus();
  };
  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    act.run(async () => { await api("POST", path, { body: text.trim() }); setText(""); setSug(null); await load(false); });
  };
  return (
    <div className={"thread" + (compact ? " thread-c" : "")}>
      {err && <Notice signal>{err.message}</Notice>}
      <ol className="thread-l" aria-live="polite">
        {!msgs ? <li><Loading /></li> : msgs.length === 0 ? <li className="empty">Nothing here yet. Start the conversation.</li> : msgs.map((m) => (
          <li key={m.id} className={"msg msg-" + m.author_kind + (m.author_name === me?.user?.name ? " msg-me" : "")}>
            <span className={"os-av" + (m.author_kind === "agent" ? " os-av-agent" : m.author_kind === "system" ? " os-av-sys" : "")} aria-hidden="true">{m.author_kind === "agent" ? <Glyph name="agent" size={15} /> : m.author_kind === "system" ? "!" : initials(m.author_name)}</span>
            <div className="msg-b">
              <p className="msg-h"><b>{m.author_name}</b>{m.author_kind === "agent" && <span className="msg-tag">Agent</span>}<span className="dt">{since(m.at)}</span></p>
              <p className="msg-t">{renderBody(m.body, m.mentions)}</p>
            </div>
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form className="composer" onSubmit={send} noValidate>
        {sug && sug.length > 0 && (
          <ul className="composer-sug" role="listbox" aria-label="Mention">
            {sug.map((x) => <li key={x.kind + x.name}><button type="button" role="option" aria-selected="false" onClick={() => choose(x)}><span className={"os-av" + (x.kind === "agent" ? " os-av-agent" : "")} aria-hidden="true">{x.kind === "agent" ? <Glyph name="agent" size={13} /> : initials(x.name)}</span>{x.name}<span className="dt">{x.kind === "agent" ? (x.hired ? "Agent" : "Agent, starts when asked") : "Person"}</span></button></li>)}
          </ul>
        )}
        <label className="sr" htmlFor={"cmp-" + path}>Message</label>
        <textarea id={"cmp-" + path} ref={input} rows={compact ? 2 : 2} value={text} placeholder={hint} onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !sug?.length) send(e); if (e.key === "Escape") setSug(null); }} />
        <button className="btn btn-sm" disabled={act.busy || !text.trim()}>{act.busy ? "Sending…" : "Send"}</button>
      </form>
      {act.error && <Notice signal>{act.error}</Notice>}
    </div>
  );
}

/** Bold the @mentions in a message: the names the server matched, or a single word. Plain text otherwise. */
function renderBody(body, mentions = []) {
  let names = mentions;
  if (typeof names === "string") { try { names = JSON.parse(names); } catch { names = []; } }
  const alt = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(@(?:${[...alt, "[A-Za-z][\\w-]*"].join("|")}))`, "gi");
  return body.split(re).map((p, i) => (i % 2 === 1 ? <b key={i} className="mention">{p}</b> : <React.Fragment key={i}>{p}</React.Fragment>));
}

export function WsMessages() {
  const can = useCan();
  const { query } = useRoute();
  const { data, error, reload } = useApi("/api/ws/os/channels");
  const [name, setName] = useState("");
  const act = useAction();
  const chans = data?.channels || [];
  const cur = chans.find((c) => c.id === query.c) || chans[0];
  const add = (e) => {
    e.preventDefault();
    act.run(async () => { const r = await api("POST", "/api/ws/os/channels", { name }); setName(""); await reload(); navigate("/workspace/messages?c=" + r.id); });
  };
  return (
    <Shell title="Messages" crumbs={[["Messages"]]} wide>
      <p className="body ws-intro">Where your people and your agents talk. Mention an agent with @ to ask it something: it does the work in its apps and answers here.</p>
      {error && <Failed error={error} retry={reload} />}
      {!data ? <Loading /> : (
        <div className="chat">
          <nav className="chat-side" aria-label="Channels">
            <p className="ws-group-h">Channels</p>
            <ul>
              {chans.map((c) => <li key={c.id}><Link to={"/workspace/messages?c=" + c.id} className={"chat-ch" + (cur?.id === c.id ? " is-on" : "")}># {c.name}{c.messages > 0 && <span className="dt">{c.messages}</span>}</Link></li>)}
            </ul>
            {can("manager") && (
              <form onSubmit={add} className="chat-add" noValidate>
                <label htmlFor="ch-new" className="sr">New channel</label>
                <input id="ch-new" value={name} onChange={(e) => setName(e.target.value)} placeholder="new-channel" />
                <button className="btn btn-sm btn-line" disabled={act.busy || name.trim().length < 2} aria-label="Add channel"><Glyph name="plus" size={16} /></button>
              </form>
            )}
            {act.error && <Notice signal>{act.error}</Notice>}
          </nav>
          <section className="chat-main" aria-label={cur ? "#" + cur.name : "Channel"}>
            {cur && <><h2 className="chat-h"># {cur.name}</h2><Thread key={cur.id} path={`/api/ws/os/channels/${cur.id}/messages`} hint={`Message #${cur.name}. Type @ to mention a person or an agent.`} /></>}
          </section>
        </div>
      )}
    </Shell>
  );
}
