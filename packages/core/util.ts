// Small helpers shared by the Worker, the listener and the tests. No Node or Worker-only APIs.

export const nowIso = (d = new Date()) => d.toISOString();

export function newId(prefix: string): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return prefix + "_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 14);
}

export function randomToken(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const b64json = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
export const fromB64json = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s))));

/** Stable JSON: keys sorted at every level, so a signature covers exactly one byte string. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export const district = (postcode?: string | null) => (postcode || "").trim().toUpperCase().split(/\s+/)[0] || "";
