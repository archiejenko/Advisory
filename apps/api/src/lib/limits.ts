// Fixed-window rate limits on D1 (one row per window), for public forms and sign-in links.
// Buckets start with the hour, so old windows can be pruned with one range delete.
import type { Context } from "hono";
import { sha256Hex } from "../../../../packages/core/util";
import { type Env, one, run } from "./db";
import { HttpError } from "./http";

const hourOf = (d: Date) => d.toISOString().slice(0, 13);

/** Count one hit against `action:key` this hour. Returns false once the count goes over `max`. */
export async function hit(env: Env, action: string, key: string, max: number, now = new Date()) {
  const bucket = `rl:${hourOf(now)}:${action}:${key}`;
  const r = await one<any>(env, "INSERT INTO rate_window (bucket, count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count", bucket);
  return (r?.count ?? 0) <= max;
}

export const clientIp = (c: Context) => c.req.header("CF-Connecting-IP") || "local";

/** Per-IP limit for public endpoints. */
export async function limitIp(c: Context<any>, action: string, max: number) {
  if (!(await hit(c.env, action, clientIp(c), max))) throw new HttpError(429, "slow_down", "Too many requests from your network. Try again in an hour.");
}

/** Per-address limit, keyed by a hash so the table never holds the address itself. */
export async function limitEmail(env: Env, action: string, email: string, max: number) {
  return hit(env, action, (await sha256Hex(email.toLowerCase())).slice(0, 24), max);
}

/** Drop windows older than two hours. Run daily from retention. */
export async function pruneRateWindows(env: Env, now = new Date()) {
  await run(env, "DELETE FROM rate_window WHERE bucket >= 'rl:' AND bucket < ?", `rl:${hourOf(new Date(now.getTime() - 2 * 3600e3))}`);
  await run(env, "DELETE FROM rate_window WHERE bucket >= 'ip:' AND bucket < 'iq'"); // the old bucket format
}
