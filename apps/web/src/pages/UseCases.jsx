// Every job an agent could do for a small business, scored for owners, developers and other agents,
// with what works today. Sector and skill agnostic: the same list serves every kind of business.
import React, { useMemo, useState } from "react";
import { Link } from "../router.jsx";
import { Page, PageHead, Section, SectionHead, CtaBand } from "../ui.jsx";
import { USE_CASES, PRIMITIVES, SECTOR_PACKS } from "../../../../packages/core/usecases.ts";

const LENSES = [["reach", "Everyone"], ["owner", "Owners"], ["dev", "Developers"], ["agent", "Agents"]];
const TODAY = ["Live", "Partial", "Not yet"];
const FUNCS = [...new Set(USE_CASES.map((u) => u.function))];
const ST = { Live: "st-done", Partial: "st-running", "Not yet": "st-paused" };
const Dots = ({ n, label }) => <span className="uc-dots" title={`${label}: ${n} of 5`} aria-label={`${label}: ${n} of 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? "on" : ""} />)}</span>;

export default function UseCases() {
  const [lens, setLens] = useState("reach");
  const [fn, setFn] = useState("All");
  const [today, setToday] = useState("All");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return USE_CASES
      .filter((u) => (fn === "All" || u.function === fn) && (today === "All" || u.today === today) && (!t || `${u.use_case} ${u.what} ${u.primitives} ${u.needs}`.toLowerCase().includes(t)))
      .sort((a, b) => b[lens] - a[lens] || b.reach - a.reach);
  }, [lens, fn, today, q]);
  const count = (s) => USE_CASES.filter((u) => u.today === s).length;
  return (
    <Page title="Use cases">
      <PageHead crumbs={[["Use cases"]]} label="Use cases" title={`${USE_CASES.length} jobs an agent can do for a small business`}
        lede={`Scored 1 to 5 for small-business owners, developers and other agents, and marked honestly: ${count("Live")} work today, ${count("Partial")} partly, ${count("Not yet")} not yet. Any sector: every job is built from the same twelve building blocks.`} />
      <Section tight>
        <div className="uc-controls">
          <div className="uc-row uc-scroll"><span className="dt">Rank for</span>{LENSES.map(([k, t]) => <button key={k} className={"seg-btn" + (lens === k ? " is-on" : "")} aria-pressed={lens === k} onClick={() => setLens(k)}>{t}</button>)}</div>
          <div className="uc-row uc-scroll"><span className="dt">Job</span>{["All", ...FUNCS].map((f) => <button key={f} className={"seg-btn seg-s" + (fn === f ? " is-on" : "")} aria-pressed={fn === f} onClick={() => setFn(f)}>{f}</button>)}</div>
          <div className="uc-row">
            <span className="dt">Today</span>{["All", ...TODAY].map((f) => <button key={f} className={"seg-btn seg-s" + (today === f ? " is-on" : "")} aria-pressed={today === f} onClick={() => setToday(f)}>{f}</button>)}
            <label className="sr-only" htmlFor="uc-q">Search use cases</label>
            <input id="uc-q" className="uc-q" type="search" placeholder="Search: booking, invoice, WhatsApp…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <p className="dt" aria-live="polite">{rows.length} of {USE_CASES.length} shown</p>
        </div>
        <div className="uc-table-box">
          <table className="ledger ws-table uc-table">
            <thead><tr><th>#</th><th>Job</th><th className="hide-sm">Built from</th><th>Owners</th><th>Developers</th><th>Agents</th><th>Today</th><th className="hide-sm">Needs</th></tr></thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id}>
                  <td className="muted mono uc-n">{i + 1}</td>
                  <td className="uc-job"><b>{u.use_case}</b><br /><span className="muted">{u.what}</span><br /><span className="dt">{u.function}</span></td>
                  <td className="hide-sm"><span className="uc-prims">{u.primitives ? u.primitives.split(",").map((p) => <i key={p}>{p.trim()}</i>) : <i>Marketplace</i>}</span></td>
                  <td className="uc-meta" data-l="Owners"><Dots n={u.owner} label="Owners" /></td>
                  <td className="uc-meta" data-l="Devs"><Dots n={u.dev} label="Developers" /></td>
                  <td className="uc-meta" data-l="Agents"><Dots n={u.agent} label="Agents" /></td>
                  <td className="uc-meta"><span className={"st " + ST[u.today]}>{u.today}</span></td>
                  <td className="hide-sm muted">{u.needs || "Nothing more"}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="muted">Nothing matches. Clear a filter or the search.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="source">Owners: how often the job comes up, the time it takes, how willing owners are to hand it over, and how many kinds of business have it. Developers: whether a builder would call it from their own product. Agents: whether another agent would pay per call for it. Everyone = half owners, a quarter each for developers and agents.</p>
      </Section>
      <Section stone>
        <SectionHead label="Any sector" title="Twelve building blocks, every job" lede="A dental practice and a plumber both need Schedule, Converse and Chase. An accountant and a recruiter both need Find, Verify and Write. We build each block once and every sector gets it." more={["See teams by sector", "/?s=sectors"]} />
        <div className="prims">{PRIMITIVES.map((p) => <div key={p.key} className={"prim prim-" + p.status}><b>{p.label}</b><span>{p.note}</span><i className={"st " + (p.status === "live" ? "st-done" : p.status === "partly" ? "st-running" : "st-paused")}>{p.status === "live" ? "Live" : p.status === "partly" ? "Live, growing" : "Coming"}</i></div>)}</div>
        <p className="more" style={{ marginTop: 32 }}>Teams ready for {SECTOR_PACKS.map((p) => p.name.toLowerCase()).join(", ")}, and any business you describe. <Link to="/start" className="link">Start free</Link></p>
      </Section>
      <CtaBand />
    </Page>
  );
}

/** The top use cases for one kind of user, with what works today. Used on the developer and agent pages. */
export function LensTable({ lens, n = 8, label }) {
  const rows = [...USE_CASES].sort((a, b) => b[lens] - a[lens] || b.reach - a.reach).slice(0, n);
  return (
    <div className="uc-table-box">
      <table className="ledger ws-table uc-table">
        <thead><tr><th>#</th><th>Job</th><th className="hide-sm">Built from</th><th>{label}</th><th>Today</th></tr></thead>
        <tbody>{rows.map((u, i) => (
          <tr key={u.id}>
            <td className="muted mono uc-n">{i + 1}</td>
            <td className="uc-job"><b>{u.use_case}</b><br /><span className="muted">{u.what}</span></td>
            <td className="hide-sm"><span className="uc-prims">{u.primitives ? u.primitives.split(",").map((p) => <i key={p}>{p.trim()}</i>) : <i>Marketplace</i>}</span></td>
            <td className="uc-meta" data-l={label}><Dots n={u[lens]} label={label} /></td>
            <td className="uc-meta"><span className={"st " + ST[u.today]}>{u.today}</span>{u.today !== "Live" && u.needs && <><br /><span className="dt">Needs {u.needs.toLowerCase()}</span></>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
