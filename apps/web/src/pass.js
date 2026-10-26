// The operator pass: in the demo build only, /#/admin unlocks everything the demo normally holds back
// (plan limits, roles still being built, the locked Markets desk, sign-up, billing, channels, the team), so the
// whole product can be walked through. It changes nothing on the hosted site: the live build never reads it.
/* global __DEMO_BUILD__ */
const LIVE = !__DEMO_BUILD__ && typeof location !== "undefined" && /^https?:$/.test(location.protocol);

const KEY = "ah:pass";
export function isPass() {
  if (LIVE) return false;
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setPass(on) {
  try { on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch {}
  window.dispatchEvent(new Event("ah:pass"));
}
