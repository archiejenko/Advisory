// The business's saved OS, shared by the shell, the dock, the home screen and the builder.
// One fetch per page view; anything that saves the OS calls setOs() and every subscriber updates.
import { useEffect, useState } from "react";
import { api } from "./api.js";

let cache = null, pending = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f(cache));

export async function loadOs(force = false) {
  if (cache && !force) return cache;
  if (!pending || force) pending = api("GET", "/api/ws/os").then((r) => { cache = r; pending = null; emit(); return r; }).catch((e) => { pending = null; throw e; });
  return pending;
}
export function setOs(os) { cache = { ...(cache || {}), os }; emit(); }
export function resetOs() { cache = null; pending = null; }

/** { os, guardrails } once loaded, or null. */
export function useOs() {
  const [v, setV] = useState(cache);
  useEffect(() => {
    subs.add(setV);
    loadOs().catch(() => {});
    return () => subs.delete(setV);
  }, []);
  return v;
}

// The theme is the business's choice, and each viewer can override it on their own device.
const KEY = "ah:theme";
export function viewerTheme() { try { return localStorage.getItem(KEY) || null; } catch { return null; } }
export function setViewerTheme(t) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} window.dispatchEvent(new Event("ah:theme")); }
export function useTheme(os) {
  const [mine, setMine] = useState(viewerTheme());
  useEffect(() => { const on = () => setMine(viewerTheme()); window.addEventListener("ah:theme", on); return () => window.removeEventListener("ah:theme", on); }, []);
  return mine || os?.theme || "dark";
}
