// British formats for money, dates and times. Money is in pence.
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GBP0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** £1,280.00 */
export const pounds = (pence: number) => GBP.format(pence / 100);
/** £1,280 (for compact tiles and charts) */
export const poundsRound = (pence: number) => GBP0.format(Math.round(pence / 100));
/** 26 October 2026 */
export const ukDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "");
/** 26 Oct */
export const ukShort = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : "");
/** Mon 26 Oct */
export const ukDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
/** 5.30pm */
export const ukTime = (iso: string) => {
  const d = new Date(iso);
  const h = Number(d.toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }));
  const m = d.toLocaleString("en-GB", { minute: "2-digit", timeZone: "Europe/London" }).padStart(2, "0");
  return `${h % 12 || 12}${m === "00" ? "" : "." + m}${h < 12 ? "am" : "pm"}`;
};
/** "18:00" from a schedule → 6pm */
export const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}${m ? "." + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; };
/** 5 hours ago, 3 days ago, in 2 days */
export function relative(iso: string, nowIso?: string) {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const s = Math.round((now - Date.parse(iso)) / 1000);
  const fut = s < 0, a = Math.abs(s);
  const say = (n: number, u: string) => (fut ? `in ${n} ${u}${n === 1 ? "" : "s"}` : `${n} ${u}${n === 1 ? "" : "s"} ago`);
  if (a < 60) return fut ? "in a moment" : "just now";
  if (a < 3600) return say(Math.round(a / 60), "minute");
  if (a < 86400) return say(Math.round(a / 3600), "hour");
  if (a < 86400 * 14) return say(Math.round(a / 86400), "day");
  return ukShort(iso);
}
export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const mins = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
