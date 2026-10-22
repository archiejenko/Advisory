// The Org tab on the Floor: the swarm as a family tree, orchestrator at the top, roles below, tasks under each.
// Badges (role, skills, autonomy, rhythm) are dragged or tapped onto agents; changes queue up and are checked
// with the same rules the server uses (packages/core/badges.ts), then saved together with Apply.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { Glyph } from "../kit.jsx";
import { ROLES, SKILLS, AUTONOMY, RHYTHMS, applyOrgChanges, toolsFor, role as roleOf, skill as skillOf, depthOf } from "../../../../packages/core/badges.ts";

/** Touch screens get tap instructions; dragging is for a mouse. */
const COARSE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

const BADGE_LABEL = {
  role: (k) => roleOf(k)?.label || k, skill: (k) => skillOf(k)?.label || k,
  autonomy: (k) => AUTONOMY.find((x) => x.key === k)?.label || k, rhythm: (k) => RHYTHMS.find((x) => x.key === k)?.label || k,
};
const BADGE_ABOUT = {
  role: (k) => roleOf(k)?.about, skill: (k) => { const s = skillOf(k); return s ? `${s.about}. Tools: ${s.tools.join(", ")}` : ""; },
  autonomy: (k) => AUTONOMY.find((x) => x.key === k)?.about, rhythm: (k) => `Runs: ${BADGE_LABEL.rhythm(k).toLowerCase()}`,
};
const STATUS = { todo: "To do", doing: "Doing", blocked: "Blocked", done: "Done", dropped: "Dropped" };
const SWARM_TOOL_COUNT = 7;
const initials = (n) => { const p = String(n).split(/\s+/); return (p[0][0] + (p[1] ? p[1][0] : p[0][1] || "")).toUpperCase(); };

export function OrgView({ swarmId, can, onChanged }) {
  const [server, setServer] = useState(null);
  const [err, setErr] = useState(null);
  const [changes, setChanges] = useState([]);
  const [sel, setSel] = useState(null);           // { kind, key, from } or null
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(null);
  const drag = useRef(null);
  const canvas = useRef(null);
  const centred = useRef(false);
  const timer = useRef(null);
  const nextId = useRef(1);
  const manager = can("manager");

  const load = useCallback(async () => { try { setServer(await api("GET", `/api/ws/swarms/${swarmId}/org`)); setErr(null); } catch (e) { setErr(e); } }, [swarmId]);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden && !changes.length) load(); }, 8000); return () => clearInterval(t); }, [load, changes.length]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    // Open with the orchestrator in the middle of the view.
    const c = canvas.current;
    if (!server || !c || centred.current) return;
    centred.current = true;
    c.scrollLeft = Math.max(0, (c.scrollWidth - c.clientWidth) / 2);
  }, [server]);

  const say = (text, bad) => { clearTimeout(timer.current); setToast({ text, bad }); timer.current = setTimeout(() => setToast(null), 4200); };

  const draft = useMemo(() => {
    if (!server) return null;
    const r = applyOrgChanges(server.agents, changes, server.limits);
    return r.ok ? r : { ok: true, agents: server.agents, summaries: [], hires: 0 };
  }, [server, changes]);

  const propose = (c) => {
    if (!manager) return say("Only a manager or owner can change the team.", true);
    const r = applyOrgChanges(server.agents, [...changes, c], server.limits);
    if (!r.ok) return say(r.error, true);
    setChanges((x) => [...x, c]);
    setFlash(c.agent || c.id);
    say(r.summaries.at(-1), false);
    setSel(null);
  };

  const give = (s, targetId) => {
    if (!s) return;
    if (s.agent) return propose({ op: "reports_to", agent: s.agent, value: targetId });
    if (s.from === targetId) return;
    const a = draft.agents.find((x) => x.id === targetId);
    if (s.kind === "role") {
      if (s.from) {
        // Dragging a role from one agent to another swaps their roles.
        const other = draft.agents.find((x) => x.id === s.from);
        const two = [{ op: "role", agent: targetId, value: s.key }, { op: "role", agent: s.from, value: a.role }];
        const r = applyOrgChanges(server.agents, [...changes, ...two], server.limits);
        if (!r.ok) return say(r.error, true);
        setChanges((x) => [...x, ...two]); setFlash(targetId); setSel(null);
        return say(`Swapped roles: ${a.name} and ${other.name}.`, false);
      }
      return propose({ op: "role", agent: targetId, value: s.key });
    }
    if (s.kind === "skill") return propose({ op: "skill", agent: targetId, value: s.key, ...(s.from ? { from: s.from } : {}) });
    if (s.kind === "autonomy") return propose({ op: "autonomy", agent: targetId, value: s.key });
    if (s.kind === "rhythm") return propose({ op: "rhythm", agent: targetId, value: s.key });
  };
  const takeOff = (s) => {
    if (!s?.from) return;
    if (s.kind !== "skill") return say(`Every agent has one ${s.kind === "role" ? "role" : s.kind === "autonomy" ? "autonomy setting" : "rhythm"}. Drop a different one on it to swap.`, true);
    propose({ op: "unskill", agent: s.from, value: s.key });
  };
  const hire = (roleKey) => propose({ op: "hire", id: `new-${nextId.current++}`, role: roleKey });

  const applyAll = async () => {
    setSaving(true);
    try {
      const r = await api("PATCH", `/api/ws/swarms/${swarmId}/org`, { changes });
      setServer(r); setChanges([]); setFlash(null);
      say(`Saved ${r.applied.length} ${r.applied.length === 1 ? "change" : "changes"}. Each agent picks them up on its next run.`, false);
      onChanged?.();
    } catch (e) { say(e.message, true); } finally { setSaving(false); }
  };

  const endDrag = () => { drag.current = null; setDragging(false); };
  const dropOn = (targetId) => (e) => { e.preventDefault(); e.stopPropagation(); const d = drag.current; endDrag(); give(d, targetId); };
  const startBadge = (kind, key, from) => (e) => { e.stopPropagation(); try { e.dataTransfer.setData("text/plain", key); e.dataTransfer.effectAllowed = "copyMove"; } catch {} drag.current = { kind, key, from }; setDragging(true); };
  const startAgent = (id) => (e) => { try { e.dataTransfer.setData("text/plain", id); } catch {} drag.current = { agent: id }; setDragging(true); };
  const pick = (kind, key, from) => (e) => { e?.stopPropagation?.(); setSel((s) => (s && s.kind === kind && s.key === key && s.from === from ? null : { kind, key, from })); };

  if (err && !server) return <div className="org-empty"><p>The team couldn't be loaded: {err.message}</p><button className="btn btn-sm" onClick={load}>Try again</button></div>;
  if (!server || !draft) return <div className="org-empty" aria-busy="true"><p>Loading the team…</p></div>;

  const agents = draft.agents;
  const root = agents.find((a) => a.role === "orchestrator");
  const top = root ? agents.filter((a) => a.reports_to === root.id) : agents.filter((a) => !a.reports_to);
  const kids = (id) => agents.filter((a) => a.reports_to === id);
  const view = Object.fromEntries(server.agents.map((a) => [a.id, a]));
  const tasksOf = (id) => server.tasks.filter((t) => t.agent_id === id);
  const used = server.limits.agents_used + draft.hires - server.agents.filter((a) => a.role !== "orchestrator" && !agents.some((x) => x.id === a.id)).length;
  const canDrop = manager && (!!sel || dragging);
  const roleSel = sel && sel.kind === "role" && !sel.from;

  const card = (a, level) => (
    <AgentCard key={a.id} a={a} level={level} view={view[a.id]} isNew={!view[a.id]} root={root} agents={agents} tasks={tasksOf(a.id)}
      sel={sel} canDrop={canDrop} flash={flash === a.id} manager={manager} swarmId={swarmId}
      onClick={() => sel && give(sel, a.id)} onDrop={dropOn(a.id)} onDragStart={a.role === "orchestrator" ? undefined : startAgent(a.id)} onDragEnd={endDrag}
      badgeDrag={startBadge} badgePick={pick} onReports={(v) => propose({ op: "reports_to", agent: a.id, value: v })}
      onRemove={() => propose({ op: "remove", agent: a.id })} onTask={async (title) => { try { await api("POST", `/api/ws/swarms/${swarmId}/tasks`, { agent_id: a.id, title }); say(`Gave ${a.name}: ${title}`, false); load(); onChanged?.(); } catch (e) { say(e.message, true); } }}
      onGoal={async (text) => { try { const r = await api("POST", `/api/ws/swarms/${swarmId}/goals`, { text }); say(r.say, false); load(); onChanged?.(); } catch (e) { say(e.message, true); } }}
      goals={server.swarm.goals} />
  );

  return (
    <div className="org" onDragEnd={endDrag}>
      <div className="org-main">
        <div className="org-bar">
          {changes.length > 0 ? (
            <div className="org-pending" role="status">
              <b>{changes.length} {changes.length === 1 ? "change" : "changes"} waiting</b>
              <span className="dt">{draft.hires ? `+${draft.hires} ${draft.hires === 1 ? "agent" : "agents"}. ` : ""}Nothing changes for the agents until you apply.</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setChanges((x) => x.slice(0, -1))} disabled={saving}>Undo</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setChanges([]); setFlash(null); }} disabled={saving}>Discard</button>
              <button className="btn btn-sm" onClick={applyAll} disabled={saving}>{saving ? "Saving…" : "Apply changes"}</button>
            </div>
          ) : (
            <p className="dt org-hint">{manager ? (COARSE ? "Tap a badge, then tap an agent to give it. Tap a badge on an agent to move it or take it off, and use Reports to to change who leads whom." : "Drag a badge onto an agent, or tap a badge and then an agent. Drag one agent onto another to change who it reports to.") : "You can see the team. A manager or owner can change it."}</p>
          )}
          {sel && (
            <div className="org-sel">
              <span className={`obd obd-${sel.kind} is-sel`}>{BADGE_LABEL[sel.kind](sel.key)}</span>
              <span className="dt">{sel.from ? `On ${agents.find((x) => x.id === sel.from)?.name}. Tap another agent to move it there${sel.kind === "role" ? " (roles swap)" : ""}.` : sel.kind === "role" ? "Tap an agent to give it this role, or the empty place to hire one." : "Tap an agent to give it this badge."}</span>
              {sel.from && sel.kind === "skill" && <button className="btn btn-sm btn-ghost" onClick={() => takeOff(sel)}>Take off</button>}
              <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>Cancel</button>
            </div>
          )}
          {toast && <div className={"org-toast" + (toast.bad ? " is-bad" : "")} role="status">{toast.text}</div>}
        </div>

        <div className="org-canvas" ref={canvas}>
          {!root && manager && (
            <div className="org-noroot">
              <b>This team has no orchestrator.</b>
              <span className="dt">Add one to plan goals into tasks and keep the team on them. It doesn't use a place on your plan.</span>
              <button className="btn btn-sm" onClick={() => propose({ op: "hire", id: `new-${nextId.current++}`, role: "orchestrator" })}>Add an orchestrator</button>
            </div>
          )}
          <div className="org-tree">
            {root && <div className="org-root">{card(root, 0)}</div>}
            <div className={"org-kids" + (root ? "" : " no-root")}>
              {top.map((a) => (
                <div className="org-kid" key={a.id}>
                  {card(a, 1)}
                  {kids(a.id).length > 0 && (
                    <div className="org-sub"><div className="org-kids">
                      {kids(a.id).map((k) => <div className="org-kid" key={k.id}>{card(k, 2)}</div>)}
                    </div></div>
                  )}
                </div>
              ))}
              {manager && used < server.limits.agents_allowed && (
                <div className="org-kid">
                  <button className={"org-slot" + ((roleSel || dragging) ? " can-drop" : "")} onClick={() => (roleSel ? hire(sel.key) : say("Pick a role badge first, then tap here to hire an agent.", true))}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const d = drag.current; endDrag(); if (d && d.kind === "role" && !d.from) hire(d.key); else say("Drop a role from the badge tray here to hire an agent.", true); }}>
                    <Glyph name="plus" size={20} />
                    <span>Drop a role here to hire an agent</span>
                    <span className="dt">{server.limits.agents_allowed - used} of {server.limits.agents_allowed} places free on {server.limits.plan}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside className="org-tray" aria-label="Badges">
        <div><b>Badges</b><p className="dt">Roles set standing orders. Skills set tools. Autonomy sets when email sends without you. Rhythm sets when it runs.</p></div>
        {[["role", "Role · one each", ROLES.filter((r) => !r.fixed)], ["skill", "Skills · any number", SKILLS], ["autonomy", "Autonomy · one each", AUTONOMY], ["rhythm", "Rhythm · one each", RHYTHMS]].map(([kind, title, list]) => (
          <div key={kind} className="org-tray-group">
            <span className="org-cap">{title}</span>
            <div className="org-badges">
              {list.map((b) => (
                <button key={b.key} type="button" className={`obd obd-${kind}` + (sel && !sel.from && sel.kind === kind && sel.key === b.key ? " is-sel" : "")} draggable={manager}
                  onDragStart={startBadge(kind, b.key, null)} onClick={pick(kind, b.key, null)} title={BADGE_ABOUT[kind](b.key)} disabled={!manager}>{b.label}</button>
              ))}
            </div>
          </div>
        ))}
        {manager && <div className={"org-bin" + (dragging ? " can-drop" : "")} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const d = drag.current; endDrag(); if (d?.from) takeOff(d); }}>Drop a skill here to take it off an agent</div>}
        <div className="org-plan">
          <div><span>Agents on {server.limits.plan}</span><b>{used} of {server.limits.agents_allowed}</b></div>
          <i><span style={{ width: `${Math.min(100, Math.round((used / server.limits.agents_allowed) * 100))}%` }} className={used >= server.limits.agents_allowed ? "is-full" : ""} /></i>
          <p className="dt">The orchestrator comes with every swarm and doesn't use a place. Its tool calls count as actions.</p>
        </div>
        {changes.length > 0 && (
          <div className="org-log"><span className="org-cap">Pending</span>{applyOrgChanges(server.agents, changes, server.limits).summaries?.slice().reverse().map((t, i) => <p key={i}>{t}</p>)}</div>
        )}
      </aside>
    </div>
  );
}

function AgentCard({ a, level, view, isNew, root, agents, tasks, sel, canDrop, flash, manager, onClick, onDrop, onDragStart, onDragEnd, badgeDrag, badgePick, onReports, onRemove, onTask, onGoal, goals }) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const isRoot = a.role === "orchestrator";
  const badges = [{ kind: "role", key: a.role }, ...a.skills.map((k) => ({ kind: "skill", key: k })), ...(isRoot || a.locked ? [] : [{ kind: "autonomy", key: a.autonomy }]), { kind: "rhythm", key: a.rhythm }];
  const tools = a.locked ? 0 : toolsFor(a.role, a.skills).length + (isRoot ? 0 : SWARM_TOOL_COUNT);
  const boss = agents.find((x) => x.id === a.reports_to);
  const hasTeam = agents.some((x) => x.reports_to === a.id);
  const options = isRoot ? [] : agents.filter((o) => o.id !== a.id && !o.locked && (o.role === "orchestrator" || o.id === a.reports_to || (depthOf(agents, o.id) === 1 && !hasTeam && !isUnderLocal(agents, o.id, a.id))));
  const open = tasks.filter((t) => ["todo", "doing", "blocked"].includes(t.status));
  const doneWeek = tasks.filter((t) => t.status === "done").length;
  const paused = view?.status === "paused";
  return (
    <div className={`org-card${isRoot ? " is-root" : ""}${canDrop && !a.locked ? " can-drop" : ""}${flash ? " flash" : ""}${isNew ? " is-new" : ""}${paused ? " is-paused" : ""}`}
      draggable={manager && !!onDragStart} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={onClick}
      aria-label={`${a.name}, ${roleOf(a.role)?.label}${boss ? `, reports to ${boss.name}` : ""}`}>
      <div className="org-head">
        <span className="org-av" aria-hidden="true">{initials(a.name)}</span>
        <div className="org-name"><b>{a.name}</b><span>{isRoot ? "Top of the team" : `${roleOf(a.role)?.label}${level === 2 && boss ? ` · team of ${boss.name}` : ""}`}{paused ? " · paused" : ""}{isNew ? " · new" : ""}</span></div>
        {manager && !isRoot && <button className="org-x" aria-label={`Remove ${a.name}`} title={`Remove ${a.name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}><Glyph name="close" size={14} /></button>}
      </div>
      <div className="org-badges">
        {badges.map((b) => (
          <button key={b.kind + b.key} type="button" className={`obd obd-${b.kind}` + (sel && sel.from === a.id && sel.kind === b.kind && sel.key === b.key ? " is-sel" : "")} draggable={manager && !a.locked}
            onDragStart={a.locked ? undefined : badgeDrag(b.kind, b.key, a.id)} onClick={(e) => { e.stopPropagation(); if (!a.locked && manager) badgePick(b.kind, b.key, a.id)(e); }} title={BADGE_ABOUT[b.kind](b.key)}>{BADGE_LABEL[b.kind](b.key)}</button>
        ))}
      </div>
      <span className="org-meta">{a.locked ? "Runs from the registers; badges fixed" : `${tools} tools${isRoot ? " · never sends email" : ""}`}{a.stages?.length ? ` · owns ${a.stages.join(", ")}` : ""}</span>
      {isRoot && (
        <div className="org-goals" onClick={(e) => e.stopPropagation()}>
          <span className="org-cap">Goals</span>
          {goals.length ? <ul>{goals.map((g, i) => <li key={i}>{g}</li>)}</ul> : <p className="dt">No goals yet.</p>}
          {manager && !isNew && <form onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) { onGoal(text.trim()); setText(""); } }}><label className="sr-only" htmlFor="org-goal">New goal</label><input id="org-goal" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a goal, e.g. five law firms talking by December" /><button className="btn btn-sm">Add</button></form>}
        </div>
      )}
      {!isRoot && options.length > 0 && manager && (
        <label className="org-reports" onClick={(e) => e.stopPropagation()}>Reports to
          <select value={a.reports_to || ""} onChange={(e) => onReports(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      {!isRoot && (open.length > 0 || doneWeek > 0) && (
        <ul className="org-tasks">
          {open.slice(0, 3).map((t) => <li key={t.id} className={`ot ot-${t.status}`}><i aria-hidden="true" /><span><b>{t.title}</b><em>{STATUS[t.status]} · {t.from}</em></span></li>)}
          {doneWeek > 0 && <li className="ot ot-done-sum"><span><em>{doneWeek} done this week</em></span></li>}
        </ul>
      )}
      {!isRoot && !a.locked && manager && !isNew && (asking ? (
        <form className="org-ask" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 2) { onTask(text.trim()); setText(""); setAsking(false); } }}>
          <label className="sr-only" htmlFor={`task-${a.id}`}>Task for {a.name}</label>
          <input id={`task-${a.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What should it do?" />
          <button className="btn btn-sm">Give</button>
        </form>
      ) : <button className="org-give" onClick={(e) => { e.stopPropagation(); setAsking(true); }}><Glyph name="plus" size={14} />Give a task</button>)}
    </div>
  );
}
function isUnderLocal(agents, id, bossId) {
  let a = agents.find((x) => x.id === id); const seen = new Set();
  while (a && a.reports_to && !seen.has(a.id)) { if (a.reports_to === bossId) return true; seen.add(a.id); a = agents.find((x) => x.id === a.reports_to); }
  return false;
}
