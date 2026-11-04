// The guard log: every time the contact rules stepped in. Agents' sends held or blocked, people's overrides with
// their reasons, and breaches found in touches logged after the fact. Held sends wait here for Send it or Drop it.
import React, { useState } from "react";
import { Icon, useStore } from "../core.jsx";
import { Avatar, FilterChips, SegmentedControl } from "../ui.jsx";
import * as q from "../demo/selectors";
import { relative, ukShort, ukTime } from "../demo/format";
import { RULE_COPY } from "../../../../../packages/core/contact";
import { ChannelIcon } from "./bits.jsx";
import { DecisionChip, HoldCard } from "./Inspector.jsx";

export function GuardLog({ onOpen }) {
  const s = useStore();
  const [decision, setDecision] = useState("all");
  const [actor, setActor] = useState("all");
  const c = q.guardCounts(s);
  const list = q.guardLog(s, { decision, actor });
  const pending = q.pendingHolds(s);
  return (
    <div>
      {pending.length > 0 && (
        <section className="w-section" aria-labelledby="w-gl-p">
          <div className="w-section-h"><h2 id="w-gl-p">Waiting on you</h2><span className="w-sub">Held sends: send with a reason, or drop</span></div>
          <div className="w-grid w-grid-2">{pending.map((g) => <div key={g.id} className="w-card"><button type="button" className="w-linklike w-cell-main" onClick={() => onOpen(g.account)}>{q.accountName(s, g.account)}</button><HoldCard g={g} /></div>)}</div>
        </section>
      )}
      <section className="w-section" aria-labelledby="w-gl-h">
        <div className="w-section-h"><h2 id="w-gl-h">Every time the rules stepped in</h2></div>
        <div className="w-row w-grid-tools">
          <FilterChips label="Decision" value={decision} onChange={setDecision} options={[["all", "All", c.all], ["held", "Held", c.held], ["blocked", "Blocked", c.blocked], ["overridden", "Overridden", c.overridden], ["breach", "Breaches", c.breach]]} />
          <SegmentedControl label="Who" value={actor} onChange={setActor} options={[["all", "Everyone"], ["agent", "Agents"], ["person", "People"]]} />
        </div>
        <div className="w-table-wrap">
          <table className="w-table">
            <caption className="sr-only">Guard log</caption>
            <thead><tr><th>When</th><th>Account</th><th>Who</th><th>What they tried</th><th>Rule</th><th>Decision</th><th>Outcome</th></tr></thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} tabIndex={0} onClick={(e) => { if (!e.target.closest("a,button")) onOpen(g.account); }} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(g.account); }}>
                  <td data-label="When" className="tnum"><time dateTime={g.at} title={`${ukShort(g.at)} ${ukTime(g.at)}`}>{relative(g.at, s.now > g.at ? s.now : undefined)}</time></td>
                  <td data-label="Account"><span className="w-cell-main">{q.accountName(s, g.account)}</span></td>
                  <td data-label="Who"><span className="w-row" style={{ gap: 8, flexWrap: "nowrap" }}><Avatar actor={g.actor} />{q.actorName(s, g.actor)}</span></td>
                  <td data-label="Tried"><span className="w-row" style={{ gap: 6, flexWrap: "nowrap" }}><ChannelIcon channel={g.channel} /><span>{g.attempted}</span></span></td>
                  <td data-label="Rule"><span className="w-cell-main">{RULE_COPY[g.ruleId].name}</span><span className="w-cell-sub">{g.reason}</span></td>
                  <td data-label="Decision"><DecisionChip d={g.decision} />{g.pending && <span className="w-cell-sub">Waiting</span>}</td>
                  <td data-label="Outcome" className="w-sub">{g.pending ? "Waiting for a decision" : g.outcome || "Not sent"}{g.decidedBy ? ` · ${q.person(s, g.decidedBy)?.name || ""}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <div className="w-table-state"><p className="w-sub">Nothing here for that filter.</p></div>}
        </div>
      </section>
    </div>
  );
}
