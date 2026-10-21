// Channel targets (Teams and Slack webhook URLs) are secrets: AES-GCM at rest, key from CHANNEL_KEY.
import { b64url, fromB64url } from "../../../../packages/core/util";
import { importSigningKey } from "../../../../packages/core/sign";
import type { Env } from "./db";

async function aesKey(env: Env) {
  const raw = fromB64url(env.CHANNEL_KEY);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), new TextEncoder().encode(plain)));
  return b64url(iv) + "." + b64url(ct);
}
export async function unseal(env: Env, sealed: string): Promise<string> {
  const [iv, ct] = sealed.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
  return new TextDecoder().decode(pt);
}

// SIGNING_JWK may be raw JSON or base64url-encoded JSON (safer in env files and secret stores).
function jwkFrom(env: Env) {
  const raw = (env.SIGNING_JWK || "").trim();
  return JSON.parse(raw.startsWith("{") ? raw : new TextDecoder().decode(fromB64url(raw)));
}
let signer: CryptoKey | null = null;
export async function signingKey(env: Env) {
  if (!signer) signer = await importSigningKey(jwkFrom(env));
  return signer;
}
export function publicJwk(env: Env) {
  const { d, key_ops, ext, ...pub } = jwkFrom(env);
  return { ...pub, kid: env.SIGNING_KID, use: "sig", alg: "EdDSA" };
}

/** Stripe's webhook signature: HMAC-SHA256 over `${t}.${payload}`. */
export async function verifyStripeSignature(secret: string, header: string | undefined, payload: string, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = Array.from(mac, (x) => x.toString(16).padStart(2, "0")).join("");
  return header.split(",").some((p) => p === "v1=" + hex);
}
