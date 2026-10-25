// Email magic-link sign-in and sessions. The org id always comes from the session, never the request.
import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { nowIso, randomToken, sha256Hex } from "../../../../packages/core/util";
import { type Env, one, run, audit, Scoped } from "../lib/db";
import { body, HttpError, forbidden } from "../lib/http";
import { sendMail } from "../lib/mail";
import { limitIp, limitEmail } from "../lib/limits";

export type Vars = { user: { id: string; email: string; name: string | null }; orgId: string; role: "owner" | "manager" | "viewer"; db: Scoped };
const COOKIE = "ah_session";
const SESSION_DAYS = 14;

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>();

auth.post("/magic-link", async (c) => {
  const { email } = await body(c, z.object({ email: z.string().email() }));
  // At most 10 requests an hour from one network, and 3 links an hour to one address, so nobody can flood an inbox.
  await limitIp(c, "magic", 10);
  const user = await one<any>(c.env, "SELECT * FROM user WHERE email = ?", email.toLowerCase());
  // Same response whether or not the address has an account (or has hit its limit), so nobody can probe for customers.
  if (user && (await limitEmail(c.env, "link", user.email, 3))) {
    const token = randomToken();
    await run(c.env, "INSERT INTO magic_link (token_hash, email, expires_at) VALUES (?,?,?)", await sha256Hex(token), user.email, new Date(Date.now() + 15 * 60000).toISOString());
    await sendMail(c.env, { kind: "transactional", to: user.email, subject: "Your Agent House sign-in link", text: `Sign in to Agent House: ${c.env.APP_URL}#/sign-in?token=${token}\n\nThis link works once and expires in 15 minutes.` });
  }
  return c.json({ sent: true, message: "If that address has an account, a sign-in link is on its way." });
});

auth.post("/session", async (c) => {
  const { token } = await body(c, z.object({ token: z.string().min(10) }));
  const hash = await sha256Hex(token);
  // Claim the link in one statement, so two requests racing with the same link can't both sign in.
  const now = nowIso();
  const link = await one<any>(c.env, "UPDATE magic_link SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email", now, hash, now);
  if (!link) throw new HttpError(400, "link_expired", "That sign-in link has expired or been used. Request a new one.");
  const user = await one<any>(c.env, "SELECT * FROM user WHERE email = ?", link.email);
  if (!user) throw new HttpError(400, "link_expired", "That sign-in link has expired or been used. Request a new one.");
  const m = await one<any>(c.env, "SELECT * FROM membership WHERE user_id = ? ORDER BY role = 'owner' DESC LIMIT 1", user.id);
  if (!m) throw forbidden("Your account isn't part of a workspace yet.");
  const sid = randomToken(32);
  await run(c.env, "INSERT INTO session (id_hash, user_id, org_id, expires_at) VALUES (?,?,?,?)", await sha256Hex(sid), user.id, m.org_id, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  setCookie(c, COOKIE, sid, { httpOnly: true, secure: c.env.COOKIE_SECURE !== "false", sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  await audit(c.env, m.org_id, user.id, "sign_in");
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  const sid = getCookie(c, COOKIE);
  if (sid) await run(c.env, "DELETE FROM session WHERE id_hash = ?", await sha256Hex(sid));
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

export async function requireSession(c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) {
  const sid = getCookie(c, COOKIE);
  if (!sid) throw new HttpError(401, "signed_out", "Sign in to use the workspace.");
  const s = await one<any>(c.env, "SELECT s.*, u.email, u.name FROM session s JOIN user u ON u.id = s.user_id WHERE s.id_hash = ?", await sha256Hex(sid));
  if (!s || s.expires_at < nowIso()) throw new HttpError(401, "signed_out", "Your session has ended. Sign in again.");
  const m = await one<any>(c.env, "SELECT role FROM membership WHERE org_id = ? AND user_id = ?", s.org_id, s.user_id);
  if (!m) throw new HttpError(401, "signed_out", "You no longer have access to this workspace.");
  if (c.env.WS_LIMITER) {
    const { success } = await c.env.WS_LIMITER.limit({ key: s.org_id });
    if (!success) throw new HttpError(429, "slow_down", "Too many requests from this workspace. Wait a minute and try again.");
  }
  c.set("user", { id: s.user_id, email: s.email, name: s.name });
  c.set("orgId", s.org_id);
  c.set("role", m.role);
  c.set("db", new Scoped(c.env, s.org_id));
  await next();
}

const RANK = { viewer: 0, manager: 1, owner: 2 } as const;
export const requireRole = (min: keyof typeof RANK) => async (c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) => {
  if (RANK[c.get("role")] < RANK[min]) throw forbidden(`Only ${min === "owner" ? "an owner" : "a manager or owner"} can do that.`);
  await next();
};
