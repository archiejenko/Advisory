// Credits in the workspace: choosing a mode for a job, and saying yes to a run likely to cost more than usual.
// Mode names, models and typical ranges come from the one pricing config the API charges from.
import React, { useState } from "react";
import { MODES, MODELS, MODE_ORDER, TRIAL_CREDITS } from "../../../config/model-pricing.ts";

export const range = (low, high) => (low === high ? `${low.toLocaleString("en-GB")}` : `${low.toLocaleString("en-GB")}–${high.toLocaleString("en-GB")}`);
export const credits = (n) => `${Math.round(n).toLocaleString("en-GB")} ${Math.round(n) === 1 ? "credit" : "credits"}`;
export const modeName = (k) => MODES[k]?.name || k;
export const modelOf = (k) => (MODES[k] ? MODELS[MODES[k].model].label : "");
/** Every mode's defaults, for when the API hasn't sent its estimates (the demo, a template not yet hired). */
export const defaultChoices = (recommended = "standard", reason = "") => ({
  recommended: { mode: recommended, reason, low: MODES[recommended].typical[0], high: MODES[recommended].typical[1], from: "defaults" },
  modes: MODE_ORDER.map((k) => ({ mode: k, name: MODES[k].name, model: modelOf(k), for: MODES[k].for, low: MODES[k].typical[0], high: MODES[k].typical[1], from: "defaults" })),
});

/** "Deep · Opus": the mode, with the model it runs on underneath. */
export function ModeName({ mode }) {
  return <span className="mode-n"><b>{modeName(mode)}</b><span className="dt">{modelOf(mode)}</span></span>;
}

/** The four modes as options, the one suited to the job marked, each with its likely credits a run. */
export function ModePicker({ value, onChange, choices, name = "mode", legend = "Mode", disabled }) {
  const c = choices || defaultChoices();
  const rec = c.recommended;
  return (
    <fieldset className="opts" disabled={disabled}>
      <legend className="flabel">{legend}</legend>
      {rec?.reason && <p className="hint">We suggest <b>{modeName(rec.mode)}</b>: {rec.reason} Usually {range(rec.low, rec.high)} {rec.high === 1 ? "credit" : "credits"} a run.</p>}
      {c.modes.map((m) => (
        <label key={m.mode} className={"opt" + (value === m.mode ? " is-on" : "")}>
          <input type="radio" name={name} value={m.mode} checked={value === m.mode} onChange={() => onChange(m.mode)} />
          <span>
            <b>{m.name} · {m.model}{rec?.mode === m.mode && <span className="st st-done">Suggested</span>}</b>
            <span>{m.for} Usually {range(m.low, m.high)} {m.high === 1 ? "credit" : "credits"} a run{m.from === "history" ? ", from your past runs" : ""}.</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Wraps a call that the API may answer with 409 needs_confirmation (a run likely to cost more than the business's
 * threshold). Shows the estimate with a button to go ahead, which repeats the call with confirm: true. Pass the
 * page's action runner (useAction().run) so the repeat shows busy and errors like the first try.
 */
export function useCostCheck(runner = (fn) => fn()) {
  const [pending, setPending] = useState(null);
  const guard = async (call) => {
    try { setPending(null); return await call(false); }
    catch (e) {
      if (e.code !== "needs_confirmation") throw e;
      setPending({ message: e.message, details: e.details, go: () => call(true) });
      return undefined;
    }
  };
  const prompt = pending && (
    <div className="notice cost-check" role="alertdialog" aria-label="Confirm credits">
      <p>{pending.message}</p>
      {pending.details?.estimate?.per_month && <p className="dt">That's about {range(pending.details.estimate.per_month.low, pending.details.estimate.per_month.high)} credits a month. You can change when runs ask first in Usage and plan.</p>}
      <div className="actions actions-tight">
        <button className="btn btn-sm" onClick={() => { const p = pending; setPending(null); runner(p.go); }}>Go ahead</button>
        <button className="link link-s" onClick={() => setPending(null)}>Not now</button>
      </div>
    </div>
  );
  return { guard, prompt, pending: !!pending };
}

/* ---------- The pricing pages ---------- */
export const PRICING_SUB = "Every app and up to 100 AI Team members on every plan. Plans differ in how many credits the AI Team gets each month — you choose how they're spent.";
export const PRICING_FOOT = `Prices before VAT. 14 days free with ${TRIAL_CREDITS} credits, no card. Top up anytime at £35 per 1,000 credits, or the AI Team pauses until the 1st — nothing is charged without your say-so.`;
const typical = (k) => { const [lo, hi] = MODES[k].typical; return lo === hi ? `About ${lo} ${lo === 1 ? "credit" : "credits"} a task` : `${range(lo, hi)} credits a task`; };
export const PRICING_FAQ = [
  ["What's a credit?", `A credit is 1p of the AI your team uses. Each task uses credits for the work it actually does: sorting an email is about a credit, a careful piece of research ${range(...MODES.deep.typical)}, a full strategy ${range(...MODES.strategy.typical)}. Every one is listed in Usage, by agent and by mode.`],
  ["Which mode should I use?", "Start with the one we suggest. When you set up an agent or give it a task, we suggest a mode for the job with what it's likely to use, and you can always choose another. Quick suits sorting and short replies, Standard everyday writing, Deep research and analysis, and Strategy plans and big decisions. Each month we point out any agent that would likely do just as well on a cheaper mode."],
  ["What happens when I run out?", "We tell you and offer a top-up: £35 for 1,000 credits. If you'd rather not, the AI Team pauses until your credits reset on the 1st. Nothing is charged without your say-so. You can also give any agent its own monthly budget, and runs likely to use more than 100 credits ask you first."],
  ["Do unused credits roll over?", "Plan credits reset on the 1st of each month, so unused ones don't carry over. Top-up credits do: they stay until you use them."],
];

/** "Choose the right mind for the job": the four modes, what each is for and what a task typically uses. */
export function Minds({ head }) {
  return (
    <>
      {head}
      <div className="modes">
        {MODE_ORDER.map((k) => (
          <article key={k} className="mode-card">
            <h3>{MODES[k].name}</h3>
            <p className="body">{MODES[k].for}</p>
            <p className="mode-cr">{typical(k)}</p>
            <p className="mode-m">Runs on {MODELS[MODES[k].model].label}</p>
          </article>
        ))}
      </div>
    </>
  );
}
