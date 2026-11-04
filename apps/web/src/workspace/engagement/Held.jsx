// A draft the contact rules held, shown where the draft would have been, with the way to decide on it.
import React from "react";
import { Icon, toast, useStore } from "../core.jsx";
import { guardOutcome } from "../demo/store";
import { Button } from "../ui.jsx";
import * as q from "../demo/selectors";
import { RULE_COPY } from "../../../../../packages/core/contact";

export function HeldNotice({ refTo }) {
  const s = useStore();
  const a = q.approvalsFor(s, refTo).find((x) => x.status === "held");
  const g = a && s.guard.find((x) => x.id === a.guardEventId && x.pending);
  if (!a || !g) return null;
  return (
    <div className="w-held" role="status">
      <Icon name="ShieldCheck" size={18} />
      <div>
        <b>{q.actorName(s, g.actor)}'s draft is held</b>
        <p>{RULE_COPY[g.ruleId].name}: {g.reason}. Nothing was sent.</p>
        <Button size="sm" to={`/workspace/engagement?a=${q.accKey(g.account)}`} icon="ArrowRight">Decide in Engagement</Button>
      </div>
    </div>
  );
}

/** The toast after an agent drafts something: queued as usual, or held or skipped by the contact rules. */
export function draftToast(tok, queued) {
  const g = guardOutcome(tok);
  toast(g?.outcome === "held" ? `Held by the contact rules: ${g.reason}. Decide in Engagement.` : g?.outcome === "blocked" ? "Skipped: they're on do not contact. Nothing was drafted." : queued, { undo: tok });
}
