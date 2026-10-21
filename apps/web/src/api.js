import { useCallback, useEffect, useRef, useState } from "react";
import { demoApi } from "./demo.js";

// The site is served by the API Worker on the same origin, so every call is a relative path
// and the session travels in an HttpOnly cookie. Opened as a local file, the site runs as a demo.
export const LIVE = typeof location !== "undefined" && /^https?:$/.test(location.protocol);

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}

// The demo workspace answers /api/ws/* from memory, so signed-out visitors can click through every page.
let demoMode = false;
export const setDemo = (on) => { demoMode = on; };
export const isDemo = () => demoMode;

export async function api(method, path, body, { raw = false } = {}) {
  if (demoMode && path.startsWith("/api/ws/") && path !== "/api/ws/me") {
    try { return await demoApi(method, path, body instanceof FormData || (typeof Blob !== "undefined" && body instanceof Blob) ? undefined : body); }
    catch (e) { throw new ApiError(e.status || 400, e.code || "demo", e.message); }
  }
  const init = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (typeof Blob !== "undefined" && body instanceof Blob) { init.body = body; init.headers["Content-Type"] = body.type || "application/octet-stream"; }
  else if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, init); }
  catch { throw new ApiError(0, "offline", "Can't reach Agent House. Check your connection and try again."); }
  if (!res.ok) {
    let j = {};
    try { j = await res.json(); } catch {}
    throw new ApiError(res.status, j.error?.code || "error", j.error?.message || `Something went wrong (${res.status}). Try again.`, j.error?.details);
  }
  if (raw) return res;
  return (res.headers.get("content-type") || "").includes("json") ? res.json() : res.text();
}

/** Load a GET endpoint; re-runs when `path` changes. `reload()` fetches again without clearing. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
  const load = useCallback(async (quiet) => {
    if (!path) { seq.current++; setState({ data: null, error: null, loading: false }); return; }
    const n = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api("GET", path);
      if (n === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: () => load(true) };
}

/** Run an action, tracking busy and error state for one button or form. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn) => {
    setBusy(true); setError("");
    try { return await fn(); }
    catch (e) { setError(e.message || String(e)); return undefined; }
    finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

/** Download a file from an authenticated endpoint, keeping the server's file name. */
export async function download(path, fallback) {
  const res = await api("GET", path, undefined, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || fallback;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Turnstile: only loaded when the server says forms need it ---------- */
let config = null;
export async function siteConfig() {
  if (!LIVE) return {};
  if (!config) config = api("GET", "/api/public/config").catch(() => ({}));
  return config;
}

export function useTurnstile() {
  const el = useRef(null);
  const [token, setToken] = useState("");
  const [needed, setNeeded] = useState(false);
  const widget = useRef(null);
  useEffect(() => {
    let gone = false;
    siteConfig().then((c) => {
      const key = c.turnstile_site_key;
      if (!key || gone) return;
      setNeeded(true);
      const render = () => { widget.current = window.turnstile.render(el.current, { sitekey: key, callback: setToken, "expired-callback": () => setToken("") }); };
      if (!document.getElementById("cf-turnstile")) {
        const s = document.createElement("script");
        s.id = "cf-turnstile"; s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
        document.head.appendChild(s);
      }
      // Wait for both the script and the widget's container, which appears once `needed` is set.
      const t = setInterval(() => {
        if (gone) return clearInterval(t);
        if (window.turnstile && el.current && widget.current === null) { clearInterval(t); render(); }
      }, 150);
    });
    return () => { gone = true; };
  }, []);
  const reset = () => { if (window.turnstile && widget.current !== null) { window.turnstile.reset(widget.current); setToken(""); } };
  return { el, token, needed, ready: !needed || !!token, reset };
}

/* ---------- Formatting for API values ---------- */
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const dateOf = (iso) => (iso ? `${Number(iso.slice(8, 10))} ${LONG[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");
export const dateTimeOf = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
};
export const pounds = (pence) => "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
