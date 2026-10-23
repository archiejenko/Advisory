// The public map of the business OS: every app, area by area, with what good looks like, who works it,
// and how far it is built. The same catalogue the workspace runs on.
import React, { useState } from "react";
import { Link, useRoute } from "../router.jsx";
import { Page, PageHead } from "../ui.jsx";
import { Glyph } from "../kit.jsx";
import { AREAS, FACETS } from "../../../../packages/core/os.ts";
import { DepthPill, DEPTH } from "./Os.jsx";

const PHASE = ["", "Win work and get paid", "Finance depth", "People and payroll", "Operations", "Everything else"];

export function OsPage() {
  const { query } = useRoute();
  const [area, setArea] = useState(query.a || "");
  const [depth, setDepth] = useState("");
  const [q, setQ] = useState("");
  const w = q.trim().toLowerCase();
  const list = FACETS.filter((f) => (!area || f.area === area) && (!depth || f.depth === depth) && (!w || [f.name, f.app, f.optimal, f.agent || ""].some((s) => s.toLowerCase().includes(w))));
  const n = (d) => FACETS.filter((f) => f.depth === d).length;
  return (
    <Page title="The business OS">
      <PageHead crumbs={[["The business OS"]]} label="Every app" title="Everything it takes to run a business, in one OS"
        lede={`${FACETS.length} apps across ${AREAS.length} areas, mapped from what a business of 100 people needs to run well. ${n("full")} are fully native today, ${n("partial")} are partly built, and ${n("basic")} start as records with an agent while their full screens are built. Every one is in your workspace from day one.`}
        actions={<><Link to="/workspace/apps" className="btn">Open the demo OS</Link><Link to="/start" className="link">Start free</Link></>} />
      <section className="band band-tight">
        <div className="wrap">
          <div className="os-tools">
            <div className="field os-search"><label htmlFor="osp-q" className="sr">Search apps</label><input id="osp-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: payroll, VAT, rota, contracts…" /></div>
            <div className="field"><label htmlFor="osp-a" className="sr">Area</label><select id="osp-a" value={area} onChange={(e) => setArea(e.target.value)}><option value="">Every area</option>{AREAS.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></div>
            <div className="os-seg" role="group" aria-label="How far built">
              {[["", "All"], ["full", DEPTH.full.label], ["partial", DEPTH.partial.label], ["basic", DEPTH.basic.label]].map(([k, t]) => <button key={k || "all"} className={"os-seg-b" + (depth === k ? " is-on" : "")} aria-pressed={depth === k} onClick={() => setDepth(k)}>{t}</button>)}
            </div>
          </div>
          <p className="dt" aria-live="polite">{list.length} of {FACETS.length} apps</p>
          {AREAS.map((a) => {
            const rows = list.filter((f) => f.area === a.key);
            if (!rows.length) return null;
            return (
              <section key={a.key} className="osp-area" aria-labelledby={"osp-" + a.key}>
                <h2 className="os-area-h" id={"osp-" + a.key}><span className="os-area-g"><Glyph name={a.glyph} size={18} /></span>{a.name}<span className="dt">{rows.length}</span></h2>
                <ul className="osp-list">
                  {rows.map((f) => (
                    <li key={f.key} className="osp-row">
                      <div className="osp-main">
                        <p className="osp-t"><b>{f.app}</b><span className="dt">{f.name}</span><DepthPill depth={f.depth} /></p>
                        <p className="body">{f.optimal}.</p>
                        {f.today && <p className="dt">Today: {f.today}</p>}
                      </div>
                      <dl className="osp-facts">
                        <div><dt>Agent</dt><dd>{f.agent || "People only"}</dd></div>
                        <div><dt>People</dt><dd>{f.people}</dd></div>
                        <div><dt>Together</dt><dd>{f.channel}</dd></div>
                        {f.rules && <div><dt>UK rules</dt><dd>{f.rules}</dd></div>}
                        <div><dt>Built in</dt><dd>Phase {f.phase}: {PHASE[f.phase]}</dd></div>
                      </dl>
                      <Link to={"/workspace/app/" + f.key} className="link link-s osp-open">Open in the demo</Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </Page>
  );
}
