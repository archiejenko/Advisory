// The single jobs that used the most credits in the last 30 days.
import React from "react";
import { useStore } from "../core.jsx";
import { AgentBadge } from "../ui.jsx";
import * as q from "../demo/selectors";
import { pounds, ukShort, ukTime } from "../demo/format";
import { modeLabel } from "../../../../../packages/core/credits";

export function BiggestRuns() {
  const s = useStore();
  const rows = q.topRuns(s, 30, 5);
  return (
    <section className="w-section" aria-labelledby="w-br-h">
      <div className="w-section-h"><h2 id="w-br-h">Biggest runs</h2><span className="w-sub">The single jobs that used the most credits in the last 30 days</span></div>
      <div className="w-table-wrap">
        <table className="w-table w-table-plain">
          <caption className="sr-only">Biggest runs</caption>
          <thead><tr><th>When</th><th>Agent</th><th>What it did</th><th>Mode</th><th className="num">Credits</th><th className="num">Cost</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td data-label="When" className="tnum">{ukShort(r.at)}, {ukTime(r.at)}</td>
              <td data-label="Agent"><AgentBadge agentId={r.agentId} role={false} /></td>
              <td data-label="What it did">{r.note}</td>
              <td data-label="Mode" className="w-sub">{modeLabel(r.mode)}</td>
              <td data-label="Credits" className="num">{Math.round(r.credits).toLocaleString("en-GB")}</td>
              <td data-label="Cost" className="num">{pounds(r.cost)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
