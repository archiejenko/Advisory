import React, { useEffect, useState } from "react";
import { Link } from "./router.jsx";
import { DISTRICTS, DEFAULT_DISTRICTS, WEEKS } from "./data.js";

export const reduced = () =>
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const gbp = (n) => "£" + Math.round(n).toLocaleString("en-GB");
export const gbp2 = (n) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longDate = (d) => `${Number(d.slice(8, 10))} ${LONG[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Page structure ---------- */
export function Page({ title, children }) {
  return <div data-page-title={title}>{children}</div>;
}

export function PageHead({ crumbs = [], label, title, lede, actions, children }) {
  return (
    <header className="page-head">
      <div className="wrap">
        {crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              <li><Link to="/">Home</Link></li>
              {crumbs.map(([t, to]) => <li key={t}>{to ? <Link to={to}>{t}</Link> : <span aria-current="page">{t}</span>}</li>)}
            </ol>
          </nav>
        )}
        <div className="ph-center">
          {label && <p className="label">{label}</p>}
          <h1 className="h-page">{title}</h1>
          {lede && <p className="page-lede">{lede}</p>}
          {actions && <div className="actions">{actions}</div>}
        </div>
        {children}
      </div>
    </header>
  );
}

export function SectionHead({ label, title, lede, id, more }) {
  return (
    <div className="grid sec-head">
      <div className="col-4"><p className="label">{label}</p><h2 id={id}>{title}</h2></div>
      {(lede || more) && (
        <div className="col-7 col-start-6">
          {lede && <p className="body-l">{lede}</p>}
          {more && <p className="more"><Link to={more[1]} className="link">{more[0]}</Link></p>}
        </div>
      )}
    </div>
  );
}

export function Section({ id, stone, children, tight }) {
  return <section id={id} className={"band" + (stone ? " band-stone" : "") + (tight ? " band-tight" : "")}><div className="wrap">{children}</div></section>;
}

export function NextPrev({ prev, next }) {
  return (
    <nav className="nextprev" aria-label="More pages">
      <div className="wrap grid">
        <div className="col-6">{prev && <Link to={prev[1]} className="np"><span className="dt">Previous</span><b>{prev[0]}</b></Link>}</div>
        <div className="col-6 np-r">{next && <Link to={next[1]} className="np"><span className="dt">Next</span><b>{next[0]}</b></Link>}</div>
      </div>
    </nav>
  );
}

export function CtaBand({ title = "Put your team to work today.", body = "Fourteen days free with six agents and an orchestrator to lead them. Nothing is sent without your approval, and nothing is charged when the trial ends." }) {
  return (
    <section className="close">
      <div className="wrap grid">
        <h2 className="col-8 close-h">{title}</h2>
        <div className="col-4 close-side">
          <p className="body-l">{body}</p>
          <div className="actions">
            <Link to="/start" className="btn">Start free</Link>
            <Link to="/book-a-call" className="link">Book a 20-minute call</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SpecTable({ rows, head, wide }) {
  return (
    <table className={"std" + (wide ? "" : " std-compact")}>
      {head && <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>}
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            <th scope="row">{r[0]}</th>
            {r.slice(1).map((c, i) => <td key={i}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function QA({ items }) {
  return <dl className="faq">{items.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>;
}

export function Range({ id, label, value, min, max, step, onChange, fmt }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="range">
      <label htmlFor={id}><span>{label}</span><output htmlFor={id}>{fmt(value)}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} style={{ "--p": p + "%" }} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

export function Severity({ s }) {
  return <span className={"sev" + (s === "Critical" ? " sev-crit" : s === "Review" ? " sev-rev" : "")}>{s}</span>;
}

/* ---------- Visual: company brief ---------- */
export function Brief({ sample, onPick, busy }) {
  const s = sample;
  const meta = <div className="sheet-meta"><span>Prepared for {s.preparedFor || "Northgate IT Services"}</span><span>{s.at || "20 October 2026, 09:12"}</span></div>;
  if (s.outcome === "confirm") {
    return (
      <div className="sheet">
        <div className="sheet-head">
          <div><p className="sheet-kind">Company brief</p><p className="sheet-co">{s.input}</p></div>
          {meta}
        </div>
        <div className="sheet-sum sheet-sum-flag"><span className="dt">Needs your confirmation</span><span><b>{s.confidence}</b> {s.candidates.length ? "Choose the right company and the brief completes." : ""}</span></div>
        {s.candidates.length > 0 && (
          <table className="sheet-tab sheet-cands">
            <thead><tr><th>Candidate</th><th>Company no.</th><th>Status</th><th>{onPick ? "" : "Registered"}</th></tr></thead>
            <tbody>{s.candidates.map((c) => (
              <tr key={c[1]}>
                <td>{c[0]}</td><td className="mono">{c[1]}</td><td>{c[2]}</td>
                <td>{onPick ? <button className="btn btn-line btn-sm" disabled={busy} onClick={() => onPick(c[1])}>This one</button> : c[3]}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="sheet-sig">Nothing is reported until you confirm the match.</p>
      </div>
    );
  }
  const at = s.retrieved || "20 Oct 2026, 09:12";
  return (
    <div className="sheet">
      <div className="sheet-head">
        <div><p className="sheet-kind">Company brief</p><p className="sheet-co">{s.company}</p></div>
        {meta}
      </div>
      <div className={"sheet-sum" + (s.flags.length ? " sheet-sum-flag" : "")}>
        <span className="dt">Flags</span>
        {s.flags.length ? <span className="signal"><b>{s.flags.length} to review.</b> {s.flags.join("; ")}.</span> : <span><b>None.</b> Active, filings up to date, no insolvency notices.</span>}
      </div>
      <table className="sheet-tab">
        <tbody>
          <tr><th scope="row">Company no.</th><td className="mono">{s.no}</td></tr>
          {s.rows.map(([k, v, n]) => <tr key={k}><th scope="row">{k}</th><td className={/Overdue|unavailable/.test(v) ? "signal" : ""}>{v}<sup>{n}</sup></td></tr>)}
          <tr><th scope="row">Match</th><td>{s.confidence}</td></tr>
        </tbody>
      </table>
      <ol className="sheet-notes">
        <li>Companies House, retrieved {at}</li>
        <li>The Gazette, insolvency notices, retrieved {at}</li>
        <li>FCA Financial Services Register, retrieved {at}</li>
      </ol>
      <p className="sheet-sig mono">Response {s.responseId || "chk_8f2c41"}, signed</p>
    </div>
  );
}

const REASON = { name: "registered name", "company number": "company number in the input" };
const shortTime = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
/** Turn a signed /v1/check (or workspace brief) response into the shape <Brief> draws. */
export function briefFromApi(r, preparedFor) {
  const base = { input: r.input, preparedFor, at: shortTime(r.checked_at || new Date().toISOString()), responseId: r.response_id };
  if (r.status !== "matched") {
    return { ...base, outcome: "confirm", confidence: r.message, candidates: (r.candidates || []).map((c) => [c.name, c.number, c.status, c.postcode || ""]) };
  }
  const reasons = (r.match.reasons || []).map((x) => REASON[x] || x);
  return {
    ...base, outcome: r.flags.length ? "flags" : "clear", company: r.match.name, no: r.match.number,
    confidence: "High" + (reasons.length ? ", matched on " + reasons.join(" and ") : ""),
    flags: r.flags.map((f) => f.text), rows: r.rows, retrieved: shortTime(r.checked_at),
  };
}

/* ---------- Visual: postcode districts ---------- */
export function DistrictGrid({ sel, setSel }) {
  const toggle = (d) => { const s = new Set(sel); s.has(d) ? s.delete(d) : s.add(d); setSel(s); };
  return (
    <div className="districts" role="group" aria-label="Postcode districts">
      {DISTRICTS.map((d) => <button key={d} aria-pressed={sel.has(d)} className={sel.has(d) ? "is-on" : ""} onClick={() => toggle(d)}>{d}</button>)}
    </div>
  );
}
export function useDistricts() { return useState(() => new Set(DEFAULT_DISTRICTS)); }

/* ---------- Visual: weekly bars ---------- */
export function Bars({ data = WEEKS }) {
  const max = Math.max(...data.map((w) => w.n));
  return (
    <svg viewBox="0 0 400 220" className="bars" role="img" aria-label="Alerts by week">
      {[0, Math.round(max / 2), max].map((g) => (
        <g key={g}>
          <line x1="28" x2="400" y1={190 - (g / max) * 160} y2={190 - (g / max) * 160} stroke="var(--rule)" />
          <text x="0" y={194 - (g / max) * 160} className="ax">{g}</text>
        </g>
      ))}
      {data.map((w, i) => {
        const x = 40 + i * 45, h = (w.n / max) * 160;
        return (
          <g key={w.w}>
            <rect x={x} y={190 - h} width="28" height={h} fill={i === data.length - 1 ? "var(--ink)" : "var(--graphite)"} />
            <text x={x + 14} y={190 - h - 6} textAnchor="middle" className="ax ax-v">{w.n}</text>
            <text x={x + 14} y="208" textAnchor="middle" className="ax">{w.w}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Visual: four-step method ---------- */
export function MethodSteps() {
  return (
    <ol className="method">
      <li>
        <span className="m-n">01</span>
        <h3>Describe your business</h3>
        <p>What you do, who you serve, where, and how you write. Type it or say it; two minutes, and every agent reads it first.</p>
        <div className="m-vis">
          <div className="m-sheet">{["Profile", "Office cleaning", "Offices, 10–80 staff", "Manchester, Salford", "Warm, no jargon"].map((r, i) => <div key={r} className={i === 0 ? "m-th" : ""}>{r}</div>)}</div>
        </div>
      </li>
      <li>
        <span className="m-n">02</span>
        <h3>We design the team</h3>
        <p>An orchestrator to lead, and roles under it for your kind of business. You see the cost against your plan before anything starts.</p>
        <div className="m-vis"><ul className="m-regs"><li>Orchestrator</li><li>Prospector · Writer</li><li>Inbox · Credit control</li></ul></div>
      </li>
      <li>
        <span className="m-n">03</span>
        <h3>They work, using real tools</h3>
        <p>The orchestrator turns your goals into tasks. Each role uses its skills: register checks, research, drafting, chasing. Every step is recorded.</p>
        <div className="m-vis">
          <div className="m-bar"><span style={{ width: "86%" }} /><i style={{ width: "14%" }} /></div>
          <div className="m-legend"><span><b>6</b> tool calls</span><span><b className="signal">1</b> draft for you</span></div>
        </div>
      </li>
      <li>
        <span className="m-n">04</span>
        <h3>You approve what goes out</h3>
        <p>Drafts wait on your desk, on your phone, and in Slack, Teams or email. Edit and send, or reject. Replies come back to you.</p>
        <div className="m-vis">
          <div className="m-alert"><b>Email Peel Street Accountants</b><span>Outreach · waiting for you</span><span className="m-src">Approve · Edit · Reject</span></div>
        </div>
      </li>
    </ol>
  );
}

/* ---------- Code ---------- */
export function highlight(code) {
  const out = [];
  const re = /(#[^\n]*)|("[^"\n]*"|'[^'\n]*')/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(<span key={i++}>{code.slice(last, m.index)}</span>);
    out.push(<span key={i++} className={m[1] ? "c-com" : "c-str"}>{m[0]}</span>);
    last = re.lastIndex;
  }
  out.push(<span key={i++}>{code.slice(last)}</span>);
  return out;
}

export function CodePanel({ tabs }) {
  const keys = Object.keys(tabs);
  const [tab, setTab] = useState(keys[0]);
  const [copied, setCopied] = useState(false);
  const cur = keys.includes(tab) ? tab : keys[0];
  const copy = () => { try { navigator.clipboard.writeText(tabs[cur]); } catch (e) {} setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return (
    <div className="code">
      <div className="code-bar">
        <div className="code-tabs" role="tablist">
          {keys.map((k) => <button key={k} role="tab" aria-selected={cur === k} className={cur === k ? "is-on" : ""} onClick={() => setTab(k)}>{k}</button>)}
        </div>
        <button className="code-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre><code>{highlight(tabs[cur])}</code></pre>
    </div>
  );
}
