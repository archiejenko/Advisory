// The OS Builder: the first screen of a new workspace, and Your OS afterwards. Pick an industry or start blank,
// drag apps from the library into Your OS (or tap +), set each app's mode, features and autonomy, and launch.
// Drag and drop is a small dependency-free implementation: HTML5 drag for a mouse, the + button for touch, and
// the keyboard (arrow keys move focus, Space picks an app up, Enter drops it into Your OS, Escape cancels).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, navigate } from "../router.jsx";
import { useWs, useCan } from "../layout.jsx";
import { Glyph, Tile } from "../kit.jsx";
import { api } from "../api.js";
import { Shell, Notice, Loading } from "./Live.jsx";
import { useOs, setOs } from "../osStore.js";
import { FACETS, CATEGORIES, facet, KINDS } from "../../../../packages/core/os.ts";
import { LIBRARY, PACKS, DEPENDS, MODES, MODE_LABEL, AUTONOMY, AUTONOMY_LABEL, NEVER_AUTO, GUARDRAILS, featuresOf, defaultFeatures, configFromPack, estimate } from "../../../../packages/core/osconfig.ts";
import { PLANS } from "../../../../packages/core/templates.ts";

const MODE_HELP = {
  here: "The full app, with the features you switch on. The AI Team reads and writes its records.",
  outsourced: "A provider does it. You keep a light record, and the AI Team prepares their hand-off as a draft for you to send.",
  external: "You keep using your current tool. Import a CSV to mirror it here, read only, and move it here when you're ready.",
  off: "Not in your OS: no dock icon, no search, and the AI Team can't see it.",
};
const AUTO_HELP = { suggest: "Notes, checklists and answers. Nothing drafted, nothing sent.", approve: "It drafts every outward action and waits for your OK.", auto: "It acts within the guardrails and sends you a daily summary." };

const role = (n) => (n || "").replace(/\s+agent$/i, "");
const dependents = (key, mods) => mods.filter((m) => m.mode !== "off" && (DEPENDS[m.key] || []).includes(key)).map((m) => m.key);

function Dialog({ d, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector("button")?.focus(); }, []);
  return (
    <div className="ob-dlg-back" role="presentation">
      <div className="ob-dlg" role="alertdialog" aria-modal="true" aria-labelledby="ob-dlg-t" ref={ref} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <p id="ob-dlg-t">{d.text}</p>
        <div className="actions">{d.choices.map(([label, fn], i) => <button key={label} className={"btn btn-sm" + (i ? " btn-line" : "")} onClick={() => { fn(); onClose(); }}>{label}</button>)}</div>
      </div>
    </div>
  );
}

function Start({ onPick, built }) {
  return (
    <div className="ob-start">
      <p className="label">Your OS</p>
      <h2>What kind of business is this?</h2>
      <p className="body-l">Start from your industry and we'll place the apps it usually runs on. It's only a starting point: change anything next.</p>
      <div className="ob-packs">
        {PACKS.map((p) => (
          <button key={p.key} className={"ob-pack" + (p.key === "blank" ? " is-blank" : "")} onClick={() => onPick(p.key)}>
            <b>{p.name}</b><span>{p.blurb}</span>
            <i>{p.key === "blank" ? "Pick every app yourself" : `${p.here.length} apps${p.outsourced?.length ? ` · ${p.outsourced.length} outsourced` : ""}`}</i>
          </button>
        ))}
      </div>
      {built && <p className="more"><button className="link" onClick={() => onPick(null)}>Back to my current OS</button></p>}
    </div>
  );
}

function Panel({ m, onClose, set, remove, fields, addField, removeField, owner }) {
  const f = facet(m.key);
  const feats = featuresOf(m.key);
  const [nf, setNf] = useState({ label: "", type: "text" });
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, [m.key]);
  return (
    <aside className="ob-panel" aria-label={f.app + " settings"} tabIndex={-1} ref={ref} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="ob-panel-h"><div><b>{f.app}</b><span>{f.name}</span></div><button className="ob-x" onClick={onClose} aria-label="Close"><Glyph name="close" size={18} /></button></div>
      <p className="ob-optimal">{f.optimal}.</p>

      <fieldset className="ob-set"><legend>Mode</legend>
        <div className="ob-seg ob-seg-4">{MODES.map((x) => <button key={x} aria-pressed={m.mode === x} className={m.mode === x ? "is-on" : ""} onClick={() => (x === "off" ? remove(m.key) : set(m.key, { mode: x }))} disabled={!owner}>{MODE_LABEL[x]}</button>)}</div>
        <p className="ob-help">{MODE_HELP[m.mode]}</p>
      </fieldset>

      {m.mode === "outsourced" && (
        <fieldset className="ob-set"><legend>Provider</legend>
          <label className="ob-in"><span>Who does it</span><input value={m.provider?.name || ""} onChange={(e) => set(m.key, { provider: { ...m.provider, name: e.target.value } }, true)} placeholder="Moss Payroll Bureau" disabled={!owner} /></label>
          <label className="ob-in"><span>Their email for hand-offs</span><input type="email" value={m.provider?.email || ""} onChange={(e) => set(m.key, { provider: { ...m.provider, email: e.target.value } }, true)} placeholder="payroll@bureau.example" disabled={!owner} /></label>
          <label className="ob-in"><span>What they handle</span><input value={m.provider?.notes || ""} onChange={(e) => set(m.key, { provider: { ...m.provider, notes: e.target.value } }, true)} placeholder="Monthly payroll, RTI and payslips" disabled={!owner} /></label>
          <p className="ob-help">Each month the AI Team prepares what they need (hours, starters and leavers) as a draft. It never sends a hand-off on its own.</p>
        </fieldset>
      )}

      {m.mode === "here" && (
        <fieldset className="ob-set"><legend>Features · {m.features.length} of {feats.length} on</legend>
          <ul className="ob-feats">
            {feats.map((x) => (
              <li key={x.key}><label><input type="checkbox" checked={m.features.includes(x.key)} disabled={!owner} onChange={(e) => set(m.key, { features: e.target.checked ? [...m.features, x.key] : m.features.filter((k) => k !== x.key) })} /><span>{x.label}</span><i className={"ob-depth ob-depth-" + x.depth}>{DEPTH[x.depth]}</i></label></li>
            ))}
          </ul>
        </fieldset>
      )}

      {m.mode !== "external" && (
        <fieldset className="ob-set"><legend>AI Team in {f.app}{f.agent ? ` · ${role(f.agent)}` : ""}</legend>
          {!f.agent ? <p className="ob-help">Only people work here. The AI Team never sees it.</p> : (
            <>
              <div className="ob-seg">{AUTONOMY.map((x) => {
                const never = x === "auto" && NEVER_AUTO.includes(m.key);
                return <button key={x} aria-pressed={m.autonomy === x} className={m.autonomy === x ? "is-on" : ""} disabled={!owner || never} title={never ? "A person always decides here" : undefined} onClick={() => set(m.key, { autonomy: x })}>{AUTONOMY_LABEL[x]}</button>;
              })}</div>
              <p className="ob-help">{AUTO_HELP[m.autonomy]}{NEVER_AUTO.includes(m.key) ? " A person always decides here, so it can't run on its own." : ""}</p>
            </>
          )}
        </fieldset>
      )}

      {m.mode === "here" && (
        <fieldset className="ob-set"><legend>Your own fields</legend>
          <p className="ob-help">Built in: {KINDS[f.kind].fields.map((x) => x.label.toLowerCase()).join(", ")}.</p>
          {fields.length > 0 && <ul className="ob-fields">{fields.map((x) => <li key={x.key}><span>{x.label}</span><i>{x.type}</i>{owner && <button onClick={() => removeField(x)} aria-label={"Remove " + x.label}><Glyph name="close" size={14} /></button>}</li>)}</ul>}
          {owner && (
            <form className="ob-addf" onSubmit={(e) => { e.preventDefault(); if (nf.label.trim()) { addField({ module: m.key, label: nf.label.trim(), type: nf.type, key: nf.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) }); setNf({ label: "", type: "text" }); } }}>
              <input value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} placeholder="Field name, e.g. Site postcode" aria-label="New field name" />
              <select value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })} aria-label="Field type">{["text", "number", "money", "date", "url", "long"].map((t) => <option key={t}>{t}</option>)}</select>
              <button className="btn btn-sm btn-line">Add</button>
            </form>
          )}
        </fieldset>
      )}
      {owner && <button className="link link-s ob-remove" onClick={() => remove(m.key)}>Remove {f.app} from my OS</button>}
    </aside>
  );
}

function explain(cfg) {
  const here = cfg.modules.filter((m) => m.mode === "here"), out = cfg.modules.filter((m) => m.mode === "outsourced"), ext = cfg.modules.filter((m) => m.mode === "external");
  const cats = CATEGORIES.map((c) => ({ c, n: here.filter((m) => c.areas.includes(facet(m.key).area)).length }));
  const covered = cats.filter((x) => x.n).sort((a, b) => b.n - a.n).map((x) => x.c.name.toLowerCase());
  const missing = cats.filter((x) => !x.n && !out.concat(ext).some((m) => x.c.areas.includes(facet(m.key).area))).map((x) => x.c.name.toLowerCase());
  const auto = here.filter((m) => m.autonomy === "auto").map((m) => facet(m.key).app);
  const team = new Set(here.concat(out).map((m) => facet(m.key).agent).filter(Boolean));
  const list = (a) => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  let t = `Your OS runs ${here.length} apps here, covering ${list(covered.slice(0, 5)) || "nothing yet"}${covered.length > 5 ? ` and ${covered.length - 5} more areas` : ""}.`;
  if (out.length) t += ` ${list(out.map((m) => facet(m.key).app))} ${out.length === 1 ? "is" : "are"} outsourced: the AI Team prepares each hand-off as a draft for you to send.`;
  if (ext.length) t += ` ${list(ext.map((m) => facet(m.key).app))} ${ext.length === 1 ? "stays" : "stay"} in your current tools, mirrored here read only.`;
  if (missing.length) t += ` Left out: ${list(missing)}.`;
  t += ` ${team.size} AI Team ${team.size === 1 ? "member works" : "members work"} across it; ${auto.length ? `${list(auto)} ${auto.length === 1 ? "runs" : "run"} on ${auto.length === 1 ? "its" : "their"} own, and everything else waits for your OK` : "nothing goes out without your OK"}.`;
  return t;
}

export function WsBuild() {
  const { me } = useWs();
  const can = useCan();
  const owner = can("owner");
  const o = useOs();
  const [stage, setStage] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(() => new Set(["finance", "sales"]));
  const [dlg, setDlg] = useState(null);
  const [carry, setCarry] = useState(null);
  const [say, setSay] = useState("");
  const [over, setOver] = useState(false);
  const [fields, setFields] = useState([]);
  const [newFields, setNewFields] = useState([]);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [people, setPeople] = useState(8);

  useEffect(() => {
    if (!o?.os || cfg) return;
    if (o.os.built) { setCfg(o.os); setStage("build"); } else setStage("start");
  }, [o]);
  useEffect(() => { api("GET", "/api/ws/os/fields").then((r) => setFields(r.fields || [])).catch(() => {}); }, []);
  useEffect(() => {
    const k = (e) => {
      if (stage !== "build" || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || /input|textarea|select/i.test(e.target.tagName)) return;
      e.preventDefault(); e.shiftKey ? redo() : undo();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const commit = (modules, quiet) => {
    if (!quiet) { setPast((p) => [...p.slice(-60), cfg.modules]); setFuture([]); }
    setCfg((c) => ({ ...c, modules: modules.map((m, i) => ({ ...m, position: i })) }));
  };
  const undo = () => { if (!past.length) return; setFuture((f) => [cfg.modules, ...f]); setCfg((c) => ({ ...c, modules: past[past.length - 1] })); setPast((p) => p.slice(0, -1)); setSay("Undone."); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, cfg.modules]); setCfg((c) => ({ ...c, modules: future[0] })); setFuture((f) => f.slice(1)); setSay("Redone."); };
  const mod = (key) => cfg.modules.find((m) => m.key === key && m.mode !== "off");
  const fresh = (key) => ({ key, mode: "here", features: defaultFeatures(key), autonomy: "approve", position: 0 });

  const add = (key, base = cfg.modules) => {
    if (base.some((m) => m.key === key && m.mode !== "off")) { setSay(`${facet(key).app} is already in your OS.`); return base; }
    let next = [...base.filter((m) => m.key !== key), fresh(key)];
    commit(next);
    setSay(`Added ${facet(key).app}.`);
    const missing = (DEPENDS[key] || []).filter((d) => !next.some((m) => m.key === d && m.mode !== "off"));
    if (missing.length) {
      const names = missing.map((d) => facet(d).app).join(" and ");
      setDlg({ text: `${facet(key).app} works with ${names}. Add ${missing.length === 1 ? "it" : "them"} too?`, choices: [[`Add ${names}`, () => commit([...next, ...missing.map(fresh)], true)], [`Just ${facet(key).app}`, () => {}]] });
    }
    return next;
  };
  const remove = (key) => {
    const deps = dependents(key, cfg.modules);
    const drop = (keys) => { commit(cfg.modules.filter((m) => !keys.includes(m.key))); if (keys.includes(sel)) setSel(null); setSay(`Removed ${keys.map((k) => facet(k).app).join(" and ")}.`); };
    if (deps.length) {
      const names = deps.map((d) => facet(d).app).join(" and ");
      setDlg({ text: `${names} ${deps.length === 1 ? "needs" : "need"} ${facet(key).app}. Turn ${deps.length === 1 ? "both" : "them all"} off?`, choices: [[`Turn ${deps.length === 1 ? "both" : "all"} off`, () => drop([key, ...deps])], [`Only ${facet(key).app}`, () => drop([key])], ["Keep them", () => {}]] });
    } else drop([key]);
  };
  const set = (key, patch, quiet) => commit(cfg.modules.map((m) => (m.key === key ? { ...m, ...patch } : m)), quiet);
  const move = (key, by) => {
    const i = cfg.modules.findIndex((m) => m.key === key), j = i + by;
    if (i < 0 || j < 0 || j >= cfg.modules.length) return;
    const x = [...cfg.modules]; [x[i], x[j]] = [x[j], x[i]]; commit(x);
  };
  const pickPack = (key) => {
    if (!key) { setStage("build"); return; }
    const next = configFromPack(key);
    const prevVersion = cfg?.version ?? o?.os?.version;
    if (cfg) setPast((p) => [...p, cfg.modules]);
    setCfg({ ...(cfg || o.os), ...next, version: prevVersion, theme: cfg?.theme || o?.os?.theme || "dark", ai_paused: cfg?.ai_paused ?? false });
    setStage("build"); setSel(null);
    setSay(`Started from ${PACKS.find((p) => p.key === key).name}.`);
  };

  // Keyboard: arrows move focus within a list; Space picks up a library app; Enter drops it into Your OS.
  const rovingKeys = (e, key, from) => {
    const list = [...e.currentTarget.closest("[data-roving]").querySelectorAll("[data-rove]")];
    const i = list.indexOf(e.currentTarget);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { if (e.altKey && from === "os") { e.preventDefault(); move(key, 1); return; } e.preventDefault(); list[Math.min(list.length - 1, i + 1)]?.focus(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { if (e.altKey && from === "os") { e.preventDefault(); move(key, -1); return; } e.preventDefault(); list[Math.max(0, i - 1)]?.focus(); }
    else if (from === "lib" && e.key === " ") { e.preventDefault(); setCarry(key); setSay(`Picked up ${facet(key).app}. Press Enter to drop it into Your OS, or Escape to cancel.`); }
    else if (from === "lib" && e.key === "Enter" && carry) { e.preventDefault(); add(carry); setCarry(null); }
    else if (e.key === "Escape" && carry) { setCarry(null); setSay("Cancelled."); }
    else if (from === "os" && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); remove(key); }
  };

  const launch = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api("PUT", "/api/ws/os", { pack: cfg.pack, theme: cfg.theme, ai_paused: cfg.ai_paused, version: o?.os?.built ? o.os.version : undefined, modules: cfg.modules.filter((m) => m.mode !== "off") });
      for (const f of newFields) { try { await api("POST", "/api/ws/os/fields", f); } catch {} }
      setNewFields([]); setOs({ ...r.os, built: true });
      navigate("/workspace");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const lib = useMemo(() => {
    const w = q.trim().toLowerCase();
    return LIBRARY.map((c) => ({ ...c, apps: c.apps.filter((a) => !w || (a.app + " " + a.name + " " + a.features.map((x) => x.label).join(" ")).toLowerCase().includes(w)) })).filter((c) => c.apps.length);
  }, [q]);

  if (!o || !stage) return <Shell title="Your OS" bare><div className="bld"><Loading /></div></Shell>;
  if (stage === "start" || !cfg) return <Shell title="Your OS" bare><div className="bld"><Start onPick={pickPack} built={!!cfg} /></div></Shell>;

  const live = cfg.modules.filter((m) => m.mode !== "off");
  const est = estimate(cfg, people);
  const plan = PLANS[est.plan];
  const team = new Set(live.filter((m) => m.mode !== "external").map((m) => facet(m.key).agent).filter(Boolean));
  const selM = sel && mod(sel);
  const fieldsFor = (k) => [...fields.filter((f) => f.module === k), ...newFields.filter((f) => f.module === k)];

  return (
    <Shell title="Your OS" bare>
      <div className={"bld" + (selM ? " has-panel" : "")}>
        <div className="ob-bar">
          <div><h1 className="os-h">Your OS</h1><p className="dt">{o.os.built ? `Version ${o.os.version} · changes save when you press Save` : "Nothing saves until you launch"}</p></div>
          <div className="ob-bar-a">
            <button className="btn btn-sm btn-line" onClick={undo} disabled={!past.length} aria-label="Undo">Undo</button>
            <button className="btn btn-sm btn-line" onClick={redo} disabled={!future.length} aria-label="Redo">Redo</button>
            <button className="btn btn-sm btn-line" onClick={() => setStage("start")}>Start from an industry</button>
          </div>
        </div>
        {!owner && <Notice>Only the owner can change the OS. You can look around.</Notice>}
        <p className="sr-only" aria-live="assertive">{say}</p>

        <div className="ob-panes">
          <section className="ob-lib" aria-labelledby="ob-lib-h">
            <div className="ob-lib-h"><h2 id="ob-lib-h">Library</h2><span className="dt">{LIBRARY.reduce((n, c) => n + c.apps.length, 0)} apps</span></div>
            <input className="ob-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps and features" aria-label="Search the library" />
            {carry && <p className="ob-carry">Carrying <b>{facet(carry).app}</b>: press Enter to drop it into Your OS</p>}
            <div data-roving>
              {lib.map((c) => {
                const shown = q || open.has(c.key);
                return (
                  <div key={c.key} className="ob-cat">
                    <button className="ob-cat-h" aria-expanded={!!shown} onClick={() => setOpen((s) => { const n = new Set(s); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })}>
                      <Tile name={c.glyph} /><b>{c.name}</b><span>{c.apps.filter((a) => mod(a.key)).length}/{c.apps.length}</span><Glyph name="chev" size={14} />
                    </button>
                    {shown && (
                      <ul>
                        {c.apps.map((a) => {
                          const inOs = !!mod(a.key);
                          return (
                            <li key={a.key} className={"ob-lrow" + (inOs ? " is-in" : "") + (carry === a.key ? " is-carry" : "")}>
                              <div tabIndex={0} data-rove draggable={owner && !inOs} onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.key); e.dataTransfer.effectAllowed = "copy"; }} onKeyDown={(e) => owner && rovingKeys(e, a.key, "lib")} className="ob-lrow-b" aria-label={`${a.app}: ${a.optimal}. ${inOs ? "In your OS." : "Space to pick up."}`}>
                                <b>{a.app}</b><span>{a.optimal}</span>
                              </div>
                              {owner && (inOs ? <button className="ob-add is-in" onClick={() => setSel(a.key)} aria-label={`${a.app} settings`}><Glyph name="check" size={14} /></button> : <button className="ob-add" onClick={() => add(a.key)} aria-label={"Add " + a.app}><Glyph name="plus" size={14} /></button>)}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
              {!lib.length && <p className="empty">No app matches. Studio can build one: add your own fields to any app.</p>}
            </div>
          </section>

          <section className={"ob-os" + (over ? " is-over" : "")} aria-labelledby="ob-os-h"
            onDragOver={(e) => { if (owner) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const k = e.dataTransfer.getData("text/plain"); if (k && facet(k)) add(k); }}>
            <div className="ob-lib-h"><h2 id="ob-os-h">{me.org.name}</h2><span className="dt">Drop apps here</span></div>
            {!live.length && <p className="ob-empty">Drag apps here from the library, or tap + on any app.</p>}
            <div data-roving>
              {CATEGORIES.map((c) => {
                const ms = live.filter((m) => c.areas.includes(facet(m.key).area));
                if (!ms.length) return null;
                return (
                  <div key={c.key} className="ob-group">
                    <p className="ob-group-h">{c.name}</p>
                    <div className="ob-tiles">
                      {ms.map((m) => {
                        const f = facet(m.key), feats = featuresOf(m.key);
                        return (
                          <button key={m.key} data-rove className={"ob-tile ob-" + m.mode + (sel === m.key ? " is-sel" : "")} onClick={() => setSel(m.key)} onKeyDown={(e) => owner && e.key !== "Enter" && e.key !== " " && rovingKeys(e, m.key, "os")} aria-label={`${f.app}, ${MODE_LABEL[m.mode]}. Enter for settings, Alt and arrows to move, Delete to remove.`}>
                            <b>{f.app}</b>
                            <span>{m.mode === "here" ? `${m.features.length} of ${feats.length} features` : m.mode === "outsourced" ? (m.provider?.name ? `Outsourced to ${m.provider.name}` : "Outsourced") : "Keep my current tool"}</span>
                            <i className="ob-tile-m">{m.mode === "here" ? AUTONOMY_LABEL[m.autonomy] : MODE_LABEL[m.mode]}</i>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {why && <div className="ob-why"><p className="dt">Your OS, in a paragraph</p><p>{why}</p></div>}
          </section>

          {selM && (
            <Panel m={selM} owner={owner} onClose={() => setSel(null)} set={set} remove={remove}
              fields={fieldsFor(selM.key)}
              addField={(f) => { if (fieldsFor(f.module).some((x) => x.key === f.key) || !f.key) { setSay("That field is already there."); return; } setNewFields((x) => [...x, f]); setSay(`Added the field ${f.label}. It saves when you launch.`); }}
              removeField={async (f) => { if (f.id) { try { await api("DELETE", "/api/ws/os/fields/" + f.id); setFields((x) => x.filter((y) => y.id !== f.id)); } catch (e) { setErr(e.message); } } else setNewFields((x) => x.filter((y) => y !== f)); }} />
          )}
        </div>

        <footer className="ob-foot">
          <div className="ob-stats">
            <span><b>{live.filter((m) => m.mode === "here").length}</b> apps here</span>
            <span><b>{live.filter((m) => m.mode === "outsourced").length}</b> outsourced</span>
            <span><b>{live.filter((m) => m.mode === "external").length}</b> kept in current tools</span>
            <span><b>{team.size}</b> AI Team members</span>
            <span title="A rough guide from the apps and autonomy you set"><b>~{est.actions.toLocaleString("en-GB")}</b> actions a month</span>
            <label className="ob-people" title="Nothing needs a connection: imports are CSV or Excel.">for <input type="number" min="1" max="500" value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || 1))} aria-label="People in the business" /> people → <b>{plan.name}</b> £{plan.price}/mo</label>
          </div>
          <div className="ob-foot-a">
            {err && <Notice signal>{err}</Notice>}
            <button className="btn btn-sm btn-line" onClick={() => setWhy(explain(cfg))}>Explain my OS</button>
            {owner && <button className="btn btn-sm" disabled={busy || !live.length} onClick={launch}>{busy ? "Saving…" : o.os.built ? "Save" : "Launch my OS"}</button>}
          </div>
        </footer>
        <details className="ob-guard"><summary>Guardrails that no setting turns off</summary><ul>{(o.guardrails || GUARDRAILS).map((g) => <li key={g}>{g}</li>)}</ul></details>
        {dlg && <Dialog d={dlg} onClose={() => setDlg(null)} />}
      </div>
    </Shell>
  );
}
