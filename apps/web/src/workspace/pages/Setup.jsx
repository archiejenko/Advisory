// Setup (formerly Your OS): the builder. Drag apps from the library into the four hubs, choose how each runs
// (here, kept in a current tool, or outsourced), undo and redo, start from an industry, and save. Saving changes the
// shell's tabs straight away. The summary bar is a sticky footer inside the builder, so nothing covers it.
import React, { useMemo, useState } from "react";
import { Icon, toast, useStore } from "../core.jsx";
import { AgentBadge, Button, Dialog, Drawer, PageHeader, SegmentedControl, StatusChip } from "../ui.jsx";
import { APPS, HUBS, INDUSTRIES, TOOLS, actionsPerMonth, appName, shellApps } from "../demo/catalogue";
import { activeAgentIds } from "../demo/selectors";
import { saveOs } from "../demo/store";
import { plural } from "../demo/format";

const AUTONOMY = [["watch", "Watch"], ["ask", "Ask first"], ["limits", "Act within limits"]];
const MODE_LABEL = { here: "Runs here", kept: "Kept in current tools", outsourced: "Outsourced", off: "Off" };
const clone = (x) => JSON.parse(JSON.stringify(x));

function stateChip(m) {
  if (m.mode === "outsourced") return <StatusChip tone="neutral">Outsourced{m.provider ? ` to ${m.provider}` : ""}</StatusChip>;
  if (m.mode === "kept") return <StatusChip tone="neutral">Kept in {m.tool}</StatusChip>;
  return <StatusChip tone="agent">{m.autonomy === "limits" ? "Acts within limits" : m.autonomy === "watch" ? "Watch" : "Approve"}</StatusChip>;
}

function summaryOf(prev, next) {
  const out = [];
  for (const a of APPS) {
    const p = prev.apps[a.key], n = next.apps[a.key];
    if (!p || !n || JSON.stringify(p) === JSON.stringify(n)) continue;
    if (p.mode === "off") out.push(`added ${a.name}`);
    else if (n.mode === "off") out.push(`removed ${a.name}`);
    else if (p.mode !== n.mode) out.push(`${a.name}: ${MODE_LABEL[n.mode].toLowerCase()}${n.tool ? ` (${n.tool})` : n.provider ? ` (${n.provider})` : ""}`);
    else out.push(`${a.name} settings`);
  }
  return out.slice(0, 6).join("; ") || "No changes";
}

function Thumb({ app }) {
  return (
    <div className="w-thumb" aria-hidden="true">
      <div className="side">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={i === HUBS.findIndex((h) => h.id === app.hub) + 1 ? { background: "var(--primary)" } : undefined} />)}</div>
      <div className="main"><i /><i className="hl" /><i /><i style={{ width: "80%" }} /><i style={{ width: "70%" }} /><i style={{ width: "85%" }} /></div>
    </div>
  );
}

export function Setup() {
  const s = useStore();
  const [draft, setDraft] = useState(() => clone(s.os));
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [open, setOpen] = useState(null);
  const [industry, setIndustry] = useState(false);
  const [over, setOver] = useState(false);
  const [search, setSearch] = useState("");
  const view = s.prefs.view;
  const dirty = JSON.stringify(draft.apps) !== JSON.stringify(s.os.apps);

  const change = (fn) => { setPast((p) => [...p, draft].slice(-50)); setFuture([]); setDraft((d) => { const n = clone(d); fn(n); return n; }); };
  const setApp = (key, patch) => change((n) => { n.apps[key] = { ...n.apps[key], ...patch }; });
  const add = (key) => { const a = APPS.find((x) => x.key === key); if (a.status === "soon") { setOpen(key); return; } setApp(key, { mode: "here" }); toast(`${a.name} added to ${HUBS.find((h) => h.id === a.hub).name}.`); };
  const undoD = () => { if (!past.length) return; setFuture((f) => [draft, ...f]); setDraft(past[past.length - 1]); setPast((p) => p.slice(0, -1)); };
  const redoD = () => { if (!future.length) return; setPast((p) => [...p, draft]); setDraft(future[0]); setFuture((f) => f.slice(1)); };
  const save = () => { const sum = summaryOf(s.os, draft); const tok = saveOs(draft, sum); setPast([]); setFuture([]); toast(`Saved. The workspace now shows ${plural(counts.apps, "app")}.`, { undo: tok }); };

  const counts = useMemo(() => ({
    apps: HUBS.reduce((n, h) => n + shellApps(draft, h.id).length, 0),
    outsourced: APPS.filter((a) => draft.apps[a.key]?.mode === "outsourced").length,
    kept: APPS.filter((a) => draft.apps[a.key]?.mode === "kept").length,
    agents: s.agents.filter((a) => activeAgentIds(draft).includes(a.id)).length,
    actions: actionsPerMonth(draft),
  }), [draft, s.agents]);
  const w = search.trim().toLowerCase();
  const openApp = open && APPS.find((a) => a.key === open);
  const om = open && draft.apps[open];

  return (
    <div>
      <PageHeader title="Setup" purpose="The apps your business runs on, who runs them, and the tools you keep. Changes show in the workspace when you save."
        actions={<><Button icon="Undo2" onClick={undoD} disabled={!past.length}>Undo</Button><Button icon="Redo2" onClick={redoD} disabled={!future.length}>Redo</Button><Button icon="Layers" onClick={() => setIndustry(true)}>Start from an industry</Button></>} />
      <p className="w-sub" style={{ margin: "8px 0 16px" }}>Version {s.os.version} · {dirty ? "unsaved changes" : "everything saved"}</p>

      <div className="w-build">
        <aside className="w-lib" aria-label="Library">
          <div className="w-row"><h2 style={{ fontSize: 17, flex: 1 }}>Library</h2><span className="w-sub">{APPS.length} apps</span></div>
          <label className="sr-only" htmlFor="w-libq">Search apps</label>
          <input id="w-libq" className="w-input" style={{ marginTop: 12 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search apps and features" />
          {HUBS.map((h) => {
            const list = APPS.filter((a) => a.hub === h.id && (!w || (a.name + " " + a.blurb + " " + a.features.join(" ")).toLowerCase().includes(w)));
            if (!list.length) return null;
            return (
              <div key={h.id} className="w-lib-cat">
                <h3><Icon name={h.icon} size={14} />{h.name}</h3>
                {list.map((a) => {
                  const on = draft.apps[a.key]?.mode !== "off";
                  return (
                    <div key={a.key} className={"w-lib-app" + (on ? " is-in" : "") + (a.status === "soon" ? " is-soon" : "")} draggable={!on && a.status !== "soon"} onDragStart={(e) => e.dataTransfer.setData("text/plain", a.key)}>
                      <Icon name={a.icon} size={18} />
                      <button type="button" style={{ flex: 1, minWidth: 0, textAlign: "left" }} onClick={() => setOpen(a.key)}><b>{appName(a, view)}</b><small>{a.status === "soon" ? "Available soon" : a.blurb}</small></button>
                      {a.status !== "soon" && !on && <Button size="sm" icon="Plus" aria-label={`Add ${a.name}`} onClick={() => add(a.key)} />}
                      {on && <Icon name="Check" size={16} label="Added" />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </aside>

        <section className={"w-canvas" + (over ? " is-over" : "")} aria-label="Your workspace" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const k = e.dataTransfer.getData("text/plain"); if (k) add(k); }}>
          <div className="w-row" style={{ marginBottom: 12 }}><h2 style={{ fontSize: 17, flex: 1 }}>{s.org.name}</h2><span className="w-sub">Drag apps here, or tap + in the library</span></div>
          {HUBS.map((h) => {
            const list = APPS.filter((a) => a.hub === h.id && draft.apps[a.key] && draft.apps[a.key].mode !== "off");
            return (
              <div key={h.id} className="w-canvas-hub">
                <h3><Icon name={h.icon} size={14} />{h.name} <span>{list.length}</span></h3>
                <div className="w-tiles">
                  {list.map((a) => (
                    <button key={a.key} type="button" className="w-tile" onClick={() => setOpen(a.key)}>
                      <b><Icon name={a.icon} size={16} />{appName(a, view)}</b>
                      <small>{a.agentId ? `Run by ${s.agents.find((x) => x.id === a.agentId)?.name}` : "People only"} · {a.features.length} features</small>
                      {stateChip(draft.apps[a.key])}
                    </button>
                  ))}
                  {!list.length && <p className="w-sub">Nothing in {h.name} yet.</p>}
                </div>
              </div>
            );
          })}
        </section>

        <div className="w-summary" role="region" aria-label="Plan summary">
          <span><b className="tnum" data-testid="setup-apps">{counts.apps}</b> apps</span>
          <span><b className="tnum">{counts.kept}</b> kept in current tools</span>
          <span><b className="tnum">{counts.outsourced}</b> outsourced</span>
          <span><b className="tnum" data-testid="setup-agents">{counts.agents}</b> agents</span>
          <span><b className="tnum">~{counts.actions.toLocaleString("en-GB")}</b> agent actions a month</span>
          <span className="w-sp" />
          {dirty && <Button variant="ghost" onClick={() => { setPast((p) => [...p, draft]); setDraft(clone(s.os)); }}>Discard</Button>}
          <Button variant="primary" icon="Check" onClick={save} disabled={!dirty}>Save</Button>
        </div>
      </div>

      <Drawer open={!!openApp} onClose={() => setOpen(null)} title={openApp ? appName(openApp, view) : ""} sub={openApp && `${HUBS.find((h) => h.id === openApp.hub).name} · ${openApp.status === "soon" ? "Available soon" : MODE_LABEL[om?.mode || "off"]}`}
        footer={openApp && openApp.status !== "soon" && (om.mode === "off" ? <Button variant="primary" icon="Plus" onClick={() => setApp(open, { mode: "here" })}>Add to {HUBS.find((h) => h.id === openApp.hub).name}</Button> : <Button className="w-btn-danger" icon="X" onClick={() => setApp(open, { mode: "off" })}>Remove from the workspace</Button>)}>
        {openApp && (
          <div className="w-stack">
            <p>{openApp.blurb}</p>
            <Thumb app={openApp} />
            <dl className="w-dl">
              <dt>Run by</dt><dd>{openApp.agentId ? <AgentBadge agentId={openApp.agentId} /> : "People only"}</dd>
              <dt>Used by</dt><dd>{openApp.users}</dd>
              <dt>Appears</dt><dd>{openApp.status === "soon" ? "Not yet: available soon" : `${HUBS.find((h) => h.id === openApp.hub).name} › ${appName(openApp, view)}${openApp.status === "table" ? " (standard list)" : ""}`}</dd>
            </dl>
            <div><p className="w-sub" style={{ marginBottom: 6 }}>Features</p><ul style={{ listStyle: "disc", paddingLeft: 20 }}>{openApp.features.map((f) => <li key={f}>{f}</li>)}</ul></div>
            {(openApp.status !== "soon" || om.mode !== "off") && (
              <div className="w-field">
                <label>How it runs</label>
                <SegmentedControl label="How it runs" value={om.mode} onChange={(m) => setApp(open, { mode: m, tool: m === "kept" ? om.tool || TOOLS[0] : null, provider: m === "outsourced" ? om.provider || "" : null })}
                  options={[...(openApp.status !== "soon" ? [["here", "Here"]] : []), ["kept", "Kept in current tools"], ["outsourced", "Outsourced"], ["off", "Off"]]} />
              </div>
            )}
            {openApp.status === "soon" && om.mode === "off" && <p className="w-sub">This app is available soon. Until then you can keep it in a tool you already use, or mark it as outsourced, and agents will keep it in step.</p>}
            {openApp.status === "soon" && om.mode === "off" && <div className="w-row"><Button onClick={() => setApp(open, { mode: "kept", tool: TOOLS[0] })}>Keep it in a current tool</Button><Button onClick={() => setApp(open, { mode: "outsourced", provider: "" })}>It's outsourced</Button></div>}
            {om.mode === "kept" && (
              <div className="w-field"><label htmlFor="w-tool">Which tool</label>
                <select id="w-tool" className="w-input" value={om.tool || ""} onChange={(e) => setApp(open, { tool: e.target.value })}>{TOOLS.map((t) => <option key={t}>{t}</option>)}</select>
                <p className="w-sub">Records stay in {om.tool}; {openApp.agentId ? s.agents.find((x) => x.id === openApp.agentId)?.name : "the team"} reads and writes there, and the workspace shows them alongside everything else.</p>
              </div>
            )}
            {om.mode === "outsourced" && (
              <div className="w-field"><label htmlFor="w-prov">Who does it</label><input id="w-prov" className="w-input" value={om.provider || ""} onChange={(e) => setApp(open, { provider: e.target.value })} placeholder="For example, your accountant" /></div>
            )}
            {om.mode === "here" && openApp.agentId && (
              <div className="w-field"><label>What {s.agents.find((x) => x.id === openApp.agentId)?.name} may do</label><SegmentedControl label="Autonomy" value={om.autonomy} onChange={(v) => setApp(open, { autonomy: v })} options={AUTONOMY} /></div>
            )}
          </div>
        )}
      </Drawer>

      <Dialog open={industry} onClose={() => setIndustry(false)} title="Start from an industry">
        <p className="w-sub" style={{ marginBottom: 12 }}>Replaces the apps in your draft with a starting set. Nothing changes until you save, and Undo puts it back.</p>
        <div className="w-stack">
          {INDUSTRIES.map((ind) => (
            <button key={ind.key} type="button" className="w-tile" style={{ width: "100%", minHeight: 0 }} onClick={() => { change((n) => { for (const a of APPS) n.apps[a.key] = { mode: "off", tool: null, provider: null, autonomy: "ask" }; Object.assign(n.apps, clone(ind.apps)); }); setIndustry(false); toast(`Started from ${ind.name}. Save to apply.`); }}>
              <b>{ind.name}</b><small>{ind.blurb} · {Object.keys(ind.apps).length} apps</small>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
