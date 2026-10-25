// Which mode suits a job, and what it will likely cost. Deterministic (no model call), so recommending costs nothing.
import { MODES, MODE_ORDER, type ModeKey } from "../../config/model-pricing";
import { creditsForMode, runCharge, type Tokens } from "./credits";

export type TaskType = "triage" | "drafting" | "bookkeeping" | "briefing" | "coordination" | "research" | "analysis" | "strategy";

/** The task type of each catalogue agent. Custom roles and one-off tasks are classified from their words. */
const BY_TEMPLATE: Record<string, TaskType> = {
  inbox: "triage", reviews: "triage", bookings: "triage",
  outreach: "drafting", "credit-control": "drafting", social: "drafting",
  bookkeeping: "bookkeeping", briefing: "briefing", orchestrator: "coordination",
  research: "research", "lead-finder": "research",
};

/** Checked in order: the first that matches wins. */
const WORDS: [TaskType, RegExp][] = [
  ["strategy", /\b(strateg\w*|business plan|growth plan|proposal|pitch|tender|pricing review|board (pack|paper)|investor|restructur\w*|five[- ]year|5[- ]year|roadmap)\b/i],
  ["analysis", /\b(analys\w*|forecast\w*|compar\w*|audit\w*|reconcil\w*|contract\w*|legal|compliance|due diligence|model(ling)?|variance)\b/i],
  ["research", /\b(research\w*|investigat\w*|find out|look into|competitor\w*|market|sources?|prospect\w*)\b/i],
  ["briefing", /\b(brief(ing)?|summar\w*|round[- ]?up|digest|weekly update|report)\b/i],
  ["bookkeeping", /\b(receipts?|bookkeep\w*|categor\w* transactions?|ledger|vat|expenses?)\b/i],
  ["drafting", /\b(draft\w*|write|email\w*|reply|replies|chase|chasing|follow[- ]?up|post\w*|letter|quote)\b/i],
  ["triage", /\b(sort\w*|tag\w*|label\w*|triage|route|forward|classif\w*|check (if|whether)|remind\w*|tidy|file (it|them|these))\b/i],
];

const RECOMMEND: Record<TaskType, { mode: ModeKey; why: string }> = {
  triage: { mode: "quick", why: "Sorting and short replies follow clear rules, so the fastest mind does them well." },
  drafting: { mode: "standard", why: "Good writing in your tone needs a capable mind, but not the most expensive one." },
  bookkeeping: { mode: "standard", why: "Matching and tidying records is routine work with a few judgement calls." },
  briefing: { mode: "standard", why: "Pulling a week together into a clear summary is everyday work." },
  coordination: { mode: "standard", why: "Assigning and chasing tasks needs judgement about people, not deep research." },
  research: { mode: "deep", why: "Research means weighing sources carefully, where a deeper mind pays off." },
  analysis: { mode: "deep", why: "Careful analysis is where mistakes cost most, so it's worth a deeper mind." },
  strategy: { mode: "strategy", why: "Plans and big decisions deserve the most capable mind." },
};

export function taskTypeOf(job: { template?: string | null; text?: string | null }): TaskType {
  if (job.template && job.template !== "custom" && BY_TEMPLATE[job.template] && !job.text) return BY_TEMPLATE[job.template];
  const text = job.text || "";
  for (const [type, re] of WORDS) if (re.test(text)) return type;
  return (job.template && BY_TEMPLATE[job.template]) || "drafting";
}

/** One past run of this kind of job: its tokens and how many model requests it took. */
export type PastRun = { tokens: Tokens; requests: number };
/** Fewer past runs than this and the defaults are used instead. */
export const MIN_HISTORY = 5;

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

/** Likely credits for one run in a mode: the middle of past runs repriced on that mode's model, else the defaults. */
export function estimateRange(mode: ModeKey, past: PastRun[] = []): { low: number; high: number; from: "history" | "defaults" } {
  if (past.length < MIN_HISTORY) { const [low, high] = MODES[mode].typical; return { low, high, from: "defaults" }; }
  const c = past.map((r) => creditsForMode(mode, r.tokens, r.requests)).sort((a, b) => a - b);
  const low = Math.max(1, Math.round(pct(c, 0.2))), high = Math.max(low, Math.ceil(pct(c, 0.8)));
  return { low, high, from: "history" };
}

export type Recommendation = { task_type: TaskType; mode: ModeKey; reason: string; low: number; high: number; from: "history" | "defaults" };

export function recommend(job: { template?: string | null; text?: string | null }, past: PastRun[] = []): Recommendation {
  const task_type = taskTypeOf(job);
  const r = RECOMMEND[task_type];
  return { task_type, mode: r.mode, reason: r.why, ...estimateRange(r.mode, past) };
}

export const cheaper = (a: ModeKey, b: ModeKey) => MODE_ORDER.indexOf(a) < MODE_ORDER.indexOf(b);

/**
 * A monthly suggestion: an agent whose job suits a cheaper mode than the one it runs in, with what its runs this
 * month would have cost there. Only when most of its runs went through (a failing agent may need more, not less).
 */
export function cheaperSuggestion(agent: { name: string; mode: ModeKey; template: string; role?: string | null; instructions?: string | null },
  runs: (PastRun & { charged: number; ok: boolean })[], minSaving = 20) {
  if (!runs.length) return null;
  const rec = recommend({ template: agent.template, text: agent.template === "custom" ? `${agent.role || ""} ${agent.instructions || ""}` : null });
  if (!cheaper(rec.mode, agent.mode)) return null;
  if (runs.filter((r) => r.ok).length / runs.length < 0.8) return null;
  const now = runs.reduce((n, r) => n + r.charged, 0);
  const then = runs.reduce((n, r) => n + runCharge(creditsForMode(rec.mode, r.tokens, r.requests)), 0);
  const saving = now - then;
  if (saving < minSaving) return null;
  const about = saving >= 100 ? Math.round(saving / 50) * 50 : Math.round(saving / 10) * 10;
  return {
    mode: rec.mode, saving: Math.round(saving), runs: runs.length,
    text: `${agent.name} runs on ${MODES[agent.mode].name}; ${MODES[rec.mode].name} would likely do the job and save ~${about.toLocaleString("en-GB")} credits a month.`,
    reason: rec.reason,
  };
}
