// Log a touch: a call, a WhatsApp, a visit, anything outside the inbox. The contact rules run as you fill it in. A
// message going out now that breaks a rule needs a written reason; one logged after it happened is judged by the
// rules as they stood then, and a breach goes in the guard log.
import React, { useEffect, useState } from "react";
import { Icon, toast, useStore } from "../core.jsx";
import { Button, Dialog, SegmentedControl } from "../ui.jsx";
import { logTouch } from "../demo/store";
import * as q from "../demo/selectors";
import { RULE_COPY } from "../../../../../packages/core/contact";

const ME = { kind: "person", id: "p_dana" };
const local = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };

export function LogTouch({ open, onClose, refTo, preset }) {
  const s = useStore();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open) setF({ acc: refTo ? q.accKey(refTo) : "", who: "p_dana", direction: preset?.direction || "out", channel: preset?.channel || "phone", when: "now", at: local(Date.now() - 2 * 3600e3), text: "", outcome: "", quiet: false, reason: "" });
  }, [open]);
  if (!open || !f) return null;
  const set = (o) => setF({ ...f, ...o });
  const acc = f.acc ? { kind: f.acc.split(":")[0], id: f.acc.split(":")[1] } : null;
  const actor = { kind: "person", id: f.who };
  const thread = acc ? q.touchesFor(s, acc)[0]?.thread || null : null;
  const earlier = f.when === "earlier";
  const at = earlier ? new Date(f.at).toISOString() : null;
  const check = acc && f.direction === "out" ? (earlier ? null : q.checkAttempt(s, acc, { actor, channel: f.channel, newThread: !thread })) : null;
  const past = acc && f.direction === "out" && earlier && at ? q.previewLogged(s, acc, { actor, channel: f.channel, at, thread }) : null;
  const warn = check && check.decision !== "allow";
  const ready = acc && f.text.trim() && (!warn || f.reason.trim()) && (!earlier || Date.parse(at) < Date.now());
  const save = () => {
    const tok = logTouch({ account: acc, actor, channel: f.channel, direction: f.direction, text: f.text.trim(), at: at || undefined, outcome: f.direction === "in" ? f.outcome || null : null, quiet: f.direction === "in" && f.quiet, thread }, warn ? f.reason : null);
    if (!tok) return;
    toast(past?.breach ? `Logged, and recorded as a breach of ${RULE_COPY[past.breach].name.toLowerCase()}.` : warn ? "Logged, with your reason in the guard log." : "Touch logged.", { undo: tok });
    onClose();
  };
  const people = s.people.filter((p) => p.team === "office" || p.role === "Crew lead");
  return (
    <Dialog open onClose={onClose} title={acc ? `Log a touch with ${q.accountName(s, acc)}` : "Log a touch"}>
      <form className="w-form" onSubmit={(e) => { e.preventDefault(); if (ready) save(); }}>
        {!refTo && (
          <div className="w-field"><label htmlFor="lt-acc">Account</label>
            <select id="lt-acc" className="w-input" value={f.acc} onChange={(e) => set({ acc: e.target.value })} data-autofocus>
              <option value="">Choose a buyer or supplier</option>
              {q.allAccounts(s).map((r) => <option key={q.accKey(r)} value={q.accKey(r)}>{q.accountName(s, r)} ({q.accountKind(r).toLowerCase()})</option>)}
            </select>
          </div>
        )}
        <SegmentedControl label="Direction" value={f.direction} onChange={(v) => set({ direction: v })} options={[["out", "We contacted them"], ["in", "They contacted us"]]} />
        <div className="w-form-2">
          <div className="w-field"><label htmlFor="lt-who">{f.direction === "out" ? "Who" : "Who heard it"}</label>
            <select id="lt-who" className="w-input" value={f.who} onChange={(e) => set({ who: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </div>
          <div className="w-field"><label htmlFor="lt-ch">Channel</label>
            <select id="lt-ch" className="w-input" value={f.channel} onChange={(e) => set({ channel: e.target.value })}>{q.CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </div>
        </div>
        <fieldset className="w-field w-when"><legend>When</legend>
          <label className="w-radio"><input type="radio" name="lt-when" checked={!earlier} onChange={() => set({ when: "now" })} />Now</label>
          <label className="w-radio"><input type="radio" name="lt-when" checked={earlier} onChange={() => set({ when: "earlier" })} />Earlier, logged after it happened</label>
          {earlier && <input className="w-input" type="datetime-local" aria-label="When it happened" value={f.at} max={local(Date.now())} onChange={(e) => set({ at: e.target.value })} />}
        </fieldset>
        <div className="w-field"><label htmlFor="lt-text">What was said</label>
          <textarea id="lt-text" className="w-input" rows={2} value={f.text} onChange={(e) => set({ text: e.target.value })} placeholder={f.direction === "out" ? "Rang to book the walk-round" : "Said yes to the quote"} {...(refTo ? { "data-autofocus": true } : {})} />
        </div>
        {f.direction === "in" && (
          <div className="w-form-2">
            <div className="w-field"><label htmlFor="lt-out">Outcome</label>
              <select id="lt-out" className="w-input" value={f.outcome} onChange={(e) => set({ outcome: e.target.value })}><option value="">None</option><option value="accepted">They accepted</option><option value="declined">They declined or opted out</option></select>
            </div>
            <label className="w-radio" style={{ alignSelf: "end", minHeight: 40 }}><input type="checkbox" checked={f.quiet} onChange={(e) => set({ quiet: e.target.checked })} />Needs no reply</label>
          </div>
        )}
        {acc && f.direction === "out" && (
          <div className={"w-check is-" + (warn || past?.breach ? "warn" : "ok")} role="status" aria-live="polite">
            <Icon name={warn || past?.breach ? "AlertTriangle" : "CircleCheck"} size={18} />
            <div>
              {earlier ? (past?.breach ? <><b>This broke {RULE_COPY[past.breach].name.toLowerCase()} when it happened</b><p>{past.reason.split(": ").slice(1).join(": ") || past.reason}. It will be logged as a breach.</p></> : <><b>No rule was broken at the time</b><p>It will be logged as it happened.</p></>)
                : warn ? <><b>{RULE_COPY[check.ruleId].name}</b><p>{check.rules.find((r) => r.id === check.ruleId).detail}. You can still send it: say why, and it goes in the guard log as overridden.</p></>
                : <><b>No rule stops this</b><p>Checked against all six contact rules.</p></>}
            </div>
          </div>
        )}
        {warn && (
          <div className="w-field"><label htmlFor="lt-why">Why go ahead? Needed to override</label>
            <textarea id="lt-why" className="w-input" rows={2} value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
          </div>
        )}
        {acc && f.direction === "in" && f.outcome && <p className="w-sub">{f.outcome === "accepted" ? `Whoever owns ${q.accountName(s, acc)} gets ${s.contactRules.R4.hours} hours to confirm, on any channel.` : `Nobody contacts them for ${s.contactRules.R1.days} days. Agents stop at once.`}</p>}
        <div className="w-row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <button type="submit" className="w-btn w-btn-primary" disabled={!ready}>{warn ? "Log it with my reason" : "Log it"}</button>
        </div>
      </form>
    </Dialog>
  );
}
