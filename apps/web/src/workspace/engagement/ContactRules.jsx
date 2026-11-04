// The six contact rules: each one on or off, with its value, and how many accounts it's acting on now.
// The same rules the API checks (packages/core/contact.ts). Every change can be undone.
import React from "react";
import { toast, useStore } from "../core.jsx";
import { setContactRule } from "../demo/store";
import * as q from "../demo/selectors";
import { RULE_COPY, RULE_ORDER } from "../../../../../packages/core/contact";

const VALUE = { R1: ["days", "days", 1, 730], R2: ["hours", "hours", 1, 336], R4: ["hours", "hours", 1, 72], R5: ["hours", "hours", 1, 168], R6: ["max", "touches a week", 1, 20] };
const ENFORCE = { R1: "Agents are blocked; people are warned", R2: "Agents are held; people are warned", R3: "Agents are held; people are warned", R4: "Shown in Needs attention when it's due", R5: "Shown in Needs attention when it's due", R6: "Agents are held; people are warned" };

export function ContactRules() {
  const s = useStore();
  const r = s.contactRules;
  return (
    <section className="w-section" aria-labelledby="w-cr-h">
      <div className="w-section-h"><h2 id="w-cr-h">Contact rules</h2><span className="w-sub">Checked before anyone sends, person or agent. Agents can't break them</span></div>
      <ul className="w-crules">
        {RULE_ORDER.map((id) => {
          const v = VALUE[id], on = r[id].on, n = q.ruleImpact(s, id);
          return (
            <li key={id} className={"w-card" + (on ? "" : " is-off")}>
              <div className="w-row">
                <label className="w-switch"><input type="checkbox" role="switch" checked={on} onChange={() => { const tok = setContactRule(id, { on: !on }); toast(`${RULE_COPY[id].name} ${on ? "off" : "on"}.`, { undo: tok }); }} aria-describedby={"cr-" + id} /><span aria-hidden="true" /><b>{RULE_COPY[id].name}</b></label>
                <span className="w-sp" />
                {v && (
                  <label className="w-field-inline"><span className="sr-only">{RULE_COPY[id].name}: </span>
                    <input className="w-input tnum" type="number" min={v[2]} max={v[3]} value={r[id][v[0]]} disabled={!on}
                      onChange={(e) => { const x = Math.max(v[2], Math.min(v[3], Math.round(Number(e.target.value) || v[2]))); setContactRule(id, { [v[0]]: x }); }} />
                    <span>{v[1]}</span>
                  </label>
                )}
              </div>
              <p id={"cr-" + id} className="sec">{RULE_COPY[id].explain(r)}</p>
              <p className="w-sub">{ENFORCE[id]} · {on ? (id === "R3" ? "checked on each new conversation" : `acting on ${n} ${n === 1 ? "account" : "accounts"} now`) : "switched off"}</p>
            </li>
          );
        })}
      </ul>
      <p className="w-sub" style={{ marginTop: 16 }}>When rules disagree, the next step on an account follows this order: do not contact, then confirm acceptances, reply in time, quiet period, and the weekly limit.</p>
    </section>
  );
}
