import React, { createContext, useContext, useEffect, useState } from "react";
import { Link, useRoute, navigate } from "./router.jsx";
import { LIVE, api } from "./api.js";
import { Wordmark, Glyph, Tile } from "./kit.jsx";

/* The signed-in session, shared by the header and the workspace. */
export const WsCtx = createContext(null);
export function WorkspaceProvider({ children }) {
  // The signed-in session: undefined while checking, null when signed out (the workspace shows the demo).
  const [me, setMe] = useState(LIVE ? undefined : null);
  const refreshMe = async () => {
    if (!LIVE) return null;
    try { const m = await api("GET", "/api/ws/me"); setMe(m); return m; } catch { setMe(null); return null; }
  };
  useEffect(() => { refreshMe(); }, []);
  const signOut = async () => { try { await api("POST", "/api/auth/logout"); } catch {} setMe(null); navigate("/"); };
  return <WsCtx.Provider value={{ me, refreshMe, signOut }}>{children}</WsCtx.Provider>;
}
export const useWs = () => useContext(WsCtx);
const RANK = { viewer: 0, manager: 1, owner: 2 };
/** True when the signed-in user's role is at least `min`. */
export const useCan = () => { const { me } = useWs(); return (min) => !!me && RANK[me.role] >= RANK[min]; };

const MENUS = {
  business: {
    label: "For businesses",
    items: [
      ["floor", "The Floor", "Describe your business, get a team", "/floor"],
      ["org", "Org chart", "An orchestrator, roles and tasks you shape", "/how-it-works?s=team"],
      ["verify", "Check before you pay", "Customers and suppliers on the registers", "/health-check"],
      ["board", "Use cases", "Every job, scored, and what works today", "/use-cases"],
      ["agent", "All agents", "Outreach, inbox, credit control and more", "/agents"],
      ["workspace", "Demo workspace", "Click through a business run by agents", "/workspace"],
    ],
    foot: ["How it works", "/how-it-works"],
  },
  developers: {
    label: "For developers",
    items: [
      ["api", "Tools API", "Every tool in the catalogue, one POST", "/developers?s=reference"],
      ["agent", "Agents API", "Run a whole agent in one call", "/developers?s=reference"],
      ["verify", "Verify API", "Signed UK company checks", "/developers?s=verify"],
      ["tools", "Publish a tool", "Earn 80% of every call", "/developers/dashboard"],
      ["mcp", "MCP server", "The catalogue in Claude or any client", "/developers?s=mcp"],
    ],
    foot: ["Get a free API key", "/developers?s=key"],
  },
  agents: {
    label: "For agents",
    items: [
      ["tools", "Tool catalogue", "Priced per call, with schemas", "/for-agents?s=catalogue"],
      ["pay", "x402 payments", "Pay per call in USDC, no account", "/for-agents?s=x402"],
      ["globe", "Discovery", "agent-house.json, llms.txt and MCP", "/for-agents"],
      ["verify", "Signed answers", "Ed25519 on every response", "/developers?s=verify"],
    ],
  },
};

function Mega({ id, menu, open, onClose }) {
  return (
    <div id={"mega-" + id} className={"mega" + (open ? " is-open" : "")} role="menu" aria-hidden={!open}>
      {menu.items.map(([g, t, d, to]) => (
        <Link key={to} to={to} className="mega-item" role="menuitem" tabIndex={open ? 0 : -1} onClick={onClose}>
          <Tile name={g} /><span><b>{t}</b><span>{d}</span></span>
        </Link>
      ))}
      {menu.foot && <p className="mega-foot"><Link to={menu.foot[1]} className="link link-s" tabIndex={open ? 0 : -1} onClick={onClose}>{menu.foot[0]}</Link></p>}
    </div>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const { path } = useRoute();
  const { me } = useWs();
  const timer = React.useRef(null);
  useEffect(() => { setOpen(false); setMenu(null); }, [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const over = path === "/" && !scrolled && !open && !menu;
  const enter = (k) => { clearTimeout(timer.current); setMenu(k); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setMenu(null), 160); };
  const account = me ? ["Workspace", "/workspace"] : LIVE ? ["Sign in", "/sign-in"] : ["Demo", "/workspace"];
  return (
    <header className={"hdr" + (over ? " is-over" : "") + (open ? " is-open" : "")}>
      <div className="wrap hdr-in">
        <Link to="/" className="wordmark" aria-label="Agent House home"><Wordmark /></Link>
        <nav className="hdr-nav" aria-label="Main">
          {Object.entries(MENUS).map(([k, m]) => (
            <div key={k} className="nav-item" onMouseEnter={() => enter(k)} onMouseLeave={leave}>
              <button className="nav-trigger" aria-expanded={menu === k} aria-controls={"mega-" + k} onClick={() => setMenu(menu === k ? null : k)}>
                {m.label}<Glyph name="chev" size={16} />
              </button>
              <Mega id={k} menu={m} open={menu === k} onClose={() => setMenu(null)} />
            </div>
          ))}
          <Link to="/pricing">Pricing</Link>
        </nav>
        <div className="hdr-right">
          <Link to={account[1]} className="hdr-link">{account[0]}</Link>
          <Link to={me ? "/workspace" : "/start"} className={"btn btn-sm hdr-cta" + (over ? " btn-light" : "")}>{me ? "Open workspace" : "Start free"}</Link>
          <button className="hdr-menu" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
        </div>
      </div>
      <nav id="mobile-nav" className="mnav" aria-label="Main" hidden={!open}>
        <div className="wrap">
          {Object.values(MENUS).map((m) => (
            <div key={m.label} className="mnav-group">
              <b>{m.label}</b>
              {m.items.map(([, t, , to]) => <Link key={to} to={to}>{t}</Link>)}
            </div>
          ))}
          <div className="mnav-group"><Link to="/pricing">Pricing</Link><Link to={account[1]}>{account[0]}</Link></div>
          <Link to={me ? "/workspace" : "/start"} className="btn btn-block">{me ? "Open workspace" : "Start free"}</Link>
        </div>
      </nav>
    </header>
  );
}

export function Footer() {
  const { me } = useWs();
  const cols = [
    ["For businesses", [["The Floor", "/floor"], ["Use cases", "/use-cases"], ["All agents", "/agents"], ["How it works", "/how-it-works"], ["Free customer check", "/health-check"], ["Demo workspace", "/workspace"], ["Pricing", "/pricing"]]],
    ["For developers", [["Developers", "/developers"], ["Publish a tool", "/developers/dashboard"], ["MCP server", "/developers?s=mcp"], ["Get an API key", "/developers?s=key"]]],
    ["For agents", [["Tool catalogue", "/for-agents?s=catalogue"], ["x402 payments", "/for-agents?s=x402"], ["Verifying answers", "/developers?s=verify"]]],
    ["Company", [["Trust", "/trust"], ["Book a call", "/book-a-call"], [me ? "Workspace" : "Sign in", me ? "/workspace" : "/sign-in"]]],
  ];
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr-top">
          <div className="ftr-cols">
            {cols.map(([h, links]) => (
              <nav key={h} className="ftr-col" aria-label={h}><b>{h}</b>{links.map(([t, to]) => <Link key={t} to={to}>{t}</Link>)}</nav>
            ))}
          </div>
          <Link to="/" className="wordmark" aria-label="Agent House home"><Wordmark /></Link>
        </div>
        <div className="ftr-fine">
          <span>© 2026 Agent House. Built in Manchester. Register data from Companies House and The Gazette under the Open Government Licence v3.0, and the FCA Financial Services Register.</span>
          <nav aria-label="Legal"><Link to="/trust">Trust</Link><Link to="/unsubscribe">Unsubscribe</Link><Link to="/book-a-call">Contact</Link></nav>
        </div>
      </div>
    </footer>
  );
}
