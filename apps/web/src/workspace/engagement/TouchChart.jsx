// Outbound touches a day: one stacked bar a day, by sender (people, agents) or by channel, with a marker above the
// days that had a double contact or a held send. Hover or arrow keys show the day; there's a table view for every bar.
import React, { useState } from "react";
import { Icon, useStore } from "../core.jsx";
import { Button, SegmentedControl } from "../ui.jsx";
import * as q from "../demo/selectors";

const LABEL = { person: "People", agent: "Agents", ...Object.fromEntries(q.CHANNELS.map((c) => [c.key, c.label])) };
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function TouchChart({ days = 30 }) {
  const s = useStore();
  const [by, setBy] = useState("sender");
  const [hi, setHi] = useState(null);
  const [table, setTable] = useState(false);
  const c = q.touchesPerDay(s, days, by);
  const top = Math.max(4, Math.ceil(c.max / 4) * 4);
  const ticks = [top, top / 2, 0];
  const key = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setHi((i) => Math.max(0, Math.min(days - 1, (i ?? days) + (e.key === "ArrowRight" ? 1 : -1)))); }
    else if (e.key === "Escape") setHi(null);
  };
  const d = hi != null ? c.days[hi] : null;
  return (
    <div className="w-card w-tc">
      <div className="w-row w-row-sp">
        <div><h2 className="w-h3" id="w-tc-h">Outbound touches a day</h2><p className="w-sub">Last {days} days, from everyone on the team</p></div>
        <div className="w-row">
          <SegmentedControl label="Split the bars" value={by} onChange={setBy} options={[["sender", "By sender"], ["channel", "By channel"]]} />
          <Button size="sm" variant="ghost" icon={table ? "LayoutGrid" : "List"} onClick={() => setTable(!table)} aria-pressed={table}>{table ? "Show chart" : "Show table"}</Button>
        </div>
      </div>
      <ul className="w-legend" aria-label="Legend">
        {c.keys.map((k) => <li key={k}><i className={"w-sw is-" + k} />{LABEL[k]}</li>)}
        <li><Icon name="AlertTriangle" size={13} className="w-mk-double" />Double contact</li>
        <li><Icon name="ShieldCheck" size={13} className="w-mk-held" />Held or blocked</li>
      </ul>
      {table ? (
        <div className="w-table-wrap" style={{ maxHeight: 320 }}>
          <table className="w-table w-table-plain">
            <caption className="sr-only">Outbound touches a day</caption>
            <thead><tr><th>Day</th>{c.keys.map((k) => <th key={k} className="num">{LABEL[k]}</th>)}<th className="num">Total</th><th className="num">Double</th><th className="num">Held</th></tr></thead>
            <tbody>{c.days.slice().reverse().map((x) => <tr key={x.day}><td>{day(x.at)}</td>{c.keys.map((k) => <td key={k} className="num">{x.parts[k]}</td>)}<td className="num">{x.total}</td><td className="num">{x.double}</td><td className="num">{x.held}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="w-tc-plot" tabIndex={0} role="group" aria-labelledby="w-tc-h" aria-describedby="w-tc-help" onKeyDown={key} onMouseLeave={() => setHi(null)} onBlur={() => setHi(null)}>
          <span id="w-tc-help" className="sr-only">Use the left and right arrow keys to read each day.</span>
          <div className="w-tc-axis" aria-hidden="true">{ticks.map((t) => <span key={t} className="tnum">{t}</span>)}</div>
          <div className="w-tc-bars">
            <div className="w-tc-grid" aria-hidden="true"><i /><i /><i /></div>
            {c.days.map((x, i) => (
              <div key={x.day} className={"w-tc-col" + (hi === i ? " is-hi" : "")} onMouseEnter={() => setHi(i)} aria-hidden="true">
                <div className="w-tc-mk">{x.double > 0 && <Icon name="AlertTriangle" size={12} className="w-mk-double" />}{x.held > 0 && <Icon name="ShieldCheck" size={12} className="w-mk-held" />}</div>
                <div className="w-tc-stack" style={{ height: `${(x.total / top) * 100}%` }}>
                  {c.keys.filter((k) => x.parts[k]).map((k) => <i key={k} className={"is-" + k} style={{ flexGrow: x.parts[k] }} />)}
                </div>
              </div>
            ))}
            {d && (
              <div className="w-tip" role="status" style={{ left: `clamp(0px, calc(${((hi + 0.5) / days) * 100}% - 90px), calc(100% - 180px))` }}>
                <b>{day(d.at)}</b>
                <span className="tnum">{d.total} outbound</span>
                {c.keys.filter((k) => d.parts[k]).map((k) => <span key={k} className="w-tip-r"><i className={"w-sw is-" + k} />{LABEL[k]}<b className="tnum">{d.parts[k]}</b></span>)}
                {d.double > 0 && <span className="w-tip-r"><Icon name="AlertTriangle" size={12} className="w-mk-double" />Double contact<b className="tnum">{d.double}</b></span>}
                {d.held > 0 && <span className="w-tip-r"><Icon name="ShieldCheck" size={12} className="w-mk-held" />Held or blocked<b className="tnum">{d.held}</b></span>}
              </div>
            )}
          </div>
          <div className="w-tc-x" aria-hidden="true"><span>{day(c.days[0].at)}</span><span>{day(c.days[Math.floor(days / 2)].at)}</span><span>Today</span></div>
        </div>
      )}
    </div>
  );
}
