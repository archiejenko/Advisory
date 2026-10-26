// Every AI rate Agent House charges on, in one place. 1 credit = 1p (GBP) of underlying model cost.
// Rates are the provider's list prices in USD per million tokens (checked against platform.claude.com/docs
// pricing on 2026-10-25). Nothing else in the codebase may hardcode a rate: price through packages/core/credits.ts.
//
// To add a model from another provider: add it to MODELS with its own `provider`, add an adapter for that
// provider in apps/api/src/lib/llm.ts, and point a mode at it (or add a new mode). Nothing else changes.

/** Pounds per dollar. */
export const USD_TO_GBP = 1 / 1.3;

/** Cache multipliers on the input rate, unless a model sets its own. Writes are 5-minute cache writes. */
export const CACHE_DEFAULTS = { write: 1.25, read: 0.1 };

export type ModelRate = {
  provider: "anthropic";
  /** The short name shown under a mode, e.g. "Deep · Opus". */
  label: string;
  /** USD per million tokens. */
  in: number;
  out: number;
  cache?: { read?: number; write?: number };
  /** Higher rates when a single request's prompt (input + cache reads + cache writes) is over a threshold. */
  tiers?: { promptOver: number; in: number; out: number }[];
};

export const MODELS: Record<string, ModelRate> = {
  "claude-haiku-5-5": { provider: "anthropic", label: "Haiku", in: 0.1, out: 0.5, tiers: [{ promptOver: 100_000, in: 0.5, out: 2.5 }] },
  "claude-sonnet-5-5": { provider: "anthropic", label: "Sonnet", in: 2, out: 10, cache: { read: 0.05 } },
  "claude-opus-5-5": { provider: "anthropic", label: "Opus", in: 4, out: 20, cache: { read: 0.05 } },
  "claude-fable-5-1": { provider: "anthropic", label: "Fable", in: 10, out: 50, cache: { read: 0.025 } },
};

export type ModeKey = "quick" | "standard" | "deep" | "strategy";
export type Mode = {
  key: ModeKey;
  name: string;
  model: keyof typeof MODELS;
  /** Thinking effort sent with each request, and the most output per model step. */
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Typical credits for one task, used until a business has history of its own. */
  typical: [number, number];
  /** What it's for, in a sentence (marketing and the mode picker). */
  for: string;
};

export const MODES: Record<ModeKey, Mode> = {
  quick: { key: "quick", name: "Quick", model: "claude-haiku-5-5", effort: "low", maxTokens: 4000, typical: [1, 1],
    for: "Sorting, tagging, short replies and routine checks: fast and nearly free." },
  standard: { key: "standard", name: "Standard", model: "claude-sonnet-5-5", effort: "medium", maxTokens: 8000, typical: [4, 17],
    for: "Everyday work: drafting emails, chasing invoices, updating records, weekly round-ups." },
  deep: { key: "deep", name: "Deep", model: "claude-opus-5-5", effort: "high", maxTokens: 16000, typical: [8, 33],
    for: "Research, careful analysis and anything where getting it right matters more than speed." },
  strategy: { key: "strategy", name: "Strategy", model: "claude-fable-5-1", effort: "high", maxTokens: 16000, typical: [80, 340],
    for: "Plans, proposals and big decisions: the most capable mind, for the jobs that deserve it." },
};
export const MODE_ORDER: ModeKey[] = ["quick", "standard", "deep", "strategy"];
export const DEFAULT_MODE: ModeKey = "standard";
/** The mode for AI Team (system) calls: the command router, swarm drafts and learning house rules. */
export const SYSTEM_MODE: ModeKey = "standard";

/** Every run is charged at least this many credits. */
export const MIN_CREDITS_PER_RUN = 1;
/** Runs estimated above this many credits ask the owner first (each business can change it). */
export const CONFIRM_OVER_DEFAULT = 100;

/** Plan credits a month (reset on the 1st, UK time) and the trial's one-off grant. Keys match PLANS. */
export const PLAN_CREDITS: Record<string, number> = { starter: 1500, growth: 5000, scale: 12000, pilot: 12000 };
export const TRIAL_CREDITS = 150;
/** A one-off top-up. Top-up credits roll over; plan credits don't. */
export const TOPUP = { credits: 1000, pence: 3500 };
