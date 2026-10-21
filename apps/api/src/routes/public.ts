// Public forms: health checks, call booking, developer API keys and credits. No sign-in;
// protected by a per-IP rate limit and, when TURNSTILE_SECRET is set, Cloudflare Turnstile.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { newId, nowIso, randomToken, sha256Hex } from "../../../../packages/core/util";
import { type Env, one, all, run } from "../lib/db";
import { body, bad, notFound, HttpError } from "../lib/http";
import { sendMail } from "../lib/mail";
import { creditsCheckout } from "../lib/stripe";
import { createOrg } from "../lib/orgs";

export const pub = new Hono<{ Bindings: Env }>();

async function limitIp(c: Context<{ Bindings: Env }>, action: string, max: number) {
  const ip = c.req.header("CF-Connecting-IP") || "local";
  const bucket = `ip:${action}:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const r = await one<any>(c.env, "INSERT INTO rate_window (bucket, count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count", bucket);
  if (r.count > max) throw new HttpError(429, "slow_down", "Too many requests from your network. Try again in an hour.");
}

async function turnstile(c: Context<{ Bindings: Env }>, token: string | null | undefined) {
  if (!c.env.TURNSTILE_SECRET) return;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: new URLSearchParams({ secret: c.env.TURNSTILE_SECRET, response: token || "", remoteip: c.req.header("CF-Connecting-IP") || "" }),
  });
  const j: any = await res.json();
  if (!j.success) throw bad("The bot check didn't pass. Reload the page and try again.", "bot_check");
}

/* ---------- Health check ---------- */
/** What the website needs to know at load: whether forms must carry a Turnstile token. */
pub.get("/config", (c) => c.json({ turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null }));

pub.post("/health-checks", async (c) => {
  await limitIp(c, "hc", 5);
  const form = await c.req.formData();
  await turnstile(c, form.get("cf-turnstile-response") as string);
  const f = z.object({ name: z.string().min(1).max(100), email: z.string().email(), company: z.string().min(1).max(150) }).safeParse({ name: form.get("name"), email: form.get("email"), company: form.get("company") });
  if (!f.success) throw bad("Add your name, a valid work email and your company name.");
  const file = form.get("file") as unknown as File | null;
  if (!file || typeof file === "string") throw bad("Attach your client list as a CSV or Excel file.");
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw bad("Upload a CSV or Excel file.");
  if (file.size > 10 * 1024 * 1024) throw bad("The file is larger than 10 MB.");
  const id = newId("hc"), token = randomToken(18);
  const key = `health-checks/${id}${file.name.match(/\.\w+$/)![0].toLowerCase()}`;
  await c.env.FILES.put(key, await file.arrayBuffer());
  await run(c.env, "INSERT INTO health_check (id, token, name, email, company, file_key, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id, token, f.data.name, f.data.email.toLowerCase(), f.data.company, key, "queued", nowIso());
  await c.env.JOBS.send({ type: "health_check", id, step: "split" });
  await sendMail(c.env, { to: f.data.email, subject: "We've received your client list", text: `Thanks, ${f.data.name}. We're running ${f.data.company}'s client list against Companies House, The Gazette and the FCA register. Your health check will arrive within 24 hours.\n\nYour list is used only for this check and deleted after 30 days.` });
  return c.json({ id, status: "queued", message: "Your health check will arrive within 24 hours." }, 202);
});

/** The report, only after the operator has approved it. */
export const reports = new Hono<{ Bindings: Env }>();
reports.get("/:token", async (c) => {
  const hc = await one<any>(c.env, "SELECT * FROM health_check WHERE token = ?", c.req.param("token"));
  if (!hc || !hc.approved_at || !hc.report_key) return c.text("This report isn't available. It may have expired: reports are deleted after 30 days.", 404);
  const obj = await c.env.FILES.get(hc.report_key);
  if (!obj) return c.text("This report has been deleted.", 404);
  return new Response(obj.body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
});

/* ---------- Booking ---------- */
const TIMES = ["09:30", "11:00", "14:00", "16:00"];
function nextWeekdays(from: Date, n: number) {
  const out: string[] = []; const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1));
  while (out.length < n) { const wd = d.getUTCDay(); if (wd && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

pub.get("/slots", async (c) => {
  const days = nextWeekdays(new Date(), 10);
  const taken = new Set((await all<any>(c.env, "SELECT slot FROM booking WHERE cancelled_at IS NULL AND slot >= ?", days[0])).map((r) => r.slot));
  return c.json({ timezone: "Europe/London", days: days.map((d) => ({ date: d, times: TIMES.map((t) => ({ time: t, available: !taken.has(`${d}T${t}`) })) })) });
});

pub.post("/bookings", async (c) => {
  await limitIp(c, "book", 10);
  const b = await body(c, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.enum(TIMES as [string, ...string[]]), name: z.string().min(1).max(100), email: z.string().email(), company: z.string().min(1).max(150), turnstile: z.string().optional() }));
  await turnstile(c, b.turnstile);
  if (!nextWeekdays(new Date(), 10).includes(b.date)) throw bad("Choose one of the days shown.");
  const id = newId("bk"), slot = `${b.date}T${b.time}`;
  const ins = await run(c.env, "INSERT INTO booking (id, slot, name, email, company, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(slot) DO NOTHING", id, slot, b.name, b.email.toLowerCase(), b.company, nowIso());
  if (!ins.meta.changes) throw new HttpError(409, "slot_taken", "Someone has just booked that time. Choose another.");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agent House//Booking//EN", "BEGIN:VEVENT", `UID:${id}@agenthouse`, `DTSTAMP:${nowIso().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/London:${b.date.replace(/-/g, "")}T${b.time.replace(":", "")}00`, "DURATION:PT20M", "SUMMARY:Agent House: 20 minutes on your client book", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  await sendMail(c.env, { to: b.email, subject: `Booked: ${b.date} at ${b.time}`, text: `Thanks, ${b.name}. You're booked for 20 minutes on ${b.date} at ${b.time} UK time.\n\nCalendar entry:\n${ics}` });
  if (c.env.OPERATOR_EMAIL) await sendMail(c.env, { to: c.env.OPERATOR_EMAIL, subject: `New call: ${b.company}, ${b.date} ${b.time}`, text: `${b.name} <${b.email}>, ${b.company}` });
  return c.json({ id, slot, message: `Booked for ${b.date} at ${b.time} UK time.` }, 201);
});

/* ---------- Self-serve sign-up for businesses ---------- */
pub.post("/signup", async (c) => {
  await limitIp(c, "signup", 5);
  const b = await body(c, z.object({ business: z.string().min(2).max(150), name: z.string().max(100).optional(), email: z.string().email(), what: z.string().max(500).optional(), customers: z.string().max(500).optional(), area: z.string().max(200).optional(), turnstile: z.string().optional() }));
  await turnstile(c, b.turnstile);
  const email = b.email.toLowerCase();
  const existing = await one<any>(c.env, "SELECT u.id FROM user u JOIN membership m ON m.user_id = u.id WHERE u.email = ? LIMIT 1", email);
  if (existing) {
    // Already has a workspace: send a sign-in link instead of creating a second one.
    const token = randomToken();
    await run(c.env, "INSERT INTO magic_link (token_hash, email, expires_at) VALUES (?,?,?)", await sha256Hex(token), email, new Date(Date.now() + 15 * 60000).toISOString());
    await sendMail(c.env, { to: email, subject: "Your Agent House sign-in link", text: `You already have a workspace. Sign in: ${c.env.APP_URL}#/sign-in?token=${token}\n\nThis link works once and expires in 15 minutes.` });
    return c.json({ ok: true, message: "Check your email for a link to your workspace." }, 201);
  }
  await createOrg(c.env, { name: b.business, owner_email: email, owner_name: b.name, profile: Object.fromEntries(Object.entries({ what: b.what, customers: b.customers, area: b.area }).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()])), plan: "trial", by: "signup" });
  return c.json({ ok: true, message: "Check your email for a link to your new workspace." }, 201);
});

/* ---------- Developer keys and credits ---------- */
pub.post("/api-keys", async (c) => {
  await limitIp(c, "key", 3);
  const b = await body(c, z.object({ email: z.string().email() }));
  const raw = "ah_live_" + randomToken(24), id = newId("key");
  await run(c.env, "INSERT INTO api_key (id, key_hash, owner_email, kind, created_at) VALUES (?,?,?,?,?)", id, await sha256Hex(raw), b.email.toLowerCase(), "credits", nowIso());
  await sendMail(c.env, { to: b.email, subject: "Your Agent House API key", text: `Your API key: ${raw}\n\nIt is shown once; we only store a hash. It includes 100 free calls a month. Buy credits for more, or pay per call with x402.\nKey id: ${id}` });
  return c.json({ id, message: "Your key has been emailed to you. It is shown once." }, 201);
});

pub.post("/credits/checkout", async (c) => {
  const b = await body(c, z.object({ key_id: z.string(), pounds: z.number().int().min(10).max(1000) }));
  if (!(await one(c.env, "SELECT id FROM api_key WHERE id = ? AND revoked_at IS NULL", b.key_id))) throw notFound("API key");
  if (!c.env.STRIPE_SECRET) throw new HttpError(503, "billing_off", "Card payments aren't set up in this environment.");
  const s = await creditsCheckout(c.env, b.key_id, b.pounds);
  return c.json({ url: s.url });
});

pub.post("/unsubscribe", async (c) => {
  const b = await body(c, z.object({ email: z.string().email() }));
  await run(c.env, "INSERT OR IGNORE INTO suppression (email, reason, at) VALUES (?,?,?)", b.email.toLowerCase(), "unsubscribe", nowIso());
  return c.json({ ok: true });
});
