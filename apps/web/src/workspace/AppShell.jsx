// The frame around every workspace screen. Desktop: a sidebar that collapses to an icon rail. Tablet: the rail.
// Phone: a bottom tab bar, with Setup in the avatar menu and Ask in the top bar. Pause agents is always visible.
import React, { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "../router.jsx";
import { Icon, clearToasts, hrefFor, toast, useStore } from "./core.jsx";
import { AskButton, AskPalette } from "./AskBar.jsx";
import { Avatar, Button, Toaster } from "./ui.jsx";
import { HUBS } from "./demo/catalogue";
import { reset, setView, togglePause } from "./demo/store";
import * as q from "./demo/selectors";
import { relative } from "./demo/format";

const NAV = [{ id: "home", name: "Home", icon: "Home", to: "/workspace" }, ...HUBS.map((h) => ({ id: h.id, name: h.name, icon: h.icon, to: "/workspace/" + h.id }))];
const RAIL_KEY = "bw:rail";

function useActive() {
  const { path } = useRoute();
  if (/^\/floor/.test(path)) return "team";
  const seg = path.split("/")[2] || "home";
  return seg === "setup" ? "setup" : seg;
}

function Menu({ open, onClose, children, label, align }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    setTimeout(() => ref.current?.querySelector("a,button")?.focus(), 10);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!open) return null;
  return <div className="w-menu" role="menu" aria-label={label} ref={ref} style={align === "left" ? { right: "auto", left: 0 } : undefined}>{children}</div>;
}

export function AppShell({ children }) {
  const s = useStore();
  const active = useActive();
  const pending = q.pendingCount(s);
  const [rail, setRail] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === "1"; } catch { return false; } });
  const [ask, setAsk] = useState(false);
  const [menu, setMenu] = useState(null);
  const { path } = useRoute();
  useEffect(() => { setMenu(null); setAsk(false); }, [path]);
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setAsk((x) => !x); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const flipRail = () => { const v = !rail; setRail(v); try { localStorage.setItem(RAIL_KEY, v ? "1" : "0"); } catch { /* per device only */ } };
  const pause = () => { togglePause(); toast(s.paused ? "Agents are working again." : "All agents are paused. Nothing runs or sends until you resume."); };
  const dana = s.people.find((p) => p.id === s.org.owner);
  const recent = s.activity.slice(0, 5);

  return (
    <div className="wk">
      <a className="sr-only" href="#w-main" onClick={(e) => { e.preventDefault(); document.getElementById("w-main")?.focus(); }}>Skip to content</a>
      <div className={"w-shell" + (rail ? " is-rail" : "")}>
        <nav className="w-side" aria-label="Workspace">
          <Link to="/workspace" className="w-brand" aria-label={`${s.org.name}, Home`}><span className="w-brand-mark" aria-hidden="true">{s.org.name[0]}</span><b>{s.org.name.split(" ")[0]}</b></Link>
          {NAV.map((n) => (
            <Link key={n.id} to={n.to} className="w-nav" aria-current={active === n.id ? "page" : undefined} title={n.name}>
              <Icon name={n.icon} size={20} /><span>{n.name}</span>
              {n.id === "home" && pending > 0 && <span className="w-count" aria-label={`${pending} decisions need you`}>{pending}</span>}
            </Link>
          ))}
          <span className="w-sp" />
          <Link to="/workspace/setup" className="w-nav" aria-current={active === "setup" ? "page" : undefined} title="Setup"><Icon name="Settings" size={20} /><span>Setup</span></Link>
          <button type="button" className="w-nav w-collapse" onClick={flipRail} aria-pressed={rail} title={rail ? "Expand the sidebar" : "Collapse to icons"}>
            <Icon name={rail ? "PanelLeftOpen" : "PanelLeftClose"} size={20} /><span>{rail ? "Expand" : "Collapse"}</span>
          </button>
        </nav>

        <div className="w-main">
          <header className="w-top">
            <Link to="/workspace" className="w-org"><span className="w-hide-m">{s.org.name}</span><span className="w-only-m w-brand-mark" aria-label={`${s.org.name}, Home`}>{s.org.name[0]}</span></Link>
            <Link to="/workspace/start" className="w-demo" title="This is a demo: nothing is sent. Set up your own business.">Demo · start yours</Link>
            <div className="w-sp"><AskButton onOpen={() => setAsk(true)} /></div>
            <AskButton compact onOpen={() => setAsk(true)} />
            <Button className={"w-pause" + (s.paused ? " is-paused" : "")} icon={s.paused ? "Play" : "Pause"} onClick={pause} aria-pressed={s.paused} title={s.paused ? "Resume all agents" : "Pause all agents"}>
              <span className="w-hide-m"><span className="w-hide-t">{s.paused ? "Resume agents" : "Pause agents"}</span><span className="w-only-t">{s.paused ? "Resume" : "Pause"}</span></span>
            </Button>
            <div style={{ position: "relative" }}>
              <Button variant="ghost" icon="Bell" className="w-bell" onClick={() => setMenu(menu === "bell" ? null : "bell")} aria-expanded={menu === "bell"} aria-label={`Notifications, ${pending} decisions need you`}>
                {pending > 0 && <span className="w-count" aria-hidden="true">{pending}</span>}
              </Button>
              <Menu open={menu === "bell"} onClose={() => setMenu(null)} label="Notifications">
                <Link to="/workspace" className="w-menu-i" role="menuitem"><span className="w-count">{pending}</span><span>{pending === 1 ? "decision needs" : "decisions need"} you on Home</span></Link>
                <div className="w-menu-sep" />
                <p className="w-menu-l">Latest</p>
                {recent.map((e) => (
                  <Link key={e.id} to={e.linkedRecord ? hrefFor(e.linkedRecord, s) : "/workspace"} className="w-menu-i" role="menuitem">
                    <Avatar actor={e.actor} />
                    <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 14 }}>{q.actorName(s, e.actor)} {e.verb}</span><small className="muted">{relative(e.at, s.now > e.at ? s.now : undefined)}</small></span>
                  </Link>
                ))}
              </Menu>
            </div>
            <div style={{ position: "relative" }}>
              <button type="button" className="w-avatar" style={{ width: 36, height: 36, fontSize: 13 }} onClick={() => setMenu(menu === "me" ? null : "me")} aria-expanded={menu === "me"} aria-label="Account, view and setup">{dana?.initials}</button>
              <Menu open={menu === "me"} onClose={() => setMenu(null)} label="Account">
                <p className="w-menu-h"><b>{dana?.name}</b>Owner · {s.org.name}</p>
                <div className="w-menu-sep" />
                <p className="w-menu-l">View</p>
                {[["owner", "Owner view", "Plain words, fewer columns"], ["accountant", "Accountant view", "Receivables, payables, full columns"]].map(([v, t, sub]) => (
                  <button key={v} type="button" role="menuitemradio" aria-checked={s.prefs.view === v} className="w-menu-i" onClick={() => { setView(v); setMenu(null); toast(`${t} on.`); }}>
                    <Icon name={s.prefs.view === v ? "CircleCheck" : "Circle"} size={18} /><span>{t}<small className="muted" style={{ display: "block", fontSize: 12 }}>{sub}</small></span>
                  </button>
                ))}
                <div className="w-menu-sep" />
                <Link to="/workspace/setup" className="w-menu-i" role="menuitem"><Icon name="Settings" size={18} />Setup</Link>
                <Link to="/workspace/setup/usage" className="w-menu-i" role="menuitem"><Icon name="Zap" size={18} />Usage and credits</Link>
                <Link to="/workspace/start" className="w-menu-i" role="menuitem"><Icon name="Sparkles" size={18} />Start your own workspace</Link>
                <button type="button" className="w-menu-i" role="menuitem" onClick={() => { reset(); clearToasts(); setMenu(null); toast("The demo is back to how it started."); }}><Icon name="RotateCcw" size={18} />Reset demo</button>
                <Link to="/" className="w-menu-i" role="menuitem"><Icon name="ExternalLink" size={18} />Agent House website</Link>
              </Menu>
            </div>
          </header>
          {s.paused && <div className="w-paused" role="status"><Icon name="Pause" size={16} />All agents are paused. Nothing runs or sends until you resume. <Button size="sm" onClick={pause}>Resume</Button></div>}
          <div id="w-main" tabIndex={-1} className="w-content">{children}</div>
        </div>
      </div>

      <nav className="w-tabbar" aria-label="Workspace">
        {NAV.map((n) => (
          <Link key={n.id} to={n.to} aria-current={active === n.id ? "page" : undefined}>
            <Icon name={n.icon} size={22} /><span>{n.name}</span>
            {n.id === "home" && pending > 0 && <span className="w-count" aria-label={`${pending} decisions need you`}>{pending}</span>}
          </Link>
        ))}
      </nav>
      <AskPalette open={ask} onClose={() => setAsk(false)} />
      <Toaster />
    </div>
  );
}
