// One account, inspected: where it stands under the contact rules and what to do next, each rule's result, who
// contacted them and when (one lane per person or agent), everything that happened, and the details.
import React, { useState } from "react";
import { Icon, hrefFor, toast, useStore } from "../core.jsx";
import { ActorName, Avatar, Button, SegmentedControl, StatusChip } from "../ui.jsx";
import { confirmAcceptance, dropHeld, sendHeld } from "../demo/store";
import * as q from "../demo/selectors";
import { relative, ukShort, ukTime } from "../demo/format";
import { RULE_COPY, VERDICT_COPY } from "../../../../../packages/core/contact";
import { ChannelIcon, PresenceDots, SequenceChip, VerdictChip } from "./bits.jsx";
import { draftToast } from "./Held.jsx";

const when = (s, iso) => relative(iso, s.now > iso ? s.now : undefined);

export function Inspector({ refTo, onClose, onLog, docked }) {
  const s = useStore();
  const a = q.accountOf(s, refTo);
  if (!a) return null;
  const e = q.verdictFor(s, refTo), d = q.accountDetails(s, refTo);
  return (
    <div className="w-insp">
      <div className="w-insp-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="w-insp-title">{a.name}</h2>
          <p className="w-sub">{d.kind}{"status" in a ? ` · ${a.status === "lead" ? "Lead" : a.status === "customer" ? "Customer" : "Lost"}` : ` · ${a.category}`} · owned by {a.owner ? q.actorName(s, a.owner) : "nobody"}</p>
          <PresenceDots list={q.presenceOn(s, refTo)} verbose />
        </div>
        <Button size="sm" icon="Plus" onClick={() => onLog({})} aria-keyshortcuts="L">Log a touch</Button>
        {docked !== "page" && <Button variant="ghost" icon="X" onClick={onClose} aria-label="Close the account" />}
      </div>
      <VerdictCard refTo={refTo} e={e} onLog={onLog} />
      <Holds refTo={refTo} />
      <RuleCheck e={e} />
      <Waterfall refTo={refTo} />
      <Feed refTo={refTo} />
      <Details refTo={refTo} d={d} />
    </div>
  );
}

function VerdictCard({ refTo, e, onLog }) {
  const s = useStore();
  const last = q.touchesFor(s, refTo).find((t) => t.direction === "out");
  const r2 = e.rules.find((x) => x.id === "R2");
  const say = {
    dnc: `Nobody contacts them ${q.dueText(s, e.dueAt, "until")}. Agents skip them; anyone who logs a call is warned.`,
    confirm: `${e.rules.find((x) => x.id === "R4").detail}. Confirm it ${q.isOverdueAt(s, e.dueAt) ? "now: it's " + q.dueText(s, e.dueAt) : q.dueText(s, e.dueAt).replace("due ", "")}.`,
    reply: `Their message is waiting. Reply ${q.isOverdueAt(s, e.dueAt) ? "now: it's " + q.dueText(s, e.dueAt) : q.dueText(s, e.dueAt).replace("due ", "")}.`,
    quiet: `${last ? q.actorName(s, last.actor) + " contacted them " + when(s, last.at) : "Someone contacted them"}. Everyone else waits ${q.dueText(s, r2.dueAt, "until")} unless they reply.`,
    capped: `They've had ${e.rules.find((x) => x.id === "R6").detail.split(" in ")[0]} this week. Wait ${q.dueText(s, e.dueAt, "until")}.`,
    clear: "Nothing is due, and no rule stops a message.",
  }[e.verdict];
  const action = e.verdict === "confirm" ? <Button variant="primary" size="sm" icon="Send" onClick={() => draftToast(confirmAcceptance(refTo), "Theo drafted the confirmation. It's on Home for your OK.")}>Ask Theo to confirm</Button>
    : e.verdict === "reply" ? <Button variant="primary" size="sm" icon="Send" onClick={() => onLog({ direction: "out" })}>Log your reply</Button>
    : null;
  return (
    <section className={"w-vcard is-" + e.verdict} aria-label="Next step">
      <div className="w-row"><VerdictChip verdict={e.verdict} dueAt={e.dueAt} /><span className="w-sp" />{action}</div>
      <h3>{VERDICT_COPY[e.verdict].next}</h3>
      <p>{say}</p>
    </section>
  );
}

/** A held send waiting on a person: send it with a reason, or drop it. */
export function HoldCard({ g }) {
  const s = useStore();
  const [why, setWhy] = useState("");
  const [open, setOpen] = useState(false);
  const send = () => { const tok = sendHeld(g.id, why); if (tok) toast(`Sent, with your reason logged: ${g.attempted}`, { undo: tok }); };
  return (
    <div className="w-hold">
      <div className="w-row"><Icon name="ShieldCheck" size={16} className="w-mk-held" /><b>{q.actorName(s, g.actor)}'s {g.channel === "whatsapp" ? "WhatsApp" : g.channel} is held</b><span className="w-sp" /><small className="muted">{when(s, g.at)}</small></div>
      <p className="w-hold-t">“{g.attempted}”</p>
      <p className="w-sub">{RULE_COPY[g.ruleId].name}: {g.reason}</p>
      {open ? (
        <div className="w-field" style={{ marginTop: 8 }}>
          <label htmlFor={"why-" + g.id}>Why send it anyway? This goes in the guard log</label>
          <textarea id={"why-" + g.id} className="w-input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} data-autofocus />
          <div className="w-row"><Button size="sm" variant="primary" icon="Send" disabled={!why.trim()} onClick={send}>Send it</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="w-row" style={{ marginTop: 8 }}>
          <Button size="sm" variant="primary" icon="Send" onClick={() => setOpen(true)}>Send it</Button>
          <Button size="sm" icon="X" onClick={() => { const tok = dropHeld(g.id); toast(`Dropped. Nothing was sent to ${q.accountName(s, g.account)}.`, { undo: tok }); }}>Drop it</Button>
        </div>
      )}
    </div>
  );
}
function Holds({ refTo }) {
  const s = useStore();
  const list = q.holdsFor(s, refTo);
  return list.length ? <section aria-label="Held messages" className="w-insp-s">{list.map((g) => <HoldCard key={g.id} g={g} />)}</section> : null;
}

const STATE = { pass: ["CircleCheck", "Passes"], active: ["Clock", "In force"], fail: ["AlertTriangle", "Broken or overdue"], off: ["Circle", "Switched off"] };
function RuleCheck({ e }) {
  const s = useStore();
  return (
    <section className="w-insp-s" aria-labelledby="w-rc-h">
      <h3 id="w-rc-h">Rule by rule</h3>
      <ul className="w-rules">
        {e.rules.map((r) => (
          <li key={r.id} className={"is-" + r.state}>
            <Icon name={STATE[r.state][0]} size={16} /><span className="sr-only">{STATE[r.state][1]}:</span>
            <span><b>{RULE_COPY[r.id].name}</b><small>{r.detail}{r.dueAt && r.state !== "pass" ? ` · ${r.id === "R4" || r.id === "R5" ? q.dueText(s, r.dueAt) : q.dueText(s, r.dueAt, "until")}` : ""}</small></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Waterfall({ refTo }) {
  const s = useStore();
  const w = q.waterfall(s, refTo, 14);
  const pos = (iso) => `${Math.max(0, Math.min(100, ((Date.parse(iso) - w.from) / (w.to - w.from)) * 100))}%`;
  return (
    <section className="w-insp-s" aria-labelledby="w-wf-h">
      <h3 id="w-wf-h">Who contacted them, last 14 days</h3>
      {!w.lanes.length ? <p className="w-sub">Nobody has, in the last 14 days.</p> : (
        <div className="w-wf">
          {w.lanes.map((l) => (
            <div key={l.key} className="w-wf-l">
              <span className="w-wf-n">{l.actor ? <Avatar actor={l.actor} /> : <span className="w-avatar w-avatar-them" aria-hidden="true"><Icon name="Building2" size={14} /></span>}<span>{l.key === "them" ? "Them" : l.label}</span></span>
              <span className="w-wf-t" role="img" aria-label={`${l.key === "them" ? "From them" : l.label}: ${l.touches.length} ${l.touches.length === 1 ? "touch" : "touches"}`}>
                {l.touches.map((t) => <i key={t.id} className={"is-" + (t.direction === "in" ? "them" : t.actor?.kind)} style={{ left: pos(t.at) }} title={`${q.channelLabel(t.channel)}, ${ukShort(t.at)} ${ukTime(t.at)}: ${t.text}`} />)}
                {w.held.filter((g) => l.actor && g.actor.kind === l.actor.kind && g.actor.id === l.actor.id).map((g) => <b key={g.id} className="w-wf-held" style={{ left: pos(g.at) }} title={`${g.decision === "held" ? "Held" : "Blocked"}: ${g.attempted}`}><Icon name="ShieldCheck" size={12} /></b>)}
              </span>
            </div>
          ))}
          <div className="w-wf-x" aria-hidden="true"><span>{ukShort(new Date(w.from).toISOString())}</span><span>Now</span></div>
        </div>
      )}
    </section>
  );
}

const DECISION = { held: ["attn", "Held"], blocked: ["risk", "Blocked"], overridden: ["neutral", "Overridden"], breach: ["risk", "Breach"] };
export const DecisionChip = ({ d }) => <StatusChip tone={DECISION[d][0]}>{DECISION[d][1]}</StatusChip>;
function Feed({ refTo }) {
  const s = useStore();
  const [f, setF] = useState("all");
  const items = q.accountFeed(s, refTo, f).slice(0, 30);
  return (
    <section className="w-insp-s" aria-labelledby="w-feed-h">
      <div className="w-row w-row-sp"><h3 id="w-feed-h">Activity</h3><SegmentedControl label="Show" value={f} onChange={setF} options={[["all", "All"], ["messages", "Messages"], ["guard", "Guard"]]} /></div>
      {!items.length ? <p className="w-sub">{f === "guard" ? "The contact rules haven't stepped in here." : "Nothing yet."}</p> : (
        <ul className="w-feed">
          {items.map((it) => it.kind === "touch" ? (
            <li key={it.key}>
              {it.touch.direction === "in" ? <span className="w-avatar w-avatar-them" aria-hidden="true"><Icon name="Building2" size={14} /></span> : <Avatar actor={it.touch.actor} />}
              <div className="w-feed-b">
                <p><b>{it.touch.direction === "in" ? q.accountName(s, refTo) : q.actorName(s, it.touch.actor)}</b> <ChannelIcon channel={it.touch.channel} /> {it.touch.text}</p>
                <div className="w-feed-m w-row">
                  <span>{when(s, it.touch.at)}</span>
                  {it.touch.heardBy && <span>heard by {q.actorName(s, it.touch.heardBy)}</span>}
                  {it.touch.outcome && <StatusChip tone={it.touch.outcome === "accepted" ? "done" : "risk"}>{it.touch.outcome === "accepted" ? "Accepted" : "Declined"}</StatusChip>}
                  {Date.parse(it.touch.loggedAt) - Date.parse(it.touch.at) > 3600e3 && <span>logged {Math.round((Date.parse(it.touch.loggedAt) - Date.parse(it.touch.at)) / 3600e3)} h later</span>}
                </div>
              </div>
            </li>
          ) : it.guard.pending ? <li key={it.key} className="w-feed-hold"><HoldCard g={it.guard} /></li> : (
            <li key={it.key}>
              <span className="w-avatar w-avatar-guard" aria-hidden="true"><Icon name="ShieldCheck" size={14} /></span>
              <div className="w-feed-b">
                <p><DecisionChip d={it.guard.decision} /> <b>{q.actorName(s, it.guard.actor)}</b>: {it.guard.attempted}</p>
                <div className="w-feed-m">{RULE_COPY[it.guard.ruleId].name} · {it.guard.reason}{it.guard.outcome ? ` · ${it.guard.outcome}` : ""} · {when(s, it.guard.at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Details({ refTo, d }) {
  const s = useStore();
  return (
    <section className="w-insp-s" aria-labelledby="w-det-h">
      <h3 id="w-det-h">Details</h3>
      <dl className="w-dl">
        <dt>Owner</dt><dd>{d.owner ? <ActorName actor={d.owner} /> : "Nobody"}</dd>
        <dt>Handed to</dt><dd>{d.handoffTo.length ? d.handoffTo.map((h) => q.actorName(s, h)).join(", ") : "Nobody"}</dd>
        {d.dnc && <><dt>Opted out</dt><dd>{d.dnc.reason}{d.dnc.until ? `, until ${ukShort(d.dnc.until)}` : ""}</dd></>}
        <dt>Contacts</dt><dd>{d.contacts.length ? d.contacts.map((c) => <span key={c.id} className="w-det-c">{c.name}<small className="muted"> · {c.role}{c.phone ? " · " + c.phone : ""}</small></span>) : "None on file"}</dd>
        <dt>Automations</dt><dd>{d.sequences.length ? d.sequences.map((x) => <span key={x.id} className="w-det-c">{q.agent(s, x.agentId)?.name}: {x.name} <small className="muted tnum">step {x.step} of {x.steps}</small> <SequenceChip state={x.state} /></span>) : "None running"}</dd>
        <dt>Touches</dt><dd className="tnum">{d.touches}</dd>
      </dl>
      {refTo.kind === "company" && <Button size="sm" variant="ghost" icon="ExternalLink" to={hrefFor({ type: "company", id: refTo.id }, s)} style={{ marginTop: 12 }}>Open the company record</Button>}
    </section>
  );
}
