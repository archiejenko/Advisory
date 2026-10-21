// Ed25519 signatures over canonical JSON, using WebCrypto (works in Workers and Node 20+).
import { b64url, canonical, fromB64url } from "./util";

// Keep only the key material: runtimes disagree on "alg" (Node exports "Ed25519", workerd wants "EdDSA"),
// and stray key_ops/ext fields can make an import fail.
const okp = (j: JsonWebKey, priv: boolean): JsonWebKey => ({ kty: "OKP", crv: "Ed25519", x: j.x, ...(priv ? { d: (j as any).d } : {}) });
export async function importSigningKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", okp(jwk, true), { name: "Ed25519" }, false, ["sign"]);
}
export async function importVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", okp(jwk, false), { name: "Ed25519" }, false, ["verify"]);
}

/** Adds response_id-independent signature over every other field. */
export async function signBody<T extends Record<string, unknown>>(body: T, key: CryptoKey, kid: string): Promise<T & { signature: string; key_id: string }> {
  const msg = new TextEncoder().encode(canonical({ ...body, key_id: kid }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, msg));
  return { ...body, key_id: kid, signature: "ed25519:" + b64url(sig) };
}

export async function verifyBody(body: Record<string, unknown>, key: CryptoKey): Promise<boolean> {
  const { signature, ...rest } = body as { signature?: string };
  if (!signature || !signature.startsWith("ed25519:")) return false;
  return crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(signature.slice(8)), new TextEncoder().encode(canonical(rest)));
}

export async function generateSigningJwk(): Promise<JsonWebKey> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return crypto.subtle.exportKey("jwk", kp.privateKey) as Promise<JsonWebKey>;
}
