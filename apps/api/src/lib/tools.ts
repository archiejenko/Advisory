// The tool catalogue. First-party tools are defined here; developer tools live in the `tool` table.
// The same registry serves businesses' agents, the developer API, MCP, and outside agents paying with x402.
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, all, run } from "./db";
import { HttpError } from "./http";
import { resolveInput, profileFields, checkInput } from "./truth";
import { companyCached } from "./registers";
import { webSearch, readPage } from "./web";
import { proposeEmail } from "./actions";
import { notifyChannel } from "./delivery";
import { unseal } from "./crypto";
import type { ToolDef } from "./llm";

export type ToolCtx = { env: Env; orgId?: string; agentId?: string; runId?: string };
export type Tool = {
  slug: string;
  name: string;
  description: string;
  input_schema: any;
  price_pence: number;                 // per call, for outside callers. Business agents use plan actions.
  audience: "public" | "business";
  run: (ctx: ToolCtx, input: any) => Promise<any>;
};

const S = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const need = (ctx: ToolCtx) => { if (!ctx.orgId || !ctx.agentId) throw new HttpError(403, "business_only", "This tool is only available to a business's own agents."); return ctx as Required<ToolCtx>; };
const text = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

/* ---------- First-party public tools ---------- */
const PUBLIC: Tool[] = [
  {
    slug: "uk-resolve", name: "Resolve a UK company", audience: "public", price_pence: 2,
    description: "Turn messy input (a name, website, invoice line or email signature) into ranked UK companies with a confidence score and reasons. Returns 'confirm' instead of guessing when more than one company fits.",
    input_schema: S({ input: str("What you have about the company") }, ["input"]),
    run: async ({ env }, i) => {
      const m = await resolveInput(env, text(i.input, 500));
      return { confidence: m.confidence, candidates: m.candidates.map((x) => ({ name: x.name, number: x.number, status: x.status, postcode: x.postcode, score: x.score, reasons: x.reasons })) };
    },
  },
  {
    slug: "uk-profile", name: "UK company profile", audience: "public", price_pence: 3,
    description: "Every field for one UK company by its 8-character Companies House number: status, filings, officers, people with significant control, charges, Gazette notices and FCA status, each with its source.",
    input_schema: S({ number: str("8-character Companies House number, e.g. 13985402") }, ["number"]),
    run: async ({ env }, i) => {
      const n = text(i.number, 8).toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(n)) throw new HttpError(400, "invalid_request", "Company numbers are 8 characters, for example 13985402.");
      const rec = await companyCached(env, n);
      if (!rec) throw new HttpError(404, "not_found", `Company ${n} not found.`);
      return profileFields(rec);
    },
  },
  {
    slug: "uk-check", name: "Check a UK company", audience: "public", price_pence: 5,
    description: "Resolve, profile and flag a UK company in one call: the moment before you pay, sign or onboard. Returns needs_human_confirmation instead of guessing when the match is uncertain.",
    input_schema: S({ input: str("A name, number, website or invoice line") }, ["input"]),
    run: async ({ env }, i) => checkInput(env, text(i.input, 2000)),
  },
  {
    slug: "find-companies", name: "Find UK companies", audience: "public", price_pence: 5,
    description: "Active UK companies by postcode district (e.g. M2, SK4), two-digit SIC industry code (e.g. 69 for legal and accounting) and minimum age in years. Up to 25 results.",
    input_schema: S({ districts: { type: "array", items: { type: "string" }, description: "Postcode districts, e.g. [\"M2\",\"M3\"]" }, sic: { type: "array", items: { type: "string" }, description: "Two-digit SIC codes, e.g. [\"69\",\"70\"]" }, min_age: { type: "integer", description: "Minimum company age in years" }, limit: { type: "integer", description: "At most 25" } }),
    run: async ({ env, orgId }, i) => {
      let districts: string[] = (i.districts || []).map((d: string) => String(d).toUpperCase().trim()).filter((d: string) => /^[A-Z]{1,2}\d{1,2}[A-Z]?$/.test(d)).slice(0, 40);
      let sic: string[] = (i.sic || []).map((s: string) => String(s).slice(0, 2)).filter((s: string) => /^\d{2}$/.test(s)).slice(0, 20);
      if (orgId && (!districts.length || !sic.length)) {
        const o = await one<any>(env, "SELECT prospect_districts, prospect_sic FROM org WHERE id = ?", orgId);
        if (!districts.length) districts = JSON.parse(o?.prospect_districts || "[]");
        if (!sic.length) sic = JSON.parse(o?.prospect_sic || "[]");
      }
      if (!districts.length) throw new HttpError(400, "invalid_request", "Give at least one postcode district, for example M2.");
      const limit = Math.min(25, Math.max(1, Number(i.limit) || 10));
      const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Math.max(0, Number(i.min_age) || 0));
      const dq = districts.map(() => "?").join(",");
      const sq = sic.length ? "AND (" + sic.map(() => "substr(sic,1,2) = ?").join(" OR ") + ")" : "";
      const notMine = orgId ? "AND number NOT IN (SELECT number FROM client WHERE org_id = ?) AND name NOT IN (SELECT upper(company) FROM lead WHERE org_id = ?)" : "";
      const rows = await all<any>(env, `SELECT name, number, district, postcode, sic, incorporated FROM company_index WHERE status = 'Active' AND district IN (${dq}) ${sq} AND incorporated <= ? ${notMine} ORDER BY incorporated LIMIT ?`,
        ...districts, ...sic, cutoff.toISOString().slice(0, 10), ...(orgId ? [orgId, orgId] : []), limit);
      return { companies: rows, source: "Companies House monthly snapshot" };
    },
  },
  {
    slug: "web-research", name: "Web research", audience: "public", price_pence: 3,
    description: "Search the web for a question and get ranked results with titles, links and snippets. Use read-page to read a result in full.",
    input_schema: S({ query: str("What to search for"), count: { type: "integer", description: "1 to 10 results" } }, ["query"]),
    run: async ({ env }, i) => ({ query: text(i.query, 300), results: await webSearch(env, text(i.query, 300), Math.min(10, Math.max(1, Number(i.count) || 6))) }),
  },
  {
    slug: "read-page", name: "Read a web page", audience: "public", price_pence: 1,
    description: "The readable text of one public web page, its title, and any email addresses published on it.",
    input_schema: S({ url: str("Full https URL") }, ["url"]),
    run: async ({ env }, i) => readPage(env, text(i.url, 2000)),
  },
  {
    slug: "company-research", name: "Company research", audience: "public", price_pence: 8,
    description: "One sourced brief on a UK company: the register check (status, filings, flags) plus the top web results about it, including its likely website.",
    input_schema: S({ input: str("A company name, number or website") }, ["input"]),
    run: async ({ env }, i) => {
      const input = text(i.input, 500);
      const reg: any = await checkInput(env, input);
      const name = reg.match?.name || input;
      let web: any[] = [];
      try { web = await webSearch(env, `${name} UK`, 6); } catch (e: any) { web = [{ error: e.message }]; }
      const site = web.find((r) => r.url && !/companieshouse|gov\.uk|linkedin|facebook|endole|opencorporates|yell\.com/.test(r.url));
      return {
        register: reg.status === "matched" ? { name: reg.match.name, number: reg.match.number, flags: reg.flags, rows: reg.rows } : { status: reg.status, message: reg.message, candidates: reg.candidates },
        likely_website: site?.url || null,
        web,
      };
    },
  },
];

/* ---------- Tools only a business's own agents can use ---------- */
const BUSINESS: Tool[] = [
  {
    slug: "business-profile", name: "Business profile", audience: "business", price_pence: 0,
    description: "Who you work for: the business name, what it does, its customers, area, tone and sign-off.",
    input_schema: S({}),
    run: async (c) => {
      const { env, orgId } = need(c);
      const o = await one<any>(env, "SELECT name, profile, prospect_districts, prospect_sic FROM org WHERE id = ?", orgId);
      return { name: o.name, ...JSON.parse(o.profile || "{}"), prospect_districts: JSON.parse(o.prospect_districts), prospect_sic: JSON.parse(o.prospect_sic) };
    },
  },
  {
    slug: "list-leads", name: "List leads", audience: "business", price_pence: 0,
    description: "Leads already saved, newest first, with status, email and when they were last contacted.",
    input_schema: S({ status: str("Optional: new, contacted, replied, won, lost, unsubscribed") }),
    run: async (c, i) => {
      const { env, orgId } = need(c);
      const rows = await all<any>(env, `SELECT id, company, number, email, website, status, last_contact_at, created_at,
        (SELECT COUNT(*) FROM agent_action a WHERE a.org_id = lead.org_id AND a.status = 'sent' AND json_extract(a.payload, '$.lead_id') = lead.id) AS emails_sent
        FROM lead WHERE org_id = ? ${i.status ? "AND status = ?" : ""} ORDER BY created_at DESC LIMIT 100`, orgId, ...(i.status ? [i.status] : []));
      return { leads: rows };
    },
  },
  {
    slug: "save-lead", name: "Save a lead", audience: "business", price_pence: 0,
    description: "Save or update a lead. Only include an email that is published on the company's own website.",
    input_schema: S({ company: str("Company name"), number: str("Companies House number, if known"), email: str("Published business email, if found"), contact_name: str("Contact name, if published"), website: str("Website URL"), notes: str("Why they fit, in one line") }, ["company"]),
    run: async (c, i) => {
      const { env, orgId, agentId } = need(c);
      const company = text(i.company, 200);
      if (!company) throw new HttpError(400, "invalid_request", "A lead needs a company name.");
      const email = i.email ? text(i.email, 200).toLowerCase() : null;
      if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "invalid_email", "That isn't a valid email address.");
      const existing = await one<any>(env, "SELECT id FROM lead WHERE org_id = ? AND company = ?", orgId, company);
      if (existing) {
        await run(env, "UPDATE lead SET number = COALESCE(?, number), email = COALESCE(?, email), contact_name = COALESCE(?, contact_name), website = COALESCE(?, website), notes = COALESCE(?, notes) WHERE id = ?",
          i.number ?? null, email, i.contact_name ?? null, i.website ?? null, i.notes ?? null, existing.id);
        return { lead_id: existing.id, created: false };
      }
      const id = newId("lead");
      await run(env, "INSERT INTO lead (id, org_id, agent_id, company, number, contact_name, email, website, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        id, orgId, agentId, company, i.number ?? null, i.contact_name ?? null, email, i.website ?? null, i.notes ? text(i.notes, 500) : null, nowIso());
      return { lead_id: id, created: true };
    },
  },
  {
    slug: "list-invoices", name: "List invoices", audience: "business", price_pence: 0,
    description: "Unpaid invoices with amount, due date, days overdue, reminders sent and the last reminder date.",
    input_schema: S({ overdue_only: { type: "boolean" } }),
    run: async (c, i) => {
      const { env, orgId } = need(c);
      const today = nowIso().slice(0, 10);
      const rows = await all<any>(env, `SELECT id, ref, customer, email, amount_pence, due_date, reminders, last_reminder_at,
        CAST(julianday(?) - julianday(due_date) AS INTEGER) AS days_overdue FROM invoice WHERE org_id = ? AND status = 'unpaid' ${i.overdue_only ? "AND due_date < ?" : ""} ORDER BY due_date`,
        today, orgId, ...(i.overdue_only ? [today] : []));
      return { today, invoices: rows.map((r) => ({ ...r, amount: "£" + (r.amount_pence / 100).toFixed(2) })) };
    },
  },
  {
    slug: "list-inbox", name: "List inbox", audience: "business", price_pence: 0,
    description: "New messages in the business's enquiries inbox.",
    input_schema: S({ status: str("new (default), triaged, replied or ignored") }),
    run: async (c, i) => {
      const { env, orgId } = need(c);
      return { messages: await all<any>(env, "SELECT id, from_addr, subject, body, received_at FROM inbox_message WHERE org_id = ? AND status = ? ORDER BY received_at LIMIT 20", orgId, i.status || "new") };
    },
  },
  {
    slug: "triage-message", name: "Triage a message", audience: "business", price_pence: 0,
    description: "Record a message's urgency, category and one-line summary.",
    input_schema: S({ id: str("Message id"), urgency: { type: "string", enum: ["high", "normal", "low"] }, category: { type: "string", enum: ["quote", "booking", "question", "complaint", "supplier", "spam", "other"] }, summary: str("One line") }, ["id", "urgency", "category", "summary"]),
    run: async (c, i) => {
      const { env, orgId } = need(c);
      const r = await run(env, "UPDATE inbox_message SET status = CASE WHEN ? = 'spam' THEN 'ignored' ELSE 'triaged' END, urgency = ?, category = ?, summary = ? WHERE id = ? AND org_id = ?", i.category, i.urgency, i.category, text(i.summary, 300), i.id, orgId);
      if (!r.meta.changes) throw new HttpError(404, "not_found", "No message with that id.");
      return { ok: true };
    },
  },
  {
    slug: "propose-email", name: "Propose an email", audience: "business", price_pence: 0,
    description: "Draft an email for the owner to approve (or send it, if the owner has allowed this agent to). Pass lead_id, invoice_id or message_id when it relates to one. Never guess an address.",
    input_schema: S({ to: str("Recipient email"), subject: str("Subject"), body: str("Plain text body, signed off as the business"), lead_id: str("Lead id, for outreach"), invoice_id: str("Invoice id, for reminders"), message_id: str("Inbox message id, for replies"), reason: str("One line: why this email") }, ["to", "subject", "body"]),
    run: async (c, i) => { const { env, orgId, agentId, runId } = need(c); return proposeEmail(env, { orgId, agentId, runId }, i); },
  },
  {
    slug: "create-task", name: "Create a task", audience: "business", price_pence: 0,
    description: "Give the owner a task: something only a person can do.",
    input_schema: S({ title: str("Short task"), detail: str("What's needed and why"), due_date: str("YYYY-MM-DD, optional") }, ["title"]),
    run: async (c, i) => {
      const { env, orgId, agentId } = need(c);
      const id = newId("task");
      await run(env, "INSERT INTO task (id, org_id, agent_id, title, detail, due_date, created_at) VALUES (?,?,?,?,?,?,?)", id, orgId, agentId, text(i.title, 200), i.detail ? text(i.detail, 1000) : null, /^\d{4}-\d{2}-\d{2}$/.test(i.due_date || "") ? i.due_date : null, nowIso());
      return { task_id: id };
    },
  },
  {
    slug: "notify-owner", name: "Notify the owner", audience: "business", price_pence: 0,
    description: "Send the owner a short note on the agent's channel (Teams, Slack or email).",
    input_schema: S({ text: str("The note, a few lines at most") }, ["text"]),
    run: async (c, i) => {
      const { env, orgId, agentId } = need(c);
      const a = await one<any>(env, "SELECT name, channel_id FROM agent WHERE id = ?", agentId);
      return { status: await notifyChannel(env, orgId, a?.channel_id ?? null, `${a?.name || "Agent"}: note from Agent House`, text(i.text, 3000)) };
    },
  },
  {
    slug: "recent-activity", name: "Recent activity", audience: "business", price_pence: 0,
    description: "What happened in the last few days: agent runs, actions by status, open tasks, new leads, overdue invoices and open alerts.",
    input_schema: S({ days: { type: "integer" } }),
    run: async (c, i) => {
      const { env, orgId } = need(c);
      const since = new Date(Date.now() - Math.min(31, Number(i.days) || 7) * 864e5).toISOString();
      const one1 = async (sql: string, ...a: any[]) => (await one<any>(env, sql, ...a))?.n || 0;
      return {
        since,
        runs: await all<any>(env, "SELECT g.name AS agent, COUNT(*) AS runs, SUM(r.tool_calls) AS tool_calls FROM agent_run r JOIN agent g ON g.id = r.agent_id WHERE r.org_id = ? AND r.created_at >= ? GROUP BY g.name", orgId, since),
        actions: await all<any>(env, "SELECT status, COUNT(*) AS n FROM agent_action WHERE org_id = ? AND created_at >= ? GROUP BY status", orgId, since),
        waiting_for_approval: await one1("SELECT COUNT(*) AS n FROM agent_action WHERE org_id = ? AND status = 'proposed'", orgId),
        open_tasks: await all<any>(env, "SELECT title, due_date FROM task WHERE org_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 10", orgId),
        new_leads: await one1("SELECT COUNT(*) AS n FROM lead WHERE org_id = ? AND created_at >= ?", orgId, since),
        overdue_invoices: await one1("SELECT COUNT(*) AS n FROM invoice WHERE org_id = ? AND status = 'unpaid' AND due_date < ?", orgId, nowIso().slice(0, 10)),
        open_alerts: await all<any>(env, "SELECT title, severity FROM alert WHERE org_id = ? AND state = 'open' ORDER BY created_at DESC LIMIT 10", orgId),
      };
    },
  },
];

const BUILTIN = new Map([...PUBLIC, ...BUSINESS].map((t) => [t.slug, t]));
export const usdcFor = (pence: number) => String(Math.max(1, pence) * 12500);   // 1p ≈ 0.0125 USDC

/* ---------- Developer tools: proxied with a signed request ---------- */
async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function devTool(row: any): Tool {
  return {
    slug: row.slug, name: row.name, description: row.description, input_schema: JSON.parse(row.input_schema), price_pence: row.price_pence, audience: "public",
    run: async ({ env }, input) => {
      const body = JSON.stringify({ tool: row.slug, input });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = await hmacHex(await unseal(env, row.secret_enc), `${ts}.${body}`);
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
      let res: Response;
      try { res = await fetch(row.endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-AgentHouse-Timestamp": ts, "X-AgentHouse-Signature": "v1=" + sig, "User-Agent": "AgentHouse-Gateway/1.0" }, body, signal: ctl.signal }); }
      catch { throw new HttpError(504, "tool_timeout", `${row.name} didn't respond in time. You have not been charged.`); }
      finally { clearTimeout(t); }
      if (!res.ok) throw new HttpError(502, "tool_failed", `${row.name} returned ${res.status}. You have not been charged.`);
      try { return await res.json(); } catch { throw new HttpError(502, "tool_failed", `${row.name} didn't return JSON. You have not been charged.`); }
    },
  };
}
export { hmacHex };

export async function getTool(env: Env, slug: string, opts: { business?: boolean } = {}): Promise<Tool | null> {
  const b = BUILTIN.get(slug);
  if (b) return b.audience === "business" && !opts.business ? null : b;
  const row = await one<any>(env, "SELECT * FROM tool WHERE slug = ? AND status = 'live'", slug);
  return row ? devTool(row) : null;
}

/** The public catalogue: first-party public tools and live developer tools. */
export async function catalogue(env: Env) {
  const dev = await all<any>(env, "SELECT * FROM tool WHERE status = 'live' ORDER BY calls DESC, slug");
  return [...PUBLIC.map((t) => ({ t, publisher: "Agent House" })), ...dev.map((r) => ({ t: devTool(r), publisher: "Developer" }))];
}

export function toolDefs(tools: Tool[]): ToolDef[] {
  return tools.map((t) => ({ name: t.slug, description: t.description, input_schema: t.input_schema }));
}
export const builtin = (slug: string) => BUILTIN.get(slug);
export const PUBLIC_TOOLS = PUBLIC;

/** Validate input loosely against the schema's required fields, then run. */
export async function runTool(ctx: ToolCtx, tool: Tool, input: any) {
  const inp = input && typeof input === "object" ? input : {};
  for (const r of tool.input_schema.required || []) if (inp[r] === undefined || inp[r] === "") throw new HttpError(400, "invalid_request", `${tool.slug} needs "${r}".`);
  return tool.run(ctx, inp);
}

/** Record a developer tool's earnings: the publisher gets 80% of what the caller paid. */
export async function creditPublisher(env: Env, slug: string, gross: number, payment: string) {
  const row = await one<any>(env, "SELECT owner_key_id FROM tool WHERE slug = ?", slug);
  if (!row) return;
  await run(env, "UPDATE tool SET calls = calls + 1 WHERE slug = ?", slug);
  if (gross > 0) await run(env, "INSERT INTO tool_earning (id, tool_slug, owner_key_id, gross_pence, share_pence, payment, at) VALUES (?,?,?,?,?,?,?)", newId("earn"), slug, row.owner_key_id, gross, Math.floor(gross * 0.8), payment, nowIso());
}
