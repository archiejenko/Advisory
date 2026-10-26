// One decision an agent wants from the owner: who, what, why, the exact preview (editable), and the record it's about.
// Desktop: A approve, E edit, R reject (J/K move between cards, handled by the queue). Phone: swipe right to approve,
// left to reject, tap the preview to edit. Approving removes the card at once and offers Undo for 30 seconds.
import React, { useRef, useState } from "react";
import { Icon, toast, useStore } from "./core.jsx";
import { AgentBadge, Button, RecordLink, StatusChip } from "./ui.jsx";
import { approve, reject } from "./demo/store";
import { relative } from "./demo/format";

const DONE = { send_reminder: "Reminder sent", send_outreach: "Email sent", reply_enquiry: "Reply sent", pay_bill: "Payment sent", confirm_job: "Crew told", post_briefing: "Briefing posted", send_invoice: "Invoice sent", follow_up_quote: "Follow-ups sent" };

export function decide(a, how, preview) {
  const tok = how === "approve" ? approve(a.id, preview ? { preview } : undefined) : reject(a.id);
  if (tok) toast(how === "approve" ? `${DONE[a.type] || "Done"}: ${a.title}` : `Rejected: ${a.title}. Nothing was sent.`, { undo: tok });
}

export function DecisionCard({ a, focused, onFocus, innerRef }) {
  const s = useStore();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(a.preview);
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const canEdit = a.preview.kind !== "action";
  const changed = JSON.stringify(draft) !== JSON.stringify(a.preview);

  const go = (how) => decide(a, how, how === "approve" && editing && changed ? draft : undefined);
  const edit = () => { if (canEdit) { setEditing(true); setOpen(true); } };
  const onKey = (e) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "a") { e.preventDefault(); go("approve"); }
    else if (k === "r") { e.preventDefault(); go("reject"); }
    else if (k === "e") { e.preventDefault(); edit(); }
  };
  // Swipes, on touch only, so a mouse can still select text.
  const down = (e) => { if (e.pointerType === "touch" && !editing) start.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const move = (e) => {
    if (!start.current) return;
    const x = e.clientX - start.current.x, y = e.clientY - start.current.y;
    if (!start.current.moved && Math.abs(y) > Math.abs(x)) { start.current = null; setDx(0); return; }
    start.current.moved = Math.abs(x) > 8; setDx(x);
  };
  const up = () => {
    if (!start.current) return;
    const x = dx; start.current = null; setDx(0);
    if (x > 110) go("approve"); else if (x < -110) go("reject");
  };

  const p = a.preview;
  return (
    <article ref={innerRef} className={"w-dc" + (focused ? " is-focus" : "")} tabIndex={0} onFocus={onFocus} onKeyDown={onKey}
      aria-label={`${a.title}. Press A to approve, E to edit, R to reject.`} data-decision={a.id}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDx(0); }}>
      {dx !== 0 && <div className={"w-dc-swipe " + (dx > 0 ? "is-yes" : "is-no")} aria-hidden="true"><span>{dx > 0 ? "Approve" : ""}</span><span>{dx < 0 ? "Reject" : ""}</span></div>}
      <div className="w-dc-in" style={dx ? { transform: `translateX(${dx}px)` } : undefined}>
        <div className="w-dc-top">
          <AgentBadge agentId={a.agentId} />
          <span className="w-sp" />
          <StatusChip tone={a.risk === "routine" ? "neutral" : "attn"}>{a.risk === "routine" ? "Routine" : "Needs a look"}</StatusChip>
          <span className="w-sub">{relative(a.createdAt, s.now > a.createdAt ? s.now : undefined)}</span>
        </div>
        <h3>{a.title}</h3>
        <p className="w-dc-why">{a.reason}</p>
        {a.note && <p className="w-dc-note"><Icon name="Calendar" size={15} />{a.note}</p>}

        <div className="w-preview">
          {p.kind === "email" && (
            <>
              <div className="w-preview-m">
                <span>To</span><b>{p.to}</b>
                <span>Subject</span>{editing ? <input aria-label="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /> : <b>{p.subject}</b>}
              </div>
              {editing ? <textarea aria-label="Email" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} autoFocus />
                : <button type="button" className={"w-preview-body" + (open ? " is-open" : "")} style={{ textAlign: "left", width: "100%", display: "block" }} onClick={() => (open ? edit() : setOpen(true))} aria-expanded={open}>{p.body}</button>}
            </>
          )}
          {p.kind === "message" && (
            <>
              <div className="w-preview-m"><span>To</span><b>{p.channel}</b></div>
              {editing ? <textarea aria-label="Message" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} autoFocus />
                : <button type="button" className="w-preview-body is-open" style={{ textAlign: "left", width: "100%", display: "block" }} onClick={edit}>{p.body}</button>}
            </>
          )}
          {p.kind === "action" && <><div className="w-preview-m"><span>Action</span><b>{p.summary}</b></div><p className="w-preview-body is-open">{p.detail}</p></>}
        </div>

        <div className="w-dc-acts">
          <Button variant="primary" icon="Check" onClick={() => go("approve")}>{editing && changed ? "Approve with edits" : "Approve"}</Button>
          {canEdit && !editing && <Button icon="Pencil" onClick={edit}>Edit</Button>}
          {editing && <Button variant="ghost" onClick={() => { setEditing(false); setDraft(a.preview); }}>Cancel edit</Button>}
          <Button variant="ghost" className="w-btn-danger" icon="X" onClick={() => go("reject")}>Reject</Button>
          <span className="w-sp" />
          <RecordLink refTo={a.linkedRecord} className="w-link">Open {a.linkedRecord.type === "conversation" ? "conversation" : a.linkedRecord.type === "agent" ? "agent" : "record"}</RecordLink>
          {focused && <span className="w-dc-keys" aria-hidden="true"><kbd className="w-kbd">A</kbd><kbd className="w-kbd">E</kbd><kbd className="w-kbd">R</kbd></span>}
        </div>
      </div>
    </article>
  );
}
