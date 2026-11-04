// This month on the plan: used against the allowance with where the month is heading, Deep against Standard, and
// each agent's budget. Plans and prices come from the pricing config; a top-up or plan change can be undone.
import React from "react";
import { toast, useStore } from "../core.jsx";
import { Button } from "../ui.jsx";
import { setPlan, topUp } from "../demo/store";
import * as q from "../demo/selectors";
import { pounds, ukDate } from "../demo/format";
import { PLAN_CREDITS } from "../../../../../config/model-pricing.ts";

const n = (x) => Math.round(x).toLocaleString("en-GB");
export function PlanCard() {
  const s = useStore();
  const p = q.planStatus(s), modes = q.modeShare(s, 30);
  const pct = (x) => Math.min(100, (x / Math.max(1, p.allowance)) * 100);
  return (
    <section className="w-card w-plan" aria-labelledby="w-plan-h">
      <div className="w-row w-row-sp"><h2 className="w-h3" id="w-plan-h">{p.name} plan</h2><small className="muted">Resets {ukDate(p.resetOn)}</small></div>
      <div className="w-meter-l"><b className="tnum">{n(p.used)}</b><span className="muted"> of {n(p.allowance)} credits used this month</span></div>
      <div className="w-meter" role="img" aria-label={`${n(p.used)} of ${n(p.allowance)} credits used; on course for ${n(p.projected)} by the end of the month`}>
        <i style={{ width: pct(p.used) + "%" }} />
        <b className="w-meter-proj" style={{ left: pct(p.projected) + "%" }} />
      </div>
      <p className="w-sub">{n(p.planCredits)} plan credits{p.topup ? ` and ${n(p.topup)} top-up credits, which roll over` : ""}. On course for {n(p.projected)} by the {new Date(p.resetOn).getUTCDate() === 1 ? "end of the month" : "reset"}.</p>
      <h3 className="w-plan-s">Deep against Standard, last 30 days</h3>
      {[["creditShare", "Credits"], ["actionShare", "Actions"]].map(([k, l]) => (
        <div key={k} className="w-share">
          <span className="muted">{l}</span>
          <span className="w-share-bar" role="img" aria-label={modes.map((m) => `${m.name} ${Math.round(m[k] * 100)}%`).join(", ")}>{modes.map((m) => <i key={m.mode} className={"is-" + m.mode} style={{ width: m[k] * 100 + "%" }} />)}</span>
        </div>
      ))}
      <ul className="w-legend">{modes.map((m) => <li key={m.mode}><i className={"w-sw is-" + m.mode} />{m.name} <span className="tnum muted">{Math.round(m.creditShare * 100)}% of credits, {Math.round(m.actionShare * 100)}% of actions</span></li>)}</ul>
      <h3 className="w-plan-s">Budgets</h3>
      {p.budgets.length ? p.budgets.map((b) => <p key={b.id} className="tnum">{b.name}: {n(b.used)} of {n(b.budget)} credits</p>) : <p className="w-sub">No agent has a monthly budget. Set one on the agent's page.</p>}
      <div className="w-row" style={{ marginTop: 16 }}>
        <Button size="sm" icon="Plus" onClick={() => { const tok = topUp(); toast(`Added ${n(p.topupOffer.credits)} credits for ${pounds(p.topupOffer.pence)}. They roll over.`, { undo: tok }); }}>Top up {n(p.topupOffer.credits)} for {pounds(p.topupOffer.pence)}</Button>
        <label className="w-field-inline"><span>Plan</span>
          <select className="w-input" value={p.plan} onChange={(e) => { const tok = setPlan(e.target.value); if (tok) toast(`Plan changed to ${q.planName(e.target.value)}.`, { undo: tok }); }}>
            {["starter", "growth", "scale"].map((k) => <option key={k} value={k}>{q.planName(k)}, {n(PLAN_CREDITS[k])} credits a month</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}
