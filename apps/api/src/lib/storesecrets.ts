// Third-party keys can live in Cloudflare Secrets Store instead of as Worker secrets. A Secrets Store binding is an
// object with get(), not a string, so each entry point swaps those for their values before anything reads env.X.
// Values are read once per isolate; a failed read is retried on the next request instead of being cached.
import type { Env } from "./db";

export const STORE_KEYS = ["CH_API_KEY", "FCA_EMAIL", "FCA_KEY", "ANTHROPIC_API_KEY", "SEARCH_API_KEY", "MAIL_HTTP_KEY", "STRIPE_SECRET", "STRIPE_WEBHOOK_SECRET", "TURNSTILE_SECRET", "OPERATOR_EMAIL"] as const;

let cache: Promise<Record<string, string | undefined>> | null = null;
const isStoreBinding = (v: unknown): v is { get(): Promise<string> } => !!v && typeof v === "object" && typeof (v as any).get === "function";

export async function withStoreSecrets(env: Env): Promise<Env> {
  const bound = STORE_KEYS.filter((k) => isStoreBinding(env[k]));
  if (!bound.length) return env;
  cache ??= Promise.all(bound.map(async (k) => {
    try { return [k, await env[k].get()] as const; } catch (e) { console.error(`Secrets Store: couldn't read ${k}`, e); return [k, undefined] as const; }
  })).then((pairs) => {
    const out = Object.fromEntries(pairs);
    if (pairs.some(([, v]) => v === undefined)) cache = null;
    return out;
  });
  return { ...env, ...(await cache) };
}

/** For tests: forget the values read so far. */
export const resetStoreSecrets = () => { cache = null; };
