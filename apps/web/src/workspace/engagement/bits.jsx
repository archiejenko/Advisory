// Small pieces the Engagement screens share: the 14-day touch strip, channel icons, who's here now, the verdict and
// sequence chips. Colour only where it means something: blue is an agent, orange a person, grey is them.
import React from "react";
import { Icon, useStore } from "../core.jsx";
import { Avatar, StatusChip } from "../ui.jsx";
import * as q from "../demo/selectors";
import { VERDICT_COPY } from "../../../../../packages/core/contact";

export const SENDERS = [["agent", "Agents"], ["person", "People"], ["them", "Them"]];
export function ChannelIcon({ channel, size = 14 }) {
  const c = q.CHANNELS.find((x) => x.key === channel);
  return <span className="w-chan" title={c.label}><Icon name={c.icon} size={size} /><span className="sr-only">{c.label}</span></span>;
}

/** One cell a day for the last 14 days; a mark per touch, coloured by who sent it (hollow when it came from them). */
export function TouchStrip({ refTo, days = 14 }) {
  const s = useStore();
  const strip = q.touchStrip(s, refTo, days);
  const all = strip.flatMap((d) => d.touches);
  const label = `Last ${days} days: ${all.length} ${all.length === 1 ? "touch" : "touches"}, ${all.filter((t) => t.sender === "agent").length} from agents, ${all.filter((t) => t.sender === "person").length} from people, ${all.filter((t) => t.sender === "them").length} from them`;
  return (
    <span className="w-strip" role="img" aria-label={label}>
      {strip.map((d) => (
        <span key={d.day} className="w-strip-d" title={`${new Date(d.day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: ${d.touches.length || "no"} ${d.touches.length === 1 ? "touch" : "touches"}`}>
          {d.touches.slice(0, 3).map((t) => <i key={t.id} className={"is-" + t.sender} />)}
        </span>
      ))}
    </span>
  );
}

/** Who has this account open right now. */
export function PresenceDots({ list, verbose }) {
  const s = useStore();
  if (!list?.length) return null;
  const text = list.map((p) => `${q.actorName(s, p.actor)} ${p.doing === "drafting" ? "is drafting" : "is viewing"}`).join(", ");
  return (
    <span className="w-presence" title={text}>
      {list.map((p) => <span key={p.id} className={"w-presence-a" + (p.doing === "drafting" ? " is-drafting" : "")}><Avatar actor={p.actor} /></span>)}
      {verbose ? <span className="w-sub">{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}

const VERDICT_TONE = { dnc: "risk", confirm: "attn", reply: "attn", quiet: "neutral", capped: "neutral", clear: "done" };
export function VerdictChip({ verdict, dueAt }) {
  const s = useStore();
  const over = (verdict === "confirm" || verdict === "reply") && q.isOverdueAt(s, dueAt);
  const due = verdict === "confirm" || verdict === "reply" ? q.dueText(s, dueAt) : verdict === "clear" ? "" : q.dueText(s, dueAt, "until");
  return (
    <span className="w-verdict">
      <StatusChip tone={over ? "risk" : VERDICT_TONE[verdict]}>{VERDICT_COPY[verdict].label}</StatusChip>
      {due && <small className={"tnum" + (over ? " is-over" : "")}>{due}</small>}
    </span>
  );
}

const SEQ = { active: ["agent", "Active"], paused: ["neutral", "Paused"], held: ["attn", "Held"], finished: ["done", "Finished"], stopped: ["risk", "Stopped"], awaiting: ["attn", "Awaiting approval"] };
export const SequenceChip = ({ state }) => <StatusChip tone={SEQ[state][0]}>{SEQ[state][1]}</StatusChip>;
export const SEQUENCE_STATES = Object.keys(SEQ).map((k) => [k, SEQ[k][1]]);

/** The account an Engagement address points at: ?a=company:co_salford. */
export const parseAcc = (v) => { if (!v) return null; const [kind, id] = String(v).split(":"); return (kind === "company" || kind === "supplier") && id ? { kind, id } : null; };
