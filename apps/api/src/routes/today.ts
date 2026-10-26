// Workspace routes for Today (the home screen), batch approval, and house rules.
import type { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/db";
import { body, bad } from "../lib/http";
import { requireRole, type Vars } from "./auth";
import { executeAction, rejectAction } from "../lib/actions";
import { syncOrgSwarms } from "../lib/swarm";
import { todayState, addRule, decideRule, learnFromEdit } from "../lib/today";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const manager = requireRole("manager");

/** Run work after the response where the platform allows it (Workers), else before it (tests, local scripts). */
export async function later(c: any, p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("background step failed", e?.message || e));
  try { c.executionCtx.waitUntil(safe); } catch { await safe; }
}

export function registerTodayRoutes(ws: App) {
  ws.get("/today", async (c) => c.json(await todayState(c.env, c.get("orgId"))));

  /** Approve or reject many drafts at once. Each is decided on its own; one that fails doesn't stop the rest. */
  ws.post("/actions/batch", manager, async (c) => {
    const b = await body(c, z.object({ ids: z.array(z.string().min(1)).min(1).max(50), decision: z.enum(["approve", "reject"]) }));
    const results: { id: string; ok: boolean; status?: string; error?: string }[] = [];
    for (const id of [...new Set(b.ids)]) {
      try {
        if (b.decision === "approve") { const r: any = await executeAction(c.env, c.get("orgId"), id, c.get("user").email); results.push({ id, ok: true, status: r?.status }); }
        else { await rejectAction(c.env, c.get("orgId"), id, c.get("user").email); results.push({ id, ok: true, status: "rejected" }); }
      } catch (e: any) { results.push({ id, ok: false, error: e?.message || "Couldn't do that one." }); }
    }
    if (b.decision === "approve" && results.some((r) => r.ok)) await syncOrgSwarms(c.env, c.get("orgId"));
    return c.json({ done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  });

  /* ---------- House rules ---------- */
  ws.get("/rules", async (c) => {
    const rules = await c.get("db").all("SELECT id, text, source, status, action_id, created_at, decided_at FROM house_rule WHERE org_id = ?1 AND status != 'dismissed' ORDER BY status = 'proposed' DESC, created_at DESC LIMIT 100");
    return c.json({ rules });
  });
  ws.post("/rules", manager, async (c) => {
    const b = await body(c, z.object({ text: z.string().min(4).max(200) }));
    return c.json(await addRule(c.env, c.get("orgId"), b.text, c.get("user").email, "owner"));
  });
  ws.patch("/rules/:id", manager, async (c) => {
    const b = await body(c, z.object({ status: z.enum(["active", "dismissed"]).optional(), text: z.string().min(4).max(200).optional() }));
    if (!b.status && b.text === undefined) throw bad("Say what to change: the status or the text.");
    await decideRule(c.env, c.get("orgId"), c.req.param("id")!, c.get("user").email, b);
    return c.json({ ok: true });
  });
}

/** After an approval with edits: learn a house rule from what the owner changed, without holding up the send. */
export async function learnAfterApprove(c: any, actionId: string, before: { subject?: string; body?: string }, edits: { subject?: string; body?: string }) {
  if (!edits.subject && !edits.body) return;
  await later(c, learnFromEdit(c.env, c.get("orgId"), actionId, before, edits, c.get("user").email));
}
