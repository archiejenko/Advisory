// The OS shell: one full-screen frame for every workspace screen. A top bar with the AI Team's status core,
// search and the command layer, theme and pause; the page in the middle; and a dock of the apps in this
// business's OS, with live badges. No marketing header or footer in here.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, navigate, useRoute } from "../router.jsx";
import { Glyph } from "../kit.jsx";
import { useWs, useCan } from "../layout.jsx";
import { api, useApi, isDemo } from "../api.js";
import { useVoice, voiceSupported, speakText, stopSpeaking } from "../voice.js";
import { useOs, setOs, useTheme, setViewerTheme } from "../osStore.js";
import { FACETS, facet, areaOf } from "../../../../packages/core/os.ts";
import { THEMES } from "../../../../packages/core/osconfig.ts";

/* ---------- The AI Team's state, as one ring ---------- */
export function statusOf(n, paused) {
  if (paused) return { key: "paused", label: "Paused", line: "The AI Team is paused. Nothing runs until you resume it." };
  if ((n.waiting || 0) > 0) return { key: "waiting", label: `${n.waiting} waiting for you`, line: `${n.waiting} ${n.waiting === 1 ? "draft is" : "drafts are"} waiting for your OK.` };
  if ((n.open_alerts || 0) > 0) return { key: "risk", label: "At risk", line: `${n.open_alerts} ${n.open_alerts === 1 ? "alert needs" : "alerts need"} a look before ${n.open_alerts === 1 ? "it costs" : "they cost"} you.` };
  return { key: "working", label: "Working", line: "Everything is running. Nothing needs you right now." };
}
export function Core({ state, size = 22, onClick, label }) {
  const C = onClick ? "button" : "span";
  return <C className={"os-core os-core-" + state} style={{ width: size, height: size }} onClick={onClick} aria-label={label} title={label}><i /></C>;
}
export function briefing(n, paused, name) {
  const parts = [`Here's ${name || "the business"} right now.`];
  if (paused) parts.push("The AI Team is paused.");
  parts.push(n.waiting ? `${n.waiting} ${n.waiting === 1 ? "draft is" : "drafts are"} waiting for your OK.` : "Nothing is waiting for your OK.");
  if (n.overdue_invoices) parts.push(`${n.overdue_invoices} ${n.overdue_invoices === 1 ? "invoice is" : "invoices are"} overdue, and credit control is on ${n.overdue_invoices === 1 ? "it" : "them"}.`);
  if (n.open_tasks) parts.push(`${n.open_tasks} open ${n.open_tasks === 1 ? "task" : "tasks"}.`);
  if (n.open_alerts) parts.push(`${n.open_alerts} ${n.open_alerts === 1 ? "alert" : "alerts"} on customers or suppliers.`);
  if (n.inbox_new) parts.push(`${n.inbox_new} new ${n.inbox_new === 1 ? "message" : "messages"} in the inbox.`);
  if (n.runs_week) parts.push(`${n.runs_week} pieces of work done this week.`);
  return parts.join(" ");
}

/* ---------- The command layer: go to, ask, instruct ---------- */
const PAGES = [
  ["Home", "/workspace", "home today"], ["Approvals", "/workspace/approvals", "approve drafts waiting emails"], ["Tasks", "/workspace/tasks", "tasks to do"],
  ["Messages", "/workspace/messages", "chat channels messages"], ["Invoices", "/workspace/invoices", "invoices overdue unpaid owed money"], ["Leads", "/workspace/leads", "leads prospects customers new"],
  ["Inbox", "/workspace/inbox", "inbox email enquiries"], ["Alerts", "/workspace/alerts", "alerts risk watch"], ["Customers", "/workspace/clients", "customers clients suppliers"],
  ["The Floor", "/floor", "floor team org chart ai team"], ["AI Team", "/workspace/agents", "ai team roles members"], ["Activity", "/workspace/activity", "activity runs history log"],
  ["Your OS", "/workspace/build", "your os builder apps settings modules customise"], ["All apps", "/workspace/apps", "apps all modules"], ["Settings", "/workspace/settings", "settings profile account"],
  ["Usage and plan", "/workspace/usage", "usage plan billing actions"], ["House rules", "/workspace/rules", "rules house how we work"],
];
const ASK_ROUTES = [
  [/\b(owe|bills?|pay(?:ables)?|suppliers?)\b/i, "Payables agent"], [/\b(cash|runway|afford|bank)\b/i, "Cash forecaster"],
  [/\b(invoice|overdue|paid|chase|debt)\b/i, "Credit control"], [/\b(quote|proposal)\b/i, "Proposals agent"],
  [/\b(rota|shift|cover)\b/i, "Rota planner"], [/\b(stock|inventory|reorder)\b/i, "Stock agent"], [/\b(complain|complaint)\b/i, "Complaints triage"],
  [/\b(hire|hiring|recruit|applicant)\b/i, "Recruiting agent"], [/\b(vat)\b/i, "VAT preparer"], [/\b(payroll|payslip)\b/i, "Payroll preparer"],
];
const QUESTION = /\?\s*$|^(what|how|who|when|where|why|which|do|does|did|is|are|can|could|should|will|have|has)\b/i;
const GO = /^(open|show|go to|goto|take me to|find)\s+/i;
export function routeCommand(text) {
  const t = text.trim();
  const at = t.match(/^@([A-Za-z][\w -]*?)(?:\s*[:,]\s*|\s+)(.+)$/);
  if (at) {
    const role = FACETS.map((f) => f.agent).filter(Boolean).sort((a, b) => b.length - a.length).find((r) => t.slice(1).toLowerCase().startsWith(r.toLowerCase()));
    return { kind: "instruct", role: role || at[1].trim(), text: t };
  }
  if (GO.test(t)) return { kind: "go", query: t.replace(GO, "") };
  if (QUESTION.test(t)) return { kind: "ask", role: (ASK_ROUTES.find(([re]) => re.test(t)) || [null, "Analyst"])[1], text: t };
  return { kind: "go", query: t };
}
function matches(query, mods) {
  const w = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!w.length) return [];
  const score = (hay) => w.reduce((n, x) => n + (hay.includes(x) ? 1 : 0), 0);
  const pages = PAGES.map(([t, to, k]) => ({ t, to, sub: "Page", s: score((t + " " + k).toLowerCase()) }));
  const apps = (mods || FACETS).filter((m) => m.mode !== "off").map((m) => ({ t: m.app, to: "/workspace/app/" + m.key, sub: (areaOf(m.area)?.name || "") + (m.mode && m.mode !== "here" ? " · " + (m.mode === "outsourced" ? "outsourced" : "kept elsewhere") : ""), s: score((m.app + " " + m.name).toLowerCase()) * 1.1 }));
  return [...pages, ...apps].filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8);
}

async function generalChannel() {
  const c = await api("GET", "/api/ws/os/channels");
  return (c.channels || []).find((x) => x.name === "general") || c.channels?.[0];
}

export function CommandLayer({ open, onClose, mods }) {
  const [text, setText] = useState("");
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => { if (open) { setOut(null); setTimeout(() => input.current?.focus(), 30); } else stopSpeaking(); }, [open]);
  const voice = useVoice({ serverVoice: false, onText: (t) => { setText(t); run(t); }, onError: (m) => setOut({ kind: "error", text: m }) });
  const r = text.trim() ? routeCommand(text) : null;
  const list = r?.kind === "go" ? matches(r.query, mods) : [];

  async function run(t = text) {
    const c = routeCommand(t);
    if (c.kind === "go") { const m = matches(c.query, mods)[0]; if (m) { navigate(m.to); onClose(); } else setOut({ kind: "error", text: "Nothing matched. Try an app name, or ask a question." }); return; }
    setBusy(true);
    try {
      const ch = await generalChannel();
      if (!ch) throw new Error("There's no channel to ask in yet.");
      const sent = await api("POST", `/api/ws/os/channels/${ch.id}/messages`, { body: c.text.startsWith("@") ? c.text : `@${c.role} ${c.text}` });
      const asked = sent.asked?.[0];
      if (c.kind === "instruct") { setOut({ kind: "done", text: asked?.error ? `${c.role} is paused, so it wasn't asked.` : `Asked ${c.role} in #${ch.name}. It works it as a task or a draft for you to approve; nothing irreversible happens on its own.`, to: "/workspace/messages?c=" + ch.id }); return; }
      setOut({ kind: "thinking", text: `Asking ${c.role}…` });
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 800));
        const m = await api("GET", `/api/ws/os/channels/${ch.id}/messages?after=${encodeURIComponent(sent.message.at)}`);
        const reply = (m.messages || []).find((x) => x.author_kind !== "person" && x.at > sent.message.at);
        if (reply) { setOut({ kind: "answer", who: reply.author_name, text: reply.body, to: "/workspace/messages?c=" + ch.id }); return; }
      }
      setOut({ kind: "done", text: `${c.role} is working on it. The answer will be in #${ch.name}.`, to: "/workspace/messages?c=" + ch.id });
    } catch (e) { setOut({ kind: "error", text: e.message }); } finally { setBusy(false); }
  }
  if (!open) return null;
  return (
    <div className="os-cmd-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="os-cmd" role="dialog" aria-modal="true" aria-label="Search or ask">
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(); }} className="os-cmd-row">
          <Glyph name="search" size={18} />
          <input ref={input} value={text} onChange={(e) => { setText(e.target.value); setOut(null); }} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} placeholder='Open an app, ask "what do we owe this week?", or @Payroll preparer prepare October' aria-label="Search or ask" />
          {voiceSupported() && (
            <button type="button" className={"os-mic" + (voice.state === "listening" ? " is-on" : "")} aria-label="Hold to talk" onPointerDown={(e) => { e.preventDefault(); voice.start(); }} onPointerUp={() => voice.stop()} onPointerLeave={() => voice.state === "listening" && voice.stop()}><Glyph name="mic" size={18} /></button>
          )}
        </form>
        {r && !out && (
          <p className="os-cmd-kind">{r.kind === "go" ? "Go to" : r.kind === "ask" ? <>Ask <b>{r.role}</b> · press Enter</> : <>Instruct <b>{r.role}</b> · it becomes a task or a draft, never an irreversible action</>}</p>
        )}
        {list.length > 0 && !out && (
          <ul className="os-cmd-list">{list.map((m) => <li key={m.to}><Link to={m.to} onClick={onClose}><b>{m.t}</b><span>{m.sub}</span></Link></li>)}</ul>
        )}
        {out && (
          <div className={"os-cmd-out os-cmd-" + out.kind} aria-live="polite">
            {out.who && <b>{out.who}</b>}
            <p>{out.text}</p>
            {out.kind === "answer" && <button className="link link-s" onClick={() => speakText(out.text)}>Read it to me</button>}
            {out.to && <Link to={out.to} className="link link-s" onClick={onClose}>Open the conversation</Link>}
          </div>
        )}
        {!text && !out && (
          <div className="os-cmd-hints">
            <span>Try</span>
            {["open invoices", "what do we owe this week?", "@Rota planner fill Friday's evening shift"].map((h) => <button key={h} onClick={() => { setText(h); input.current?.focus(); }}>{h}</button>)}
          </div>
        )}
        {busy && <p className="os-cmd-kind">Working…</p>}
      </div>
    </div>
  );
}

/* ---------- The frame ---------- */
/** Quiet hours on this device (default 8pm to 7am): only critical alerts reach the lock screen. */
function quietNow() {
  let q = { from: "20:00", to: "07:00" };
  try { q = JSON.parse(localStorage.getItem("ah:quiet") || "null") || q; } catch {}
  const t = new Date().toTimeString().slice(0, 5);
  return q.from > q.to ? t >= q.from || t < q.to : t >= q.from && t < q.to;
}
const DOCK_FIXED = [["Home", "/workspace", "workspace"], ["Messages", "/workspace/messages", "bell"]];
export function useCounts() {
  const counts = useApi("/api/ws/overview");
  useEffect(() => {
    const on = () => counts.reload();
    window.addEventListener("ah:alerts", on);
    const t = setInterval(on, 60000);
    return () => { window.removeEventListener("ah:alerts", on); clearInterval(t); };
  }, [counts.reload]);
  return counts.data || {};
}
const APP_GLYPH = { "one-task-list-for-people-and-agents": "check", "approvals-routing": "verify", "team-chat-and-channels": "bell", "shared-inbox-and-tickets": "inbox", "pipeline-and-crm": "send", "sales-invoicing": "pound", "credit-control": "ledger", "projects-and-jobs": "split", "bookings-and-scheduling": "clock", "dashboards": "health", "documents": "board", "quotes-and-proposals": "tools" };
/** The apps in the dock: pinned ones from the saved layout, else the first apps run here or kept elsewhere. */
export function dockApps(os, catalogue, pinned) {
  const usable = (os?.modules || []).filter((m) => m.mode === "here" || m.mode === "external").sort((a, b) => a.position - b.position);
  const keys = pinned?.length ? pinned.filter((k) => usable.some((m) => m.key === k)) : usable.slice(0, 7).map((m) => m.key);
  const byKey = new Map((catalogue?.modules || []).map((m) => [m.key, m]));
  return keys.map((k) => { const f = facet(k); const c = byKey.get(k); return f && { key: k, app: f.app, glyph: APP_GLYPH[k] || areaOf(f.area)?.glyph || "board", open: c?.open || 0, mode: usable.find((m) => m.key === k)?.mode }; }).filter(Boolean);
}

export function OsShell({ title, crumbs = [], actions, children, wide, bare }) {
  const { me, signOut } = useWs();
  const can = useCan();
  const { path } = useRoute();
  const o = useOs();
  const os = o?.os;
  const theme = useTheme(os);
  const n = useCounts();
  const cat = useApi("/api/ws/os/catalogue");
  const layout = useApi("/api/ws/os/layout");
  const [cmd, setCmd] = useState(false);
  const [menu, setMenu] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [toast, setToast] = useState(null);
  const paused = !!os?.ai_paused;
  const st = statusOf(n, paused);
  const dock = useMemo(() => dockApps(os?.built ? os : null, cat.data, layout.data?.dock), [os, cat.data, layout.data]);
  const mods = useMemo(() => (cat.data?.modules || []).map((m) => ({ ...m, mode: m.mode || "here" })), [cat.data]);

  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((x) => !x); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { document.documentElement.dataset.osTheme = theme; return () => { delete document.documentElement.dataset.osTheme; }; }, [theme]);
  useEffect(() => { setMenu(false); }, [path]);
  // A new draft waiting for you: a notification (simulated in the demo) that opens it.
  const prevWaiting = useRef(null);
  useEffect(() => {
    if (prevWaiting.current !== null && (n.waiting || 0) > prevWaiting.current) notify(`${n.waiting - prevWaiting.current} new ${n.waiting - prevWaiting.current === 1 ? "draft" : "drafts"} to approve`, "/workspace/approvals");
    prevWaiting.current = n.waiting ?? null;
  }, [n.waiting]);
  function notify(text, to, critical) {
    setToast({ text, to });
    setTimeout(() => setToast(null), 6000);
    try {
      if (!critical && quietNow()) return;
      if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then((r) => r.showNotification("Agent House", { body: text, data: { to }, tag: "approvals" }));
    } catch {}
  }
  useEffect(() => { window.__ahNotify = notify; return () => { delete window.__ahNotify; }; }, []);

  const brief = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    try { await speakText(briefing(n, paused, me.org.name)); } catch {} finally { setSpeaking(false); }
  };
  const pause = async () => {
    try { const r = await api("POST", "/api/ws/os/pause", { paused: !paused }); setOs({ ...r.os, built: true }); window.dispatchEvent(new Event("ah:alerts")); }
    catch (e) { setToast({ text: e.message }); }
  };
  const initials = (me.user.name || me.user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  return (
    <div className="os-shell" data-theme={theme}>
      <header className="os-top">
        <Core state={st.key} onClick={brief} label={(speaking ? "Stop the briefing. " : "Brief me. ") + st.label} />
        <Link to="/workspace" className="os-org"><b>{me.org.name}</b><span>{st.label}</span></Link>
        {me.demo && <Link to="/start" className="os-demo" title="Nothing is sent, and changes last until you reload">Demo · start yours</Link>}
        <button className="os-find" onClick={() => setCmd(true)} aria-label="Search or ask (Command K)"><Glyph name="search" size={16} /><span>Search or ask</span><kbd>⌘K</kbd></button>
        {can("manager") && (
          <button className={"os-pause" + (paused ? " is-paused" : "")} onClick={pause} aria-pressed={paused} title={paused ? "Resume the AI Team" : "Pause the AI Team"}>
            <Glyph name={paused ? "play" : "pause"} size={16} /><span>{paused ? "Resume" : "Pause"}</span>
          </button>
        )}
        <div className="os-me">
          <button className="os-avatar" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Account and theme">{initials}</button>
          {menu && (
            <div className="os-menu" role="menu">
              <p className="os-menu-h">{me.user.email}<span>{me.role}</span></p>
              <p className="os-menu-l">Theme on this device</p>
              <div className="os-themes">{THEMES.map((t) => <button key={t.key} role="menuitemradio" aria-checked={theme === t.key} className={theme === t.key ? "is-on" : ""} onClick={() => setViewerTheme(t.key)}><i className={"os-sw os-sw-" + t.key} />{t.name}</button>)}</div>
              <Link to="/workspace/build" role="menuitem">Your OS</Link>
              <Link to="/workspace/settings" role="menuitem">Settings</Link>
              <Link to="/workspace/usage" role="menuitem">Usage and plan</Link>
              <Link to="/" role="menuitem">Agent House website</Link>
              {me.demo ? <Link to="/start" role="menuitem">Start a free trial</Link> : <button role="menuitem" onClick={signOut}>Sign out</button>}
            </div>
          )}
        </div>
      </header>
      {paused && <div className="os-paused" role="status">The AI Team is paused. Nothing runs and nothing is sent until you resume it. {can("manager") && <button className="link link-s" onClick={pause}>Resume</button>}</div>}
      <div className={"os-body" + (wide ? " os-body-wide" : "")}>
        {bare ? children : (
          <>
            {crumbs.length > 0 && (
              <nav className="os-crumbs" aria-label="Breadcrumb"><ol><li><Link to="/workspace">Home</Link></li>{crumbs.map(([t, to]) => <li key={t}>{to ? <Link to={to}>{t}</Link> : <span aria-current="page">{t}</span>}</li>)}</ol></nav>
            )}
            <div className="os-titlebar"><h1 className="os-h">{title}</h1>{actions && <div className="ws-actions">{actions}</div>}</div>
            {children}
          </>
        )}
      </div>
      <nav className="os-dock" aria-label="Your apps">
        {DOCK_FIXED.map(([t, to, g]) => <Link key={to} to={to} exact className="os-dock-i"><Glyph name={g} size={20} /><span>{t}</span>{to === "/workspace" && n.waiting > 0 && <b className="os-badge">{n.waiting}</b>}</Link>)}
        <span className="os-dock-sep" aria-hidden="true" />
        {dock.map((d) => <Link key={d.key} to={"/workspace/app/" + d.key} className={"os-dock-i" + (d.mode === "external" ? " is-ext" : "")} title={d.app + (d.mode === "external" ? " (kept elsewhere)" : "")}><Glyph name={d.glyph} size={20} /><span>{d.app}</span>{d.open > 0 && <b className="os-badge os-badge-q">{d.open}</b>}</Link>)}
        <span className="os-dock-sep" aria-hidden="true" />
        <Link to="/floor" className="os-dock-i"><Glyph name="floor" size={20} /><span>AI Team</span></Link>
        <Link to="/workspace/build" className="os-dock-i"><Glyph name="plus" size={20} /><span>Your OS</span></Link>
      </nav>
      <button className="os-talk" onClick={() => setCmd(true)} aria-label="Search, ask or talk"><Glyph name="mic" size={18} /><span>Ask or say anything</span></button>
      <CommandLayer open={cmd} onClose={() => setCmd(false)} mods={mods} />
      {toast && <div className="os-toast" role="status">{toast.to ? <Link to={toast.to} onClick={() => setToast(null)}>{toast.text}</Link> : toast.text}</div>}
    </div>
  );
}
