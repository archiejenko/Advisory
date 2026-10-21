// The Floor: a business's swarm of agents, live. Spin one up from a description or a preset, then run the
// business from one screen: stations for agents along the stages their work moves through, cards moving
// between them, your desk of approvals and tasks, the numbers, and a command bar you can talk to.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, navigate } from "../router.jsx";
import { useCan, useWs } from "../layout.jsx";
import { api, useApi, useAction, isDemo, pounds } from "../api.js";
import { Glyph } from "../kit.jsx";
import { Shell, Loading, Failed, Notice } from "./Live.jsx";
import { since } from "./Ws.jsx";
import { useVoice, speakText, stopSpeaking, voiceSupported } from "../voice.js";

const POLL_MS = 4000;
const STATE = { idle: "Idle", queued: "Starting", working: "Thinking", tool: "Using a tool", needs_you: "Needs you", failed: "Stopped", paused: "Paused" };
const TPL_GLYPH = { outreach: "send", inbox: "inbox", "credit-control": "pound", "customer-watch": "watch", "customer-check": "check", "lead-finder": "prospect", research: "search", briefing: "bell", custom: "spark" };
const fmt = (unit, v) => unit === "pence" ? "£" + Math.round(v / 100).toLocaleString("en-GB") : unit === "days" ? `${v} ${v === 1 ? "day" : "days"}` : Number(v).toLocaleString("en-GB");
const money = (p) => (p ? "£" + Math.round(p / 100).toLocaleString("en-GB") : null);
const RHYTHM = { weekdays: "Every weekday", daily: "Every day", weekly: "Every Monday", monthly: "Monthly", on_demand: "When asked", on_event: "When something arrives" };

function useNarrow() {
  const q = "(max-width: 860px)";
  const [narrow, set] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const on = () => set(m.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on); }, []);
  return narrow;
}

/* =====================================================================
   Spinning up: describe the business or pick a preset, preview, confirm.
   ===================================================================== */
export function FloorHome() {
  const can = useCan();
  const swarms = useApi("/api/ws/swarms");
  const presets = useApi("/api/ws/swarm-presets");
  const [desc, setDesc] = useState("");
  const [plan, setPlan] = useState(null);
  const act = useAction();
  const voice = useVoice({ serverVoice: presets.data?.voice, onText: (t) => setDesc((d) => (d ? d + " " : "") + t), onError: act.setError });
  const preview = useRef(null);
  useEffect(() => { if (plan) preview.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [plan]);

  const design = (e) => {
    e.preventDefault();
    if (desc.trim().length < 10) return act.setError("Tell us a sentence or two: what the business does, who it sells to, and what eats your time.");
    act.run(async () => {
      const r = await api("POST", "/api/ws/swarms/plan", { description: desc.trim() });
      setPlan({ ...shapeOf(r.blueprint), preview: r.preview, note: r.note, source: r.source, create: r.source === "preset" ? { preset: r.preset, description: desc.trim() } : { blueprint: r.blueprint, description: desc.trim() } });
    });
  };
  const pick = (p) => act.run(async () => {
    const r = await api("POST", "/api/ws/swarms/preview", { preset: p.key });
    setPlan({ title: p.title, sector: p.for, agents: p.agents, stages: p.stages.map((name) => ({ name })), handoffs: p.handoffs || [], kpis: p.kpis, goals: [], preview: r.preview, locked: p.locked, source: "preset", create: { preset: p.key } });
  });
  const spin = () => act.run(async () => {
    const r = await api("POST", "/api/ws/swarms", plan.create);
    navigate("/floor/" + r.id);
  });

  return (
    <Shell title="The Floor" crumbs={[["The Floor"]]}>
      <div className="fh">
        {(swarms.data?.swarms || []).length > 0 && (
          <section className="fh-mine">
            <h2 className="h-sub">Your swarms</h2>
            <div className="fh-grid">
              {swarms.data.swarms.map((w) => (
                <Link key={w.id} to={"/floor/" + w.id} className="fh-swarm">
                  <span className="fh-swarm-t"><Glyph name="floor" size={20} /><b>{w.name}</b></span>
                  <span className="dt">{w.agents} agents · {w.open_items} open cards{w.status === "paused" ? " · paused" : ""}</span>
                  <span className="fh-open">Open the Floor<Glyph name="right" size={16} /></span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="fh-hero">
          <p className="label">Spin up a swarm</p>
          <h1 className="fh-h">Describe your business. We'll staff it with agents.</h1>
          <p className="body">Say what you do, who you sell to and what eats your time. You'll see the agents, how work moves between them and what it will use of your plan before anything starts.</p>
          {can("manager") ? (
            <form className="fh-ask" onSubmit={design} noValidate>
              <label htmlFor="fh-desc" className="sr-only">Describe your business</label>
              <textarea id="fh-desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="We're a 6-person accountancy in Stockport. We need more small-business clients, and we chase late payers by hand." />
              <div className="fh-ask-row">
                {voiceSupported() && (
                  <button type="button" className={"mic mic-sm" + (voice.state !== "idle" ? " mic-on" : "")} onClick={voice.toggle} aria-label={voice.state === "listening" ? "Stop dictating" : "Dictate"} style={{ "--lvl": voice.level }}>
                    <Glyph name="mic" size={20} />
                  </button>
                )}
                <span className="dt">{voice.state === "listening" ? "Listening… tap to stop" : voice.state === "thinking" ? "Writing that down…" : "Type, or tap the mic and talk"}</span>
                <button className="btn btn-sm" disabled={act.busy}>{act.busy ? "Designing…" : "Design my swarm"}</button>
              </div>
            </form>
          ) : <Notice>Only a manager or owner can spin up a swarm.</Notice>}
          {act.error && <p className="form-err" role="alert">{act.error}</p>}
        </section>

        <section>
          <h2 className="h-sub">Or start from a preset</h2>
          {presets.error && <Failed error={presets.error} retry={presets.reload} />}
          <div className="fh-presets">
            {(presets.data?.presets || []).map((p) => (
              <article key={p.key} className={`fh-preset skin-${p.skin}` + (p.locked ? " is-locked" : "")}>
                <div className="fh-preset-art" aria-hidden="true">{p.agents.map((a, i) => <span key={a.key} className="fh-dot" style={{ "--i": i }}><Glyph name={TPL_GLYPH[a.template] || "agent"} size={16} /></span>)}</div>
                <h3>{p.title}</h3>
                <p className="dt">{p.for}</p>
                <p className="body-s">{p.summary}</p>
                <p className="fh-stages">{p.stages.join(" → ")}</p>
                {p.locked ? <p className="fh-lock"><Glyph name="stop" size={16} />{p.locked}</p>
                  : can("manager") && <button className="btn btn-sm btn-ghost" onClick={() => pick(p)} disabled={act.busy}>Preview {p.title}</button>}
              </article>
            ))}
          </div>
        </section>

        {plan && <SwarmPreview ref={preview} plan={plan} busy={act.busy} onSpin={spin} onReset={() => setPlan(null)} can={can("manager")} />}
      </div>
    </Shell>
  );
}

/** A blueprint, in the shape the preview shows. */
function shapeOf(bp) {
  return { title: bp.name, sector: bp.sector, goals: bp.goals || [], agents: bp.agents, stages: bp.stages, handoffs: bp.handoffs || [], kpis: bp.kpis, locked: bp.needs?.length ? `Needs ${bp.needs.join(" and ")}, which isn't available yet.` : null };
}

const SwarmPreview = React.forwardRef(function SwarmPreview({ plan, busy, onSpin, onReset, can }, ref) {
  const pv = plan.preview || {};
  const names = Object.fromEntries((plan.agents || []).map((a) => [a.key, a.name]));
  const blocked = plan.locked || pv.fits === false;
  return (
    <section className="pv" ref={ref} aria-labelledby="pv-h">
      <div className="pv-head">
        <div>
          <p className="label">{plan.source === "generated" ? "Designed for you" : "Preset"}</p>
          <h2 id="pv-h" className="h-sub">{plan.title}<span className="dt"> · {plan.sector}</span></h2>
          {plan.note && <p className="dt">{plan.note}</p>}
        </div>
        <button className="link link-s" style={{ whiteSpace: "nowrap" }} onClick={onReset}>Start over</button>
      </div>
      <div className="pv-agents">
        {plan.agents.map((a, i) => (
          <div key={a.key} className="pv-agent" style={{ "--i": i }}>
            <span className="pv-orb"><Glyph name={TPL_GLYPH[a.template] || "agent"} size={20} /></span>
            <b>{a.name}</b>
            <span className="body-s">{a.role}</span>
            <span className="dt">{a.template === "custom" ? "Custom role" : "From the catalogue"}{a.rhythm ? ` · ${RHYTHM[a.rhythm]}` : ""}</span>
          </div>
        ))}
      </div>
      <div className="pv-flow" aria-label="Stages">
        {plan.stages.map((s, i) => <React.Fragment key={s.key || s.name}>{i > 0 && <span className="pv-arrow" aria-hidden="true">→</span>}<span className={"pv-stage" + (s.done ? " is-done" : "")}>{s.group ? <em>{s.group}</em> : null}{s.name}{s.agent && names[s.agent] ? <small>{names[s.agent]}</small> : null}</span></React.Fragment>)}
      </div>
      {plan.handoffs.length > 0 && <ul className="pv-hand">{plan.handoffs.map((h, i) => <li key={i}><b>{names[h.from] || h.from}</b> hands to <b>{names[h.to] || h.to}</b> when {h.when.charAt(0).toLowerCase() + h.when.slice(1)}</li>)}</ul>}
      <dl className="pv-nums">
        <div><dt>Agents</dt><dd>{pv.agents ?? plan.agents.length}{pv.reuses?.length ? <small>{pv.reuses.length} already working for you</small> : null}</dd></div>
        <div><dt>On your {pv.plan} plan</dt><dd className={pv.fits === false ? "is-bad" : ""}>{pv.agents_after} of {pv.plan_agents} agents</dd></div>
        <div><dt>Actions a month, about</dt><dd className={pv.within_allowance === false ? "is-warn" : ""}>{(pv.actions_a_month || 0).toLocaleString("en-GB")}<small>of {(pv.allowance || 0).toLocaleString("en-GB")} included</small></dd></div>
        <div><dt>Sending</dt><dd>Every email waits for you<small>Change it per agent later</small></dd></div>
      </dl>
      {plan.locked && <Notice signal>{plan.locked}</Notice>}
      {pv.fits === false && <Notice signal>This swarm needs more agents than your plan includes. Remove agents you don't need, or move to a bigger plan in Usage and plan.</Notice>}
      {can && <div className="actions"><button className="btn" onClick={onSpin} disabled={busy || !!blocked}>{busy ? "Spinning up…" : "Spin it up"}</button><span className="dt">Opens the Floor. Agents start on their schedules; nothing is sent without you.</span></div>}
    </section>
  );
});

/* =====================================================================
   The Floor
   ===================================================================== */
export function FloorView({ id }) {
  const can = useCan();
  const { me } = useWs();
  const narrow = useNarrow();
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [events, setEvents] = useState([]);
  const [fx, setFx] = useState({ sparks: [], pulses: [], flash: {} });
  const [view, setView] = useState("floor");
  const [drawer, setDrawer] = useState(null);
  const [polledAt, setPolledAt] = useState(0);
  const cursor = useRef(0);
  const presets = useApi("/api/ws/swarm-presets");
  const serverVoice = !!presets.data?.voice;

  const animate = useCallback((evs) => {
    const sparks = [], pulses = [], flash = {};
    for (const e of evs) {
      if (e.kind === "tool" && e.agent_id) sparks.push({ id: e.id, agent: e.agent_id, label: e.summary });
      const d = e.detail || {};
      if ((e.kind === "handoff" || e.kind === "moved") && d.from_agent && d.to_agent && d.from_agent !== d.to_agent) pulses.push({ id: e.id, from: d.from_agent, to: d.to_agent, label: e.summary.split(":")[0].replace(/ handed .*/, "") });
      if (e.item_id) flash[e.item_id] = e.kind;
    }
    if (!sparks.length && !pulses.length && !Object.keys(flash).length) return;
    setFx((f) => ({ sparks: [...f.sparks, ...sparks].slice(-24), pulses: [...f.pulses, ...pulses].slice(-8), flash: { ...f.flash, ...flash } }));
    const ids = new Set([...sparks, ...pulses].map((x) => x.id));
    setTimeout(() => setFx((f) => ({ sparks: f.sparks.filter((x) => !ids.has(x.id)), pulses: f.pulses.filter((x) => !ids.has(x.id)), flash: Object.fromEntries(Object.entries(f.flash).filter(([k]) => !(k in flash))) })), 2600);
  }, []);

  const load = useCallback(async () => {
    try {
      const first = !cursor.current;
      const r = await api("GET", `/api/ws/swarms/${id}?since=${cursor.current}`);
      setS(r); setErr(null); setPolledAt(Date.now());
      if (r.events.length) {
        setEvents((ev) => [...ev, ...r.events.filter((e) => !ev.some((x) => x.id === e.id))].slice(-80));
        if (!first) animate(r.events);
      }
      cursor.current = Math.max(cursor.current, r.cursor || 0);
    } catch (e) { setErr(e); }
  }, [id, animate]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e) => { if (e.key === "Escape") setDrawer(null); if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); document.getElementById("fl-cmd")?.focus(); } };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); stopSpeaking(); };
  }, []);

  const decide = async (actionId, verb) => { await api("POST", `/api/ws/actions/${actionId}/${verb}`, {}); await load(); };
  const setStatus = async (agentId, status) => { await api("PATCH", `/api/ws/my-agents/${agentId}`, { status }); await load(); };

  if (err && !s) return <div className="fl fl-loading"><Failed error={err} retry={load} /><Link to="/floor" className="link">Back to your swarms</Link></div>;
  if (!s) return <div className="fl fl-loading" aria-busy="true"><span className="fl-boot" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ "--i": i }} />)}</span><p>Opening the Floor…</p></div>;

  const sw = s.swarm;
  const waiting = s.desk.approvals.length + s.desk.failed.length;
  const props = { s, fx, events, can, onStation: (st) => setDrawer({ kind: "station", id: st.id }), onCard: (c) => c.ref_kind === "lead" ? setDrawer({ kind: "company", id: c.ref_id }) : setDrawer({ kind: "card", id: c.id }) };
  return (
    <div className={`fl skin-${sw.skin}`} role="dialog" aria-modal="true" aria-label={`The Floor: ${sw.name}`}>
      {me.demo && <div className="fl-demo">Demo Floor for Brightwork Cleaning. Agents here are simulated; approve and ask away. <Link to="/start">Start your own</Link></div>}
      <header className="fl-top">
        <Link to="/workspace" className="fl-x" aria-label="Close the Floor"><Glyph name="close" size={20} /></Link>
        <div className="fl-title">
          <b>{sw.name}</b>
          <span className="fl-sub"><span className={"fl-live" + (sw.status === "paused" ? " is-paused" : "")} aria-hidden="true" />{sw.status === "paused" ? "Paused" : "Live"} · {s.stations.length} agents · updated {Math.max(0, Math.round((Date.now() - polledAt) / 1000))}s ago</span>
        </div>
        <nav className="fl-views" aria-label="Views">
          {[["floor", "Floor", "floor"], ["board", "Board", "board"], ["companies", "Companies", "building"]].map(([k, t, g]) => (
            <button key={k} className={view === k ? "is-on" : ""} aria-pressed={view === k} onClick={() => setView(k)}><Glyph name={g} size={16} />{t}</button>
          ))}
        </nav>
        {can("manager") && (
          <button className="fl-btn" onClick={async () => { await api("PATCH", `/api/ws/swarms/${sw.id}`, { status: sw.status === "paused" ? "running" : "paused" }); load(); }}>
            <Glyph name={sw.status === "paused" ? "play" : "pause"} size={16} />{sw.status === "paused" ? "Resume all" : "Pause all"}
          </button>
        )}
      </header>

      <Kpis kpis={s.kpis} usage={s.usage} />

      {narrow ? (
        <MobileFloor {...props} view={view} waiting={waiting} decide={decide} reload={load} />
      ) : (
        <div className="fl-body">
          <main className="fl-main">
            {view === "floor" && <FloorMap {...props} />}
            {view === "board" && <Board {...props} reload={load} />}
            {view === "companies" && <Companies can={can} openId={drawer?.kind === "company" ? drawer.id : null} onOpen={(cid) => setDrawer({ kind: "company", id: cid })} />}
            <Ticker events={events} stations={s.stations} />
          </main>
          <Desk s={s} can={can} decide={decide} onFailed={(r) => navigate("/workspace/runs/" + r.id)} />
        </div>
      )}

      <CommandBar swarmId={sw.id} stations={s.stations} can={can} serverVoice={serverVoice} onDone={load} setStatus={setStatus} />

      {drawer && <Drawer drawer={drawer} s={s} can={can} close={() => setDrawer(null)} setStatus={setStatus} reload={load} />}
    </div>
  );
}

/* ---------- The numbers ---------- */
function Kpis({ kpis, usage }) {
  return (
    <div className="fl-kpis">
      {kpis.map((k) => <div key={k.key} className="fl-kpi"><span>{k.label}</span><b>{fmt(k.unit, k.value)}</b></div>)}
      <div className="fl-kpi fl-kpi-use">
        <span>Actions this month</span>
        <b>{usage.actions_month.toLocaleString("en-GB")}<small> / {usage.allowance.toLocaleString("en-GB")}</small></b>
        <i className="fl-meter" style={{ "--p": Math.min(1, usage.actions_month / Math.max(1, usage.allowance)) }} aria-hidden="true" />
      </div>
    </div>
  );
}

/* ---------- The map: stations on the lanes of the stages they own ---------- */
function FloorMap({ s, fx, onStation, onCard }) {
  const stages = s.blueprint.stages;
  const groups = useMemo(() => {
    const g = [];
    for (const st of stages) { const name = st.group || ""; let row = g.find((x) => x.name === name); if (!row) g.push(row = { name, stages: [] }); row.stages.push(st); }
    return g;
  }, [stages]);
  const byKey = Object.fromEntries(s.stations.map((x) => [x.key, x]));
  const homed = new Set();
  const home = {};
  for (const st of stages) if (byKey[st.agent] && !homed.has(st.agent)) { homed.add(st.agent); home[st.key] = [...(home[st.key] || []), byKey[st.agent]]; }
  const support = s.stations.filter((x) => !homed.has(x.key));
  const canvas = useRef(null), refs = useRef({});
  const [pos, setPos] = useState({});
  const measure = useCallback(() => {
    const c = canvas.current; if (!c) return;
    const base = c.getBoundingClientRect(), out = {};
    for (const [id, el] of Object.entries(refs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect(), l = r.left - base.left + c.scrollLeft, t = r.top - base.top + c.scrollTop;
      out[id] = { x: l + r.width / 2, y: t + r.height / 2, l, r: l + r.width, t, b: t + r.height };
    }
    setPos((p) => (JSON.stringify(p) === JSON.stringify(out) ? p : out));
  }, []);
  useLayoutEffect(() => { measure(); });
  useEffect(() => { const ro = new ResizeObserver(measure); if (canvas.current) ro.observe(canvas.current); return () => ro.disconnect(); }, [measure]);
  const idOf = Object.fromEntries(s.stations.map((x) => [x.key, x.id]));
  // Routes run edge to edge through the gaps between lanes; stations on the same column curve round the side.
  const curve = (a, b) => {
    if (!a || !b) return null;
    if (b.l >= a.r - 4) { const k = Math.max(28, (b.l - a.r) / 2); return `M${a.r} ${a.y} C${a.r + k} ${a.y}, ${b.l - k} ${b.y}, ${b.l} ${b.y}`; }
    if (b.r <= a.l + 4) { const k = Math.max(28, (a.l - b.r) / 2); return `M${a.l} ${a.y} C${a.l - k} ${a.y}, ${b.r + k} ${b.y}, ${b.r} ${b.y}`; }
    const side = Math.max(a.r, b.r) + 36;
    return `M${a.r} ${a.y} C${side} ${a.y}, ${side} ${b.y}, ${b.r} ${b.y}`;
  };
  const routes = s.blueprint.handoffs.map((h) => ({ key: h.from + ">" + h.to, d: curve(pos[idOf[h.from]], pos[idOf[h.to]]), active: fx.pulses.some((p) => p.from === idOf[h.from] && p.to === idOf[h.to]) })).filter((r) => r.d);
  const cardsFor = (st) => s.items.filter((i) => i.stage === st.key && (st.done ? true : i.status === "open")).slice(0, st.done ? 4 : 7);
  const countFor = (st) => s.items.filter((i) => i.stage === st.key && i.status === (st.done ? "done" : "open")).length;
  return (
    <div className="fm" ref={canvas}>
      <svg className="fm-routes" aria-hidden="true">
        {routes.map((r) => <path key={r.key} d={r.d} className={r.active ? "is-active" : ""} />)}
      </svg>
      {groups.map((g) => (
        <section key={g.name || "main"} className="fm-group" aria-label={g.name || "Stages"}>
          {g.name && <h3 className="fm-gname">{g.name}</h3>}
          <div className="fm-lanes" style={{ "--n": g.stages.length }}>
            {g.stages.map((st) => (
              <div key={st.key} className={"fm-lane" + (st.done ? " is-done" : "")}>
                <div className="fm-lane-h"><span>{st.name}</span><b>{countFor(st)}</b></div>
                {(home[st.key] || []).map((x) => <Station key={x.id} st={x} fx={fx} onClick={() => onStation(x)} innerRef={(el) => { refs.current[x.id] = el; }} />)}
                <div className="fm-cards">
                  {cardsFor(st).map((c) => (
                    <button key={c.id} className={"fm-card" + (fx.flash[c.id] ? " is-flash" : "") + (c.status !== "open" ? " is-past" : "")} onClick={() => onCard(c)} title={c.note || c.title}>
                      <span className="fm-card-t">{c.title}</span>
                      {money(c.value_pence) && <span className="fm-card-v">{money(c.value_pence)}</span>}
                    </button>
                  ))}
                  {countFor(st) > cardsFor(st).length && <span className="fm-more">+{countFor(st) - cardsFor(st).length} more</span>}
                  {countFor(st) === 0 && <span className="fm-empty">Nothing here</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {support.length > 0 && (
        <section className="fm-support" aria-label="Also on the floor">
          <h3 className="fm-gname">Also on the floor</h3>
          <div className="fm-support-row">{support.map((x) => <Station key={x.id} st={x} fx={fx} onClick={() => onStation(x)} innerRef={(el) => { refs.current[x.id] = el; }} />)}</div>
        </section>
      )}
      {fx.pulses.map((p) => {
        const d = curve(pos[p.from], pos[p.to]);
        return d ? <span key={p.id} className="fm-pulse" style={{ offsetPath: `path("${d}")` }}><i />{p.label && <em>{p.label}</em>}</span> : null;
      })}
    </div>
  );
}

function Station({ st, fx, onClick, innerRef }) {
  const sparks = fx.sparks.filter((x) => x.agent === st.id);
  return (
    <button ref={innerRef} className={`stn stn-${st.state}`} onClick={onClick} aria-label={`${st.name}: ${STATE[st.state]}${st.waiting ? `, ${st.waiting} waiting for you` : ""}`}>
      <span className="stn-orb"><Glyph name={TPL_GLYPH[st.template] || st.glyph || "agent"} size={20} /></span>
      <span className="stn-txt">
        <b className="stn-name">{st.name}</b>
        <span className="stn-state">{STATE[st.state]}{st.state === "tool" && st.tool ? `: ${st.tool}` : ""}</span>
      </span>
      {st.waiting > 0 && <span className="stn-badge">{st.waiting}</span>}
      {st.current && st.state !== "idle" && <span className="stn-cur">{st.current.title}</span>}
      {sparks.map((x, i) => <span key={x.id} className="stn-spark" style={{ "--i": i }}>{x.label}</span>)}
    </button>
  );
}

/* ---------- The ticker: what just happened ---------- */
const KIND_GLYPH = { tool: "tools", handoff: "split", moved: "right", created: "spark", proposed: "send", sent: "send", run_started: "play", run_done: "check", run_failed: "stop", ask: "mic", brief: "speaker" };
function Ticker({ events, stations }) {
  const name = Object.fromEntries(stations.map((x) => [x.id, x.name]));
  const recent = events.filter((e) => e.kind !== "tool").slice(-6).reverse();
  return (
    <div className="fl-tick" aria-live="polite">
      <span className="fl-tick-h">Just now</span>
      <ol>
        {recent.length === 0 && <li className="dt">Waiting for the first move…</li>}
        {recent.map((e) => <li key={e.id} className={"k-" + e.kind}><Glyph name={KIND_GLYPH[e.kind] || "spark"} size={14} /><span>{e.agent_id && !e.summary.startsWith(name[e.agent_id] || "~") ? <b>{name[e.agent_id]} </b> : null}{e.summary}</span><time>{since(e.at)}</time></li>)}
      </ol>
    </div>
  );
}

/* ---------- Your desk: what waits on you ---------- */
function Desk({ s, can, decide, onFailed }) {
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const go = async (id, verb) => { setBusy(id + verb); try { await decide(id, verb); } finally { setBusy(""); } };
  const n = s.desk.approvals.length + s.desk.tasks.length + s.desk.failed.length;
  return (
    <aside className="desk" aria-label="Your desk">
      <h2 className="desk-h">Your desk<b>{n}</b></h2>
      {n === 0 && <p className="desk-empty">Nothing needs you. The swarm will put drafts and decisions here.</p>}
      {s.desk.approvals.length > 0 && <h3 className="desk-sh">To approve</h3>}
      {s.desk.approvals.map((a) => (
        <article key={a.id} className={"dk dk-approve" + (open === a.id ? " is-open" : "")}>
          <button className="dk-head" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
            <span className="dk-agent">{a.agent}</span><b>{a.payload.subject || a.title}</b><span className="dt">to {a.payload.to} · {since(a.created_at)}</span>
          </button>
          {open === a.id && (
            <div className="dk-body">
              {a.reason && <p className="dk-why">{a.reason}</p>}
              <pre className="dk-mail">{a.payload.body}</pre>
            </div>
          )}
          {can("manager") && (
            <div className="dk-acts">
              <button className="btn btn-sm" disabled={!!busy} onClick={() => go(a.id, "approve")}>{busy === a.id + "approve" ? "Sending…" : "Approve and send"}</button>
              <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => go(a.id, "reject")}>Reject</button>
            </div>
          )}
        </article>
      ))}
      {s.desk.failed.length > 0 && <h3 className="desk-sh">Stopped</h3>}
      {s.desk.failed.map((r) => <button key={r.id} className="dk dk-fail" onClick={() => onFailed(r)}><b>{r.agent}</b><span className="dt">{r.error}</span></button>)}
      {s.desk.tasks.length > 0 && <h3 className="desk-sh">Tasks</h3>}
      {s.desk.tasks.map((t) => <div key={t.id} className="dk dk-task"><b>{t.title}</b>{t.detail && <span className="dt">{t.detail}</span>}<span className="dt">{t.agent ? `From ${t.agent}` : "Yours"}{t.due_date ? ` · due ${t.due_date}` : ""}</span></div>)}
    </aside>
  );
}

/* ---------- The command bar: type or talk ---------- */
function CommandBar({ swarmId, stations, can, serverVoice, onDone, setStatus }) {
  const [q, setQ] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [speak, setSpeak] = useState(() => { try { return localStorage.getItem("ah:speak") === "1"; } catch { return false; } });
  const send = async (text, voiceIn = false) => {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true); setQ("");
    try {
      const r = await api("POST", `/api/ws/swarms/${swarmId}/ask`, { text: t, voice: voiceIn });
      setLog((l) => [...l.slice(-3), { q: t, ...r, at: Date.now() }]);
      if (speak || voiceIn) speakText(r.say, { serverVoice });
      onDone();
    } catch (e) { setLog((l) => [...l.slice(-3), { q: t, type: "error", say: e.message, at: Date.now() }]); }
    finally { setBusy(false); }
  };
  const voice = useVoice({ serverVoice, onText: (t) => send(t, true), onError: (m) => setLog((l) => [...l.slice(-3), { type: "error", say: m, at: Date.now() }]) });
  const toggleSpeak = () => { const v = !speak; setSpeak(v); try { localStorage.setItem("ah:speak", v ? "1" : "0"); } catch {} if (!v) stopSpeaking(); };
  const confirm = async (entry, yes) => {
    setLog((l) => l.map((x) => (x === entry ? { ...x, done: yes ? "confirmed" : "cancelled" } : x)));
    if (yes) { await setStatus(entry.change.agent_id, entry.change.action === "pause" ? "paused" : "running"); }
  };
  const last = log[log.length - 1];
  if (!can("manager")) return <div className="cmd cmd-ro"><span className="dt">Only a manager or owner can instruct the swarm.</span></div>;
  return (
    <div className="cmd">
      {last && (
        <div className={"cmd-say t-" + last.type} role="status">
          {last.q && <span className="cmd-q">“{last.q}”</span>}
          <span>{last.say}</span>
          {last.type === "change" && !last.done && <span className="cmd-confirm"><button className="btn btn-sm" onClick={() => confirm(last, true)}>Yes, {last.change.action}</button><button className="btn btn-sm btn-ghost" onClick={() => confirm(last, false)}>Cancel</button></span>}
          {last.done && <span className="dt">{last.done === "confirmed" ? "Done." : "Left as it was."}</span>}
          <button className="cmd-dismiss" aria-label="Dismiss" onClick={() => setLog([])}><Glyph name="close" size={14} /></button>
        </div>
      )}
      <form className="cmd-bar" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        {voiceSupported() && (
          <button type="button" className={"mic" + (voice.state !== "idle" ? " mic-on" : "") + (voice.state === "thinking" ? " mic-think" : "")} onClick={voice.toggle} aria-label={voice.state === "listening" ? "Stop and send" : "Talk to the swarm"} style={{ "--lvl": voice.level }}>
            <Glyph name="mic" size={22} />
          </button>
        )}
        <label htmlFor="fl-cmd" className="sr-only">Instruct the swarm</label>
        <input id="fl-cmd" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
          placeholder={voice.state === "listening" ? "Listening… tap the mic to send" : voice.state === "thinking" ? "Writing that down…" : `Ask the swarm, or @${stations.find((x) => x.engine === "llm")?.key || "agent"} do something   ( / )`} />
        <button type="button" className="cmd-chip" onClick={() => send("brief me")} disabled={busy}>Brief me</button>
        <button type="button" className={"cmd-icon" + (speak ? " is-on" : "")} onClick={toggleSpeak} aria-pressed={speak} aria-label={speak ? "Stop reading replies aloud" : "Read replies aloud"}><Glyph name={speak ? "speaker" : "mute"} size={18} /></button>
        <button className="btn btn-sm" disabled={busy || !q.trim()}>{busy ? "…" : "Send"}</button>
      </form>
    </div>
  );
}

/* ---------- Board: every stage as a column ---------- */
function Board({ s, can, onCard, reload }) {
  const owner = Object.fromEntries(s.stations.map((x) => [x.id, x]));
  const move = async (c, stage) => { try { await api("PATCH", `/api/ws/work-items/${c.id}`, { stage }); } catch (e) { alert(e.message); } reload(); };
  const movable = (c) => !c.ref_kind || c.ref_kind === "lead";
  return (
    <div className="bd">
      {s.blueprint.stages.map((st) => {
        const cards = s.items.filter((i) => i.stage === st.key && (st.done || i.status === "open"));
        return (
          <section key={st.key} className={"bd-col" + (st.done ? " is-done" : "")} aria-label={st.name}>
            <h3>{st.group ? <em>{st.group}</em> : null}{st.name}<b>{cards.length}</b></h3>
            {cards.map((c) => (
              <div key={c.id} className="bd-card">
                <button className="bd-card-t" onClick={() => onCard(c)}>{c.title}</button>
                <span className="dt">{owner[c.agent_id]?.name || "Unassigned"}{money(c.value_pence) ? ` · ${money(c.value_pence)}` : ""} · {since(c.updated_at)}</span>
                {can("manager") && movable(c) && (
                  <select aria-label={`Move ${c.title}`} value={c.stage} onChange={(e) => move(c, e.target.value)}>
                    {s.blueprint.stages.filter((x) => c.ref_kind !== "lead" || x.rule?.source === "lead").map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                  </select>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- Companies: the CRM ---------- */
function Companies({ can, openId, onOpen }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const list = useApi("/api/ws/crm/companies" + (term ? "?q=" + encodeURIComponent(term) : ""));
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const [name, setName] = useState("");
  const add = (e) => { e.preventDefault(); act.run(async () => { const r = await api("POST", "/api/ws/crm/companies", { company: name.trim() }); setName(""); setAdding(false); list.reload(); onOpen(r.id); }); };
  return (
    <div className="co">
      <div className="co-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a company" aria-label="Find a company" />
        {can("manager") && <button className="btn btn-sm btn-ghost" onClick={() => setAdding(!adding)}>Add a company</button>}
      </div>
      {adding && <form className="co-add" onSubmit={add}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" aria-label="Company name" /><button className="btn btn-sm" disabled={act.busy || !name.trim()}>Add</button>{act.error && <span className="form-err">{act.error}</span>}</form>}
      {list.error && <Failed error={list.error} retry={list.reload} />}
      {!list.data ? <Loading /> : (
        <table className="co-t">
          <thead><tr><th>Company</th><th>Stage</th><th className="num">Open deals</th><th>Last activity</th></tr></thead>
          <tbody>
            {list.data.companies.map((c) => (
              <tr key={c.id} className={openId === c.id ? "is-on" : ""} onClick={() => onOpen(c.id)}>
                <td><button className="link" onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}>{c.company}</button><span className="dt">{c.contacts ? `${c.contacts} ${c.contacts === 1 ? "contact" : "contacts"}` : c.email || ""}</span></td>
                <td><span className={"pill p-" + c.status}>{c.status}</span></td>
                <td className="num">{money(c.open_pence) || "—"}</td>
                <td className="dt">{since(c.last_activity_at || c.created_at)}</td>
              </tr>
            ))}
            {list.data.companies.length === 0 && <tr><td colSpan={4} className="dt">No companies yet. Your agents add them as they find leads.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CompanyPanel({ id, can }) {
  const v = useApi("/api/ws/crm/companies/" + id);
  const act = useAction();
  const [note, setNote] = useState("");
  const [deal, setDeal] = useState({ title: "", value: "" });
  const [person, setPerson] = useState({ name: "", role: "", email: "" });
  if (v.error) return <Failed error={v.error} retry={v.reload} />;
  if (!v.data) return <Loading />;
  const { company: c, contacts, deals, timeline } = v.data;
  const addNote = (e) => { e.preventDefault(); act.run(async () => { await api("POST", "/api/ws/crm/notes", { lead_id: id, summary: note.trim() }); setNote(""); v.reload(); }); };
  const addDeal = (e) => { e.preventDefault(); act.run(async () => { await api("POST", "/api/ws/crm/deals", { lead_id: id, title: deal.title.trim(), value_pence: Math.round(Number(deal.value || 0) * 100) }); setDeal({ title: "", value: "" }); v.reload(); }); };
  const addPerson = (e) => { e.preventDefault(); act.run(async () => { await api("POST", "/api/ws/crm/contacts", { lead_id: id, name: person.name.trim(), ...(person.role ? { role: person.role } : {}), ...(person.email ? { email: person.email } : {}) }); setPerson({ name: "", role: "", email: "" }); v.reload(); }); };
  const won = (d) => act.run(async () => { await api("PATCH", `/api/ws/crm/deals/${d.id}`, { status: "won" }); v.reload(); });
  return (
    <div className="cp">
      <p className="label">Company</p>
      <h2 className="h-sub">{c.company}</h2>
      <p className="dt">{[c.number && `Company ${c.number}`, c.email, c.website].filter(Boolean).join(" · ")}</p>
      <span className={"pill p-" + c.status}>{c.status}</span>
      {c.notes && <p className="body-s">{c.notes}</p>}
      <h3 className="cp-h">People</h3>
      {contacts.length === 0 ? <p className="dt">No contacts yet.</p> : <ul className="cp-list">{contacts.map((p) => <li key={p.id}><b>{p.name}</b>{p.role && <span>{p.role}</span>}<span className="dt">{[p.email, p.phone].filter(Boolean).join(" · ")}</span></li>)}</ul>}
      {can("manager") && <form className="cp-form" onSubmit={addPerson}><input value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} placeholder="Name" aria-label="Contact name" /><input value={person.role} onChange={(e) => setPerson({ ...person, role: e.target.value })} placeholder="Role" aria-label="Role" /><input value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} placeholder="Email" aria-label="Email" type="email" /><button className="btn btn-sm btn-ghost" disabled={act.busy || !person.name.trim()}>Add person</button></form>}
      <h3 className="cp-h">Deals</h3>
      {deals.length === 0 ? <p className="dt">No deals yet.</p> : <ul className="cp-list">{deals.map((d) => <li key={d.id}><b>{d.title}</b><span>{money(d.value_pence) || "£0"} · {d.status === "open" ? d.stage : d.status}</span>{can("manager") && d.status === "open" && <button className="link link-s" onClick={() => won(d)}>Mark won</button>}</li>)}</ul>}
      {can("manager") && <form className="cp-form" onSubmit={addDeal}><input value={deal.title} onChange={(e) => setDeal({ ...deal, title: e.target.value })} placeholder="What you're selling" aria-label="Deal" /><input value={deal.value} onChange={(e) => setDeal({ ...deal, value: e.target.value.replace(/[^\d.]/g, "") })} placeholder="£ value" aria-label="Value in pounds" inputMode="decimal" /><button className="btn btn-sm btn-ghost" disabled={act.busy || !deal.title.trim()}>Add deal</button></form>}
      <h3 className="cp-h">Timeline</h3>
      {can("manager") && <form className="cp-form" onSubmit={addNote}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note or a call" aria-label="Note" /><button className="btn btn-sm btn-ghost" disabled={act.busy || !note.trim()}>Add</button></form>}
      {act.error && <p className="form-err">{act.error}</p>}
      <ol className="cp-tl">{timeline.map((t, i) => <li key={i} className={"k-" + t.kind}><b>{t.summary}</b><span className="dt">{t.agent || t.actor} · {since(t.at)}</span></li>)}{timeline.length === 0 && <li className="dt">Nothing yet.</li>}</ol>
    </div>
  );
}

/* ---------- Drawer: a station, a company or a card ---------- */
function Drawer({ drawer, s, can, close, setStatus, reload }) {
  const panel = useRef(null);
  useEffect(() => { panel.current?.focus(); }, [drawer]);
  return (
    <div className="dr-wrap" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside className="dr" ref={panel} tabIndex={-1} aria-label="Details">
        <button className="dr-x" onClick={close} aria-label="Close"><Glyph name="close" size={18} /></button>
        {drawer.kind === "station" && <StationPanel st={s.stations.find((x) => x.id === drawer.id)} s={s} can={can} setStatus={setStatus} reload={reload} />}
        {drawer.kind === "company" && <CompanyPanel id={drawer.id} can={can} />}
        {drawer.kind === "card" && (() => { const c = s.items.find((x) => x.id === drawer.id); return c ? <div className="cp"><p className="label">Card</p><h2 className="h-sub">{c.title}</h2><p className="dt">{s.blueprint.stages.find((x) => x.key === c.stage)?.name} · {s.stations.find((x) => x.id === c.agent_id)?.name || "Unassigned"} · {since(c.updated_at)}</p>{c.note && <p className="body-s">{c.note}</p>}</div> : <p className="dt">This card has moved on.</p>; })()}
      </aside>
    </div>
  );
}

function StationPanel({ st, s, can, setStatus, reload }) {
  const [input, setInput] = useState("");
  const act = useAction();
  if (!st) return <p className="dt">This agent has left the swarm.</p>;
  const bp = s.blueprint.agents.find((a) => a.key === st.key);
  const owns = s.blueprint.stages.filter((x) => x.agent === st.key).map((x) => x.name);
  const hands = s.blueprint.handoffs.filter((h) => h.from === st.key);
  const runNow = (e) => { e.preventDefault(); act.run(async () => { await api("POST", `/api/ws/my-agents/${st.id}/run`, input.trim() ? { input: input.trim() } : {}); setInput(""); reload(); }); };
  return (
    <div className="cp">
      <span className={`stn-orb stn-${st.state} stn-big`}><Glyph name={TPL_GLYPH[st.template] || "agent"} size={26} /></span>
      <h2 className="h-sub">{st.name}</h2>
      <p className="body-s">{st.role}</p>
      <p className="dt">{STATE[st.state]} · {RHYTHM[st.rhythm] || st.rhythm} · {st.autonomy === "auto" ? "Sends on its own to known contacts" : st.autonomy === "approve_first" ? "Asks first, then follows up" : "Asks before sending anything"}</p>
      {owns.length > 0 && <p className="dt">Owns: {owns.join(", ")}</p>}
      {hands.length > 0 && <p className="dt">Hands to: {hands.map((h) => `${s.blueprint.agents.find((a) => a.key === h.to)?.name || h.to} (${h.when.toLowerCase()})`).join("; ")}</p>}
      {st.last_run && (
        <div className="cp-run">
          <p className="label">Last run · {since(st.last_run.at)}</p>
          <p className="body-s">{st.last_run.summary || st.last_run.error || "No summary."}</p>
          <Link to={"/workspace/runs/" + st.last_run.id} className="link link-s">Every step of this run</Link>
        </div>
      )}
      {can("manager") && st.engine === "llm" && (
        <form className="cp-form" onSubmit={runNow}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={st.template === "research" ? "Ask it a question" : "Anything specific? (optional)"} aria-label={`Instruction for ${st.name}`} />
          <button className="btn btn-sm" disabled={act.busy || st.status === "paused"}>Run now</button>
        </form>
      )}
      {act.error && <p className="form-err">{act.error}</p>}
      <div className="actions">
        {can("manager") && <button className="btn btn-sm btn-ghost" onClick={() => setStatus(st.id, st.status === "paused" ? "running" : "paused")}>{st.status === "paused" ? "Resume" : "Pause"} {st.name}</button>}
        <Link to={"/workspace/agents/" + st.id} className="link link-s">Settings and brief</Link>
      </div>
      {bp?.template === "custom" && <p className="dt">A custom role designed for this swarm.</p>}
    </div>
  );
}

/* ---------- Phones: a list, the desk first, the mic within reach ---------- */
function MobileFloor({ s, fx, can, view, waiting, decide, onStation, onCard, reload }) {
  const [tab, setTab] = useState(waiting ? "desk" : "agents");
  return (
    <div className="mf">
      <nav className="mf-tabs" aria-label="Sections">
        {[["desk", `Desk${waiting ? ` (${waiting})` : ""}`], ["agents", "Agents"], ["board", "Board"], ["companies", "Companies"]].map(([k, t]) => <button key={k} className={tab === k ? "is-on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{t}</button>)}
      </nav>
      <div className="mf-body">
        {tab === "desk" && <Desk s={s} can={can} decide={decide} onFailed={(r) => navigate("/workspace/runs/" + r.id)} />}
        {tab === "agents" && <ul className="mf-list">{s.stations.map((st) => <li key={st.id}><Station st={st} fx={fx} onClick={() => onStation(st)} /></li>)}</ul>}
        {tab === "board" && <Board s={s} can={can} onCard={onCard} reload={reload} />}
        {tab === "companies" && <Companies can={can} onOpen={(id) => onCard({ ref_kind: "lead", ref_id: id })} />}
      </div>
    </div>
  );
}
