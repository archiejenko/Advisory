// A year of AI Team usage, contributions style: 52 weeks, one column a week, Monday to Sunday, one blue in five
// levels binned at the 30th, 60th and 90th percentiles. Days before the workspace joined are greyed. Numbered pins
// mark what changed. Hover, or arrow keys, show the day. On a phone it scrolls on its own, starting at this week.
import React, { useEffect, useRef, useState } from "react";
import { Icon, useStore } from "../core.jsx";
import { SegmentedControl } from "../ui.jsx";
import * as q from "../demo/selectors";
import { pounds } from "../demo/format";

const DAYS = ["Mon", "", "Wed", "", "Fri", "", ""];
const long = (d) => new Date(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const n = (x) => Math.round(x).toLocaleString("en-GB");

export function Heatmap({ agentId, onAgent }) {
  const s = useStore();
  const [metric, setMetric] = useState("credits");
  const [hi, setHi] = useState(null); // [week, day]
  const c = q.usageCalendar(s, { metric, agentId });
  const scroller = useRef(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, []);
  const unit = metric === "credits" ? "credits" : "actions";
  const t = c.thresholds.map((x) => (metric === "credits" ? n(x) : Math.round(x * 10) / 10));
  const cell = hi && c.weeks[hi[0]][hi[1]];
  const day = cell && !cell.before && !cell.future ? q.usageDay(s, cell.day, agentId) : null;
  const pinsOn = cell ? c.pins.filter((p) => cell.pins.includes(p.n)) : [];
  const key = (e) => {
    const mv = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (mv) {
      e.preventDefault();
      setHi(([w, d] = [51, 0]) => {
        let nw = w + mv[0], nd = d + mv[1];
        if (nd > 6) { nd = 0; nw++; } if (nd < 0) { nd = 6; nw--; }
        nw = Math.max(0, Math.min(51, nw));
        if (c.weeks[nw][nd].future) return [w, d];
        return [nw, nd];
      });
    } else if (e.key === "Escape") setHi(null);
  };
  useEffect(() => { if (hi) scroller.current?.querySelector(`[data-c="${hi[0]}-${hi[1]}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [hi]);
  const agent = agentId && q.agent(s, agentId);
  return (
    <section className="w-card w-heat" aria-labelledby="w-heat-h">
      <div className="w-row w-row-sp">
        <div><h2 className="w-h3" id="w-heat-h">{metric === "credits" ? "Credits a day" : "Actions a day"}{agent ? `, ${agent.name}` : ""}</h2>
          <p className="w-sub">{n(c.total)} {unit} in the last year{agent ? "" : ", the whole AI Team"}</p></div>
        <div className="w-row">
          <label className="w-field-inline"><span>Agent</span>
            <select className="w-input" value={agentId || ""} onChange={(e) => onAgent(e.target.value || null)}>
              <option value="">Every agent</option>{s.agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.roleName}</option>)}
            </select>
          </label>
          <SegmentedControl label="Show" value={metric} onChange={setMetric} options={[["credits", "Credits"], ["actions", "Actions"]]} />
        </div>
      </div>
      <div className="w-heat-wrap" ref={scroller}>
        <div className="w-heat-plot" tabIndex={0} role="group" aria-labelledby="w-heat-h" aria-describedby="w-heat-help" onKeyDown={key} onMouseLeave={() => setHi(null)} onBlur={() => setHi(null)}
          onFocus={() => { if (!hi) { const w = 51, d = c.weeks[51].findLastIndex((x) => !x.future); setHi([w, Math.max(0, d)]); } }}>
          <span id="w-heat-help" className="sr-only">Use the arrow keys to read each day.</span>
          <div className="w-heat-pins" aria-hidden="true">
            {c.weeks.map((w, i) => { const p = w.flatMap((x) => x.pins); return <span key={i}>{p.length ? <b>{p.join(",")}</b> : null}</span>; })}
          </div>
          <div className="w-heat-months" aria-hidden="true">{c.weeks.map((_, i) => <span key={i}>{c.months.find((m) => m.col === i)?.label || ""}</span>)}</div>
          <div className="w-heat-grid">
            <div className="w-heat-days" aria-hidden="true">{DAYS.map((d, i) => <span key={i}>{d}</span>)}</div>
            {c.weeks.map((w, wi) => (
              <div key={wi} className="w-heat-col">
                {w.map((x, di) => (
                  <i key={x.day} data-c={`${wi}-${di}`} className={"l" + x.level + (x.before ? " is-before" : "") + (x.future ? " is-future" : "") + (x.pins.length ? " has-pin" : "") + (hi && hi[0] === wi && hi[1] === di ? " is-hi" : "")}
                    onMouseEnter={() => !x.future && setHi([wi, di])} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {cell && !cell.future && (
        <div className="w-heat-tip" role="status">
          <b>{long(cell.day)}</b>
          {cell.before ? <span className="w-sub">Before the workspace started</span> : day && (
            <>
              <span className="tnum">{n(day.credits)} credits · {day.actions} {day.actions === 1 ? "action" : "actions"} · {pounds(day.cost)}</span>
              {day.byAgent.length > 0 && <span className="w-heat-split">{day.byAgent.map((a) => <span key={a.id}>{a.name} <b className="tnum">{n(a.credits)}</b></span>)}</span>}
              {day.bigRun && <span className="w-heat-big"><Icon name="Zap" size={13} />Big run: {day.bigRun.agent}, {day.bigRun.note.toLowerCase()}, {n(day.bigRun.credits)} credits</span>}
            </>
          )}
          {pinsOn.map((p) => <span key={p.n} className="w-heat-pinl"><b>{p.n}</b>{p.label}</span>)}
        </div>
      )}
      <div className="w-row w-row-sp w-heat-foot">
        <div className="w-heat-key" aria-label={`Less to more: none, up to ${t[0]}, up to ${t[1]}, up to ${t[2]}, over ${t[2]} ${unit} a day`}>
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((l) => <i key={l} className={"l" + l} title={["None", `Up to ${t[0]}`, `${t[0]} to ${t[1]}`, `${t[1]} to ${t[2]}`, `Over ${t[2]}`][l] + " " + unit} />)}
          <span>More</span>
          <small className="tnum" aria-hidden="true">{t[0]} · {t[1]} · {t[2]} {unit}</small>
          <span className="w-heat-before" title="Before the workspace started"><i className="is-before" />Before you joined</span>
        </div>
        <ol className="w-heat-pinlist" aria-label="What changed">
          {c.pins.map((p) => <li key={p.n}><b>{p.n}</b>{p.label}<small className="muted"> · {new Date(p.day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</small></li>)}
        </ol>
      </div>
    </section>
  );
}
