// Spend by agent over the last 30 days: ranked, with its mode, its share, credits, cost and a 12-week strip.
// Choosing a row filters the heatmap to that agent.
import React from "react";
import { useStore } from "../core.jsx";
import * as q from "../demo/selectors";
import { pounds } from "../demo/format";
import { modeLabel } from "../../../../../packages/core/credits";

export function SpendByAgent({ agentId, onAgent }) {
  const s = useStore();
  const rows = q.spendByAgent(s, 30);
  const top = Math.max(1, ...rows.flatMap((r) => r.weekly));
  return (
    <section className="w-card" aria-labelledby="w-sba-h">
      <h2 className="w-h3" id="w-sba-h">Spend by agent</h2>
      <p className="w-sub">Last 30 days. Choose one to see its year above</p>
      <ol className="w-sba">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="w-sba-r" aria-pressed={agentId === r.id} onClick={() => onAgent(agentId === r.id ? null : r.id)}>
              <span className="w-sba-n"><b>{r.name}</b><small className="muted">{r.role} · {modeLabel(r.mode)}</small></span>
              <span className="w-sba-bar" aria-hidden="true"><i style={{ width: `${r.share * 100}%` }} /></span>
              <span className="w-sba-v tnum"><b>{Math.round(r.credits).toLocaleString("en-GB")}</b><small className="muted">{Math.round(r.share * 100)}% · {pounds(r.cost)}</small></span>
              <span className="w-sba-w" role="img" aria-label={`Last 12 weeks: ${r.weekly.map((x) => Math.round(x)).join(", ")} credits`}>{r.weekly.map((x, i) => <i key={i} style={{ height: `${Math.max(2, (x / top) * 100)}%` }} />)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
