// Shared pieces for the v6 site: glyphs, reveal-on-scroll, marquee, terminal, code editor.
import React, { useEffect, useRef, useState } from "react";
import { reduced } from "./ui.jsx";

/* ---------- Brand mark: a roof over an open door, drawn for Agent House ---------- */
export function Mark({ className = "wm-mark" }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" />
      <path d="M8 15.5 16 9l8 6.5" fill="none" stroke="var(--mark-ink, #fff)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 24v-5.5h7V24" fill="none" stroke="var(--mark-ink, #fff)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- Line glyphs (24px grid, 1.6 stroke) ---------- */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
export const GLYPHS = {
  watch: <><circle cx="12" cy="12" r="8.5" {...P} /><circle cx="12" cy="12" r="4.5" {...P} /><path d="M12 12 18 6" {...P} /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></>,
  check: <><path d="M6 3.5h8l4 4v13H6z" {...P} /><path d="M14 3.5v4h4" {...P} /><path d="m9 14 2 2 4-4.5" {...P} /></>,
  prospect: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" {...P} /><circle cx="12" cy="10" r="2.4" {...P} /></>,
  workspace: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...P} /><path d="M9 4.5v15M3.5 9.5H9" {...P} /></>,
  api: <><path d="M8 5c-2 0-2.5 1-2.5 2.5v2c0 1.2-.8 2-2 2.5 1.2.5 2 1.3 2 2.5v2C5.5 18 6 19 8 19M16 5c2 0 2.5 1 2.5 2.5v2c0 1.2.8 2 2 2.5-1.2.5-2 1.3-2 2.5v2c0 1.5-.5 2.5-2.5 2.5" {...P} /></>,
  mcp: <><path d="M9 3.5v5M15 3.5v5M6.5 8.5h11V12a5.5 5.5 0 0 1-11 0z" {...P} /><path d="M12 17.5v3" {...P} /></>,
  pay: <><circle cx="12" cy="12" r="8.5" {...P} /><path d="M14.5 9c-.4-1-1.3-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2 0 2.8 5 1.5 5 4.2 0 1.2-1 2.3-2.5 2.3-1.3 0-2.3-.6-2.7-1.7M12 6v1.5M12 16v1.5" {...P} /></>,
  verify: <><path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" {...P} /><path d="m9 12 2 2 4-4.5" {...P} /></>,
  pricing: <><path d="M3.5 12.5 12 4h7.5v7.5L11 20z" {...P} /><circle cx="15.5" cy="8" r="1.4" {...P} /></>,
  method: <><path d="M4 6h10M4 12h16M4 18h7" {...P} /><circle cx="18" cy="6" r="2" {...P} /><circle cx="15" cy="18" r="2" {...P} /></>,
  standards: <><path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5" {...P} /><path d="M9 8.5h6M9 12h4" {...P} /></>,
  health: <><path d="M3.5 12h4l2-5 4 10 2-5h5" {...P} /></>,
  call: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" {...P} /><path d="M3.5 9.5h17M8 3v4M16 3v4" {...P} /></>,
  stop: <><path d="M8.5 3.5h7l5 5v7l-5 5h-7l-5-5v-7z" {...P} /><path d="M12 8v5" {...P} /><circle cx="12" cy="16" r="1" fill="currentColor" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" {...P} /><path d="M12 7.5V12l3 2" {...P} /></>,
  person: <><circle cx="12" cy="8" r="3.5" {...P} /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" {...P} /></>,
  split: <><path d="M12 20v-6M12 14 6 8M12 14l6-6M6 8V4M18 8V4" {...P} /></>,
  pound: <><path d="M16.5 6.5c-.6-1.6-2-2.5-3.7-2.5-2.3 0-3.8 1.6-3.8 3.8V19M6.5 12h7M6 19h11" {...P} /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" {...P} /><path d="M10 20.5a2 2 0 0 0 4 0" {...P} /></>,
  send: <><path d="M20.5 3.5 3.5 10.5l7 2.5 2.5 7z" {...P} /><path d="m20.5 3.5-10 9.5" {...P} /></>,
  inbox: <><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" {...P} /><path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5" {...P} /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" {...P} /><path d="m15.5 15.5 5 5" {...P} /></>,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" {...P} />,
  megaphone: <><path d="M4 10v4h3l8 4.5v-13L7 10z" {...P} /><path d="M18.5 9.5a3.5 3.5 0 0 1 0 5M7 14l1.5 5.5h2.5L10 15" {...P} /></>,
  ledger: <><rect x="5" y="3.5" width="14" height="17" rx="2" {...P} /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" {...P} /></>,
  agent: <><rect x="4.5" y="7.5" width="15" height="12" rx="3" {...P} /><path d="M12 3.5v4M9 13v1.5M15 13v1.5M2.5 12.5v3M21.5 12.5v3" {...P} /></>,
  tools: <><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z" {...P} /><path d="M14.5 6.5 17 4l3 3-2.5 2.5" {...P} /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" {...P} />,
  code: <><path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" {...P} /></>,
  globe: <><circle cx="12" cy="12" r="8.5" {...P} /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" {...P} /></>,
  chev: <path d="m6 9 6 6 6-6" {...P} />,
  left: <path d="m15 6-6 6 6 6" {...P} />,
  right: <path d="m9 6 6 6-6 6" {...P} />,
  expand: <><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" {...P} /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" {...P} /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" {...P} /></>,
  speaker: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" {...P} /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" {...P} /></>,
  mute: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" {...P} /><path d="m16 9.5 5 5M21 9.5l-5 5" {...P} /></>,
  spark: <><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M18 6l-2.6 2.6M8.6 15.4 6 18" {...P} /></>,
  pause: <><path d="M9 5.5v13M15 5.5v13" {...P} /></>,
  play: <path d="M7.5 5.5v13l11-6.5z" {...P} />,
  close: <path d="m6 6 12 12M18 6 6 18" {...P} />,
  board: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...P} /><path d="M9.5 4.5v15M15 4.5v15" {...P} /></>,
  floor: <><circle cx="6.5" cy="7" r="2.5" {...P} /><circle cx="17.5" cy="7" r="2.5" {...P} /><circle cx="12" cy="17" r="2.5" {...P} /><path d="M8.5 8.5 10.5 15M15.5 8.5 13.5 15M9 7h6" {...P} /></>,
  building: <><path d="M4.5 20.5V5l8-2v17.5M12.5 8.5h7v12M3 20.5h18" {...P} /><path d="M7.5 8h2M7.5 11.5h2M7.5 15h2M15.5 12h1.5M15.5 15.5h1.5" {...P} /></>,
};
export function Glyph({ name, size = 22, color }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={color ? { color } : undefined}>{GLYPHS[name]}</svg>;
}
export function Tile({ name, color }) {
  return <span className="tile"><Glyph name={name} color={color} /></span>;
}

/* ---------- Reveal on first view ---------- */
export function useInView(opts = { threshold: 0.2 }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    if (typeof IntersectionObserver === "undefined" || reduced()) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, opts);
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}
export function Reveal({ as: Tag = "div", className = "", delay = 0, style, children, ...rest }) {
  const [ref, seen] = useInView({ threshold: 0.12 });
  return <Tag ref={ref} className={"rv" + (seen ? " is-in" : "") + (className ? " " + className : "")} style={{ ...style, transitionDelay: delay + "ms" }} {...rest}>{children}</Tag>;
}

/* ---------- Marquee ---------- */
export function Marquee({ items, caption }) {
  const row = [...items, ...items];
  return (
    <div>
      {caption && <p className="mq-cap">{caption}</p>}
      <div className="marquee" aria-label={items.join(", ")}>
        <div className="marquee-track" aria-hidden="true">{row.map((t, i) => <span key={i}>{t}</span>)}</div>
      </div>
    </div>
  );
}

/* ---------- Terminal that types when it scrolls into view ---------- */
// lines: [{ cmd: "text" } | { out: [[cls, text], ...] }]
export function Terminal({ title, lines, className = "" }) {
  const [ref, seen] = useInView({ threshold: 0.3 });
  const [step, setStep] = useState(reduced() ? lines.length : 0);
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (!seen || step >= lines.length) return;
    const l = lines[step];
    if (l.cmd !== undefined) {
      if (typed < l.cmd.length) { const t = setTimeout(() => setTyped(typed + 1), 22); return () => clearTimeout(t); }
      const t = setTimeout(() => { setStep(step + 1); setTyped(0); }, 380);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep(step + 1), 70);
    return () => clearTimeout(t);
  }, [seen, step, typed]);
  return (
    <div className={"term " + className} ref={ref}>
      <div className="term-bar"><i /><i /><i /><span>{title}</span></div>
      <pre aria-label={lines.map((l) => (l.cmd !== undefined ? "$ " + l.cmd : l.out.map((x) => x[1]).join(""))).join("\n")}>
        {lines.slice(0, step + 1).map((l, i) => {
          if (l.cmd !== undefined) {
            const text = i < step ? l.cmd : l.cmd.slice(0, typed);
            return <div key={i}><span className="t-ok">➜</span> <span className="t-dim">~</span> {text}{i === step && <span className="t-cur" />}</div>;
          }
          return i < step || step >= lines.length ? <div key={i}>{l.out.length ? l.out.map(([c, t], j) => <span key={j} className={c}>{t}</span>) : " "}</div> : null;
        })}
        {step >= lines.length && <div><span className="t-ok">➜</span> <span className="t-dim">~</span> <span className="t-cur" /></div>}
      </pre>
    </div>
  );
}

/* ---------- Code editor window with line numbers and simple highlighting ---------- */
function hl(line) {
  const out = []; let rest = line; let key = 0;
  const re = /(\/\/.*$|#.*$)|("[^"]*"|'[^']*'|`[^`]*`)|\b(import|from|const|await|async|function|return|export|new|if|for|of|curl)\b|(\b[a-zA-Z_]\w*(?=\())/;
  while (rest.length) {
    const m = rest.match(re);
    if (!m) { out.push(rest); break; }
    if (m.index) out.push(rest.slice(0, m.index));
    const cls = m[1] ? "cm" : m[2] ? "s" : m[3] ? "k" : "f";
    out.push(<span key={key++} className={cls}>{m[0]}</span>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}
export function Editor({ file, lang = "TypeScript", code, className = "" }) {
  const lines = code.split("\n");
  return (
    <div className={"editor " + className}>
      <div className="editor-bar"><i /><i /><i /><span>{file}</span></div>
      <div className="editor-tab"><em>{lang === "TypeScript" ? "TS" : lang === "Shell" ? "SH" : "JSON"}</em>{file}</div>
      <pre>{lines.map((l, i) => <div className="ln" key={i}><span>{i + 1}</span><span>{hl(l)}</span></div>)}</pre>
      <div className="editor-foot"><span>{lang}</span><span>UTF-8</span></div>
    </div>
  );
}

/* ---------- Dark call-to-action band ---------- */
export function DarkBand({ title, body, cta, note, glyph = "agent" }) {
  return (
    <section className="darkband">
      <div className="wrap">
        <div className="db-art" aria-hidden="true">
          <div className="db-sheet"><i /><i /><i /><i /></div>
          <div className="db-sheet db-glyph"><Glyph name={glyph} size={40} /><i style={{ width: "70%" }} /><i /><i className="r" /></div>
        </div>
        <div><h3>{title}</h3><p>{body}</p></div>
        <div className="darkband-cta"><a href={"#" + cta[1]} className="btn btn-lg btn-light">{cta[0]}</a>{note && <span>{note}</span>}</div>
      </div>
    </section>
  );
}
