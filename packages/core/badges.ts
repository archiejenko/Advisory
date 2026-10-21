// The org chart: badges that set what each agent is and does, and the rules for changing them.
// One source for the API (which checks and saves changes) and the website (which checks them as you drag),
// so a change the Org view allows is a change the server accepts.

export type BadgeKind = "role" | "skill" | "autonomy" | "rhythm";
export type Skill = { key: string; label: string; tools: string[]; about: string };
export type Role = { key: string; label: string; needs: string[]; about: string; orders: string; fixed?: boolean };

/** Tools an orchestrator or a lead uses to run its team. Only those roles may hold the Planning skill. */
export const PLANNING_TOOLS = ["list-team", "assign-task", "check-tasks"];
/** Every badge-built agent gets these, whatever its skills. Swarm agents also get the swarm tools. */
export const BASE_TOOLS = ["business-profile", "create-task"];
/** How many levels of agents may sit below the orchestrator. */
export const MAX_DEPTH = 2;

export const SKILLS: Skill[] = [
  { key: "planning", label: "Planning", tools: PLANNING_TOOLS, about: "Splits goals into tasks, assigns them and checks they finish" },
  { key: "prospecting", label: "Prospecting", tools: ["find-companies", "company-research", "read-page", "list-leads", "save-lead"], about: "Finds and qualifies companies" },
  { key: "research", label: "Research", tools: ["web-research", "read-page", "company-research"], about: "Searches the web and reads pages, with sources" },
  { key: "email", label: "Email", tools: ["propose-email"], about: "Drafts emails; autonomy decides which send without you" },
  { key: "crm", label: "CRM", tools: ["list-leads", "save-lead"], about: "Reads and updates companies, contacts and deals" },
  { key: "inbox", label: "Inbox", tools: ["list-inbox", "triage-message"], about: "Reads and labels inbound mail" },
  { key: "cash", label: "Cash", tools: ["list-invoices"], about: "Reads invoices, what's overdue and what's been chased" },
  { key: "registers", label: "Registers", tools: ["uk-check", "uk-resolve", "uk-profile"], about: "Checks UK companies on the public registers" },
  { key: "reporting", label: "Reporting", tools: ["recent-activity", "notify-owner"], about: "Sums up what happened and tells the owner" },
];

const FINISH = "When you were given a task, finish-task with its id and a one-line result. If you can't do it, finish-task as blocked and say what's missing. Anything that needs the owner goes in create-task.";

export const ROLES: Role[] = [
  {
    key: "orchestrator", label: "Orchestrator", needs: ["planning"], fixed: true, about: "Breaks goals into tasks, assigns them and checks they finish",
    orders: `You lead this swarm of agents for a small UK business. Each run:
1. list-team to see who does what, their open tasks, and anything blocked.
2. check-tasks for the tasks you assigned: note what finished, what is blocked and why.
3. Decide the next most useful work toward the swarm's goals. Assign at most 3 tasks with assign-task, each to the agent whose role and skills fit, with a clear title and the detail it needs. Don't give an agent work it already has open, and don't repeat a task that is blocked for a reason only the owner can fix.
4. If something needs the owner (a decision, a missing contact, money, anything outside the agents' tools), create-task for the owner instead of guessing.
Never send email yourself. Finish with a short summary: what you assigned, to whom, and what you need from the owner.`,
  },
  {
    key: "lead", label: "Lead", needs: ["planning"], about: "Runs a small team under the orchestrator",
    orders: `You run a small team under the swarm's orchestrator. Each run:
1. list-team to see your team and their open tasks; check-tasks for what you assigned.
2. Split the work you were given into tasks for your team with assign-task (at most 3), each to the agent whose skills fit.
3. Do any part your own skills cover.
${FINISH}`,
  },
  {
    key: "prospector", label: "Prospector", needs: ["prospecting"], about: "Finds and qualifies companies",
    orders: `You find new prospects for a small UK business. Each run:
1. Read the business profile.
2. find-companies for up to 3 companies that match the ideal customer; skip any already in list-leads.
3. For each, company-research, then read-page on its website. Note one specific reason it would buy.
4. save-lead with the published business email if there is one (never guess an address).
5. If a lead has an email and you can hand off, hand-off its card with your reason as the note; if not, create-task for the owner to find a contact.
${FINISH}`,
  },
  {
    key: "writer", label: "Writer", needs: ["email"], about: "Writes first emails and follow-ups",
    orders: `You write emails for a small UK business. For each lead or task you are given:
1. Read the business profile and what is known about the company.
2. propose-email a message under 120 words: plain text, one specific reason they would care, one question, signed off as the business. No hype, no claims you can't back. Never invent an address.
3. For a lead contacted 5 or more days ago with no reply and one email sent, propose one short follow-up.
${FINISH}`,
  },
  {
    key: "inbox-keeper", label: "Inbox keeper", needs: ["inbox", "email"], about: "Sorts mail and drafts replies",
    orders: `You look after the business's inbox. Each run:
1. list-inbox, then triage-message for each new message: urgency, category and a one-line summary.
2. For enquiries and customer questions, propose-email a short, helpful reply in the business's tone. Ask for what you need rather than guessing prices or dates.
3. For anything about money, complaints or legal matters, create-task for the owner as well.
${FINISH}`,
  },
  {
    key: "credit-controller", label: "Credit controller", needs: ["cash", "email"], about: "Chases overdue invoices politely",
    orders: `You chase money owed to the business. Each run:
1. list-invoices with overdue_only.
2. For each overdue invoice with an email and fewer than 3 reminders, propose-email a polite reminder: the invoice number, amount and due date, and a question about when to expect payment. Firmer from the second reminder, never rude.
3. After 3 reminders, create-task for the owner to call.
${FINISH}`,
  },
  {
    key: "analyst", label: "Analyst", needs: ["research"], about: "Answers questions with sources",
    orders: `You answer the business's questions with evidence. For each question or task:
1. web-research, then read-page on the best two or three results; use the registers for UK companies when you have them.
2. Answer in a few short lines with the facts that matter, then "Sources:" and the URLs you actually read.
Never present a guess as a fact.
${FINISH}`,
  },
  {
    key: "reporter", label: "Reporter", needs: ["reporting"], about: "Writes the weekly note",
    orders: `You keep the owner informed. Call recent-activity, then notify-owner once with at most 8 short lines: first what needs a decision, then what the agents did, with numbers. No fluff.
${FINISH}`,
  },
  {
    key: "assistant", label: "Assistant", needs: [], about: "Does the tasks it is given with whatever skills it has",
    orders: `You help a small UK business with the tasks you are given. Use only your tools; never invent facts, names or addresses.
${FINISH}`,
  },
  { key: "register", label: "Register agent", needs: [], fixed: true, about: "Runs from the public registers on its own schedule", orders: "" },
];

export const AUTONOMY = [
  { key: "approve_all", label: "Ask me", about: "Every email waits for you" },
  { key: "approve_first", label: "After the first", about: "Follow-ups go once you approved the first" },
  { key: "auto", label: "Auto", about: "Sends to the record's own contact without asking" },
];
export const RHYTHMS = [
  { key: "weekdays", label: "Weekdays" }, { key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" }, { key: "on_event", label: "On event" }, { key: "on_demand", label: "On demand" },
];

export const skill = (k: string) => SKILLS.find((s) => s.key === k);
export const role = (k: string) => ROLES.find((r) => r.key === k);
export const needsOf = (roleKey: string) => role(roleKey)?.needs || [];
const uniq = <T,>(a: T[]) => [...new Set(a)];

/** The tools an agent with these badges may use (before the swarm tools are added). */
export function toolsFor(roleKey: string, skills: string[]) {
  const planning = roleKey === "orchestrator" || roleKey === "lead";
  return uniq([...BASE_TOOLS, ...skills.flatMap((s) => skill(s)?.tools || [])]).filter((t) => planning || !PLANNING_TOOLS.includes(t));
}

/** Badges for an agent that has never been given any: read from its template, or from a custom role's tools. */
const TEMPLATE_BADGES: Record<string, { role: string; skills: string[] }> = {
  orchestrator: { role: "orchestrator", skills: ["planning", "reporting"] },
  outreach: { role: "writer", skills: ["prospecting", "research", "email"] },
  inbox: { role: "inbox-keeper", skills: ["inbox", "email", "reporting"] },
  "credit-control": { role: "credit-controller", skills: ["cash", "email", "reporting"] },
  research: { role: "analyst", skills: ["research", "registers", "prospecting"] },
  briefing: { role: "reporter", skills: ["reporting"] },
};
export function defaultBadges(a: { template: string; tools?: string[] | null; engine?: string }): { role: string; skills: string[] } {
  if (TEMPLATE_BADGES[a.template]) return TEMPLATE_BADGES[a.template];
  if (a.engine && a.engine !== "llm") return { role: "register", skills: [] };
  const tools = a.tools || [];
  const skills = SKILLS.filter((s) => s.key !== "planning" && s.tools.some((t) => tools.includes(t))).map((s) => s.key);
  const r = ROLES.find((x) => !x.fixed && x.key !== "lead" && x.key !== "assistant" && x.needs.length && x.needs.every((n) => skills.includes(n)));
  return { role: r?.key || "assistant", skills };
}

/* ---------- Changing the team ---------- */

export type OrgAgent = {
  id: string; name: string; role: string; skills: string[]; autonomy: string; rhythm: string;
  reports_to: string | null;     // an agent id; null only for the orchestrator (or every agent when there is none)
  locked?: boolean;              // register agents: badges are fixed
  stages?: string[];             // board stages it owns, by name
  status?: string;
};
export type OrgChange =
  | { op: "role"; agent: string; value: string }
  | { op: "skill"; agent: string; value: string; from?: string }
  | { op: "unskill"; agent: string; value: string }
  | { op: "autonomy"; agent: string; value: string }
  | { op: "rhythm"; agent: string; value: string }
  | { op: "reports_to"; agent: string; value: string }
  | { op: "hire"; id: string; role: string; name?: string; reports_to?: string }
  | { op: "remove"; agent: string };
export type OrgLimits = { agents_used: number; agents_allowed: number };
export type OrgResult = { ok: true; agents: OrgAgent[]; summaries: string[]; hires: number } | { ok: false; error: string; index: number };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const KIND_WORD: Record<string, string> = { role: "role", autonomy: "autonomy setting", rhythm: "rhythm" };
export const rootOf = (agents: OrgAgent[]) => agents.find((a) => a.role === "orchestrator") || null;
export function depthOf(agents: OrgAgent[], id: string) {
  let d = 0, a = agents.find((x) => x.id === id);
  const seen = new Set<string>();
  while (a && a.reports_to && !seen.has(a.id)) { seen.add(a.id); const boss = agents.find((x) => x.id === a!.reports_to); if (!boss || boss.role === "orchestrator") break; d++; a = boss; }
  return d + 1; // 1 = reports straight to the orchestrator
}
export const teamOf = (agents: OrgAgent[], id: string) => agents.filter((a) => a.reports_to === id);
export function isUnder(agents: OrgAgent[], id: string, bossId: string) {
  let a = agents.find((x) => x.id === id); const seen = new Set<string>();
  while (a && a.reports_to && !seen.has(a.id)) { if (a.reports_to === bossId) return true; seen.add(a.id); a = agents.find((x) => x.id === a!.reports_to); }
  return false;
}

/**
 * Apply a list of changes, all or nothing. Returns the new team and one plain sentence per change, or the first
 * change that can't be made and why. Pure: no IDs are minted here except the caller's own hire ids.
 */
export function applyOrgChanges(start: OrgAgent[], changes: OrgChange[], limits: OrgLimits): OrgResult {
  const agents = clone(start);
  const summaries: string[] = [];
  let used = limits.agents_used, hires = 0;
  const find = (id: string) => agents.find((a) => a.id === id);
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i] as any;
    const fail = (error: string): OrgResult => ({ ok: false, error, index: i });
    if (c.op === "hire") {
      const r = role(c.role);
      if (!r || r.key === "register") return fail("Choose a role for the new agent.");
      if (r.key === "orchestrator" && rootOf(agents)) return fail("There is one orchestrator, and it stays at the top of the tree.");
      if (r.key !== "orchestrator" && used >= limits.agents_allowed) return fail(`Your plan includes ${limits.agents_allowed} agents. Remove one, or move to a bigger plan.`);
      if (find(c.id)) return fail("That agent already exists.");
      const root = rootOf(agents);
      const boss = c.reports_to ? find(c.reports_to) : root;
      if (c.reports_to && !boss) return fail("Choose who the new agent reports to.");
      if (boss && boss.role !== "orchestrator" && boss.role !== "lead") return fail(`Make ${boss.name} a Lead first, or hire the new agent under the orchestrator.`);
      if (boss && boss.role !== "orchestrator" && depthOf(agents, boss.id) >= MAX_DEPTH) return fail(`Teams go at most ${MAX_DEPTH} levels below the orchestrator.`);
      const name = String(c.name || r.label).slice(0, 40);
      agents.push({ id: c.id, name, role: r.key, skills: [...r.needs], autonomy: "approve_all", rhythm: "weekdays", reports_to: r.key === "orchestrator" ? null : boss?.id ?? null, stages: [] });
      if (r.key === "orchestrator") { for (const a of agents) if (a.id !== c.id && !a.reports_to) a.reports_to = c.id; summaries.push("Added an orchestrator at the top of the tree."); }
      else { used++; hires++; summaries.push(`Hired ${/^[aeiou]/i.test(r.label) ? "an" : "a"} ${r.label}${boss ? ` reporting to ${boss.name}` : ""}.`); }
      continue;
    }
    const a = find(c.agent);
    if (!a) return fail("That agent isn't in this swarm any more.");
    const isRoot = a.role === "orchestrator";
    if (a.locked && c.op !== "reports_to" && c.op !== "remove") return fail(`${a.name} runs from the registers, so its badges are fixed. You can move it or remove it.`);
    if (c.op === "role") {
      const r = role(c.value);
      if (!r || r.key === "register") return fail("That isn't a role.");
      if (r.key === "orchestrator") return fail("There is one orchestrator, and it stays at the top of the tree.");
      if (isRoot) return fail("The orchestrator's role is fixed. Give it skills or a rhythm instead.");
      if (a.role === r.key) return fail(`${a.name} is already ${/^[aeiou]/i.test(r.label) ? "an" : "a"} ${r.label}.`);
      if (r.key !== "lead" && teamOf(agents, a.id).length) return fail(`${a.name} has agents reporting to it, so it has to stay a Lead. Move its team first.`);
      const added = r.needs.filter((n) => !a.skills.includes(n));
      if (r.key !== "lead") a.skills = a.skills.filter((s) => s !== "planning");
      a.role = r.key; a.skills.push(...added);
      summaries.push(`${a.name} is now ${/^[aeiou]/i.test(r.label) ? "an" : "a"} ${r.label}${added.length ? ` (+${added.map((n) => skill(n)!.label).join(", ")})` : ""}.`);
    } else if (c.op === "skill") {
      const s = skill(c.value);
      if (!s) return fail("That isn't a skill.");
      if (a.skills.includes(s.key)) return fail(`${a.name} already has ${s.label}.`);
      if (s.key === "planning" && a.role !== "lead" && !isRoot) return fail(`Planning is for the orchestrator and Lead roles. Make ${a.name} a Lead first.`);
      if (isRoot && !["planning", "reporting", "research"].includes(s.key)) return fail("The orchestrator plans and reports. It hands the work itself to the team.");
      if (c.from) {
        const src = find(c.from);
        if (!src || !src.skills.includes(s.key)) return fail(`${s.label} isn't on that agent any more.`);
        if (needsOf(src.role).includes(s.key)) return fail(`${src.name}'s role needs ${s.label}, so it can't move.`);
        src.skills = src.skills.filter((x) => x !== s.key);
        a.skills.push(s.key);
        summaries.push(`Moved ${s.label} from ${src.name} to ${a.name}.`);
      } else {
        a.skills.push(s.key);
        summaries.push(`${a.name} can now use ${s.label} (+${s.tools.length} tools).`);
      }
    } else if (c.op === "unskill") {
      const s = skill(c.value);
      if (!s || !a.skills.includes(s.key)) return fail(`${a.name} doesn't have that skill.`);
      if (needsOf(a.role).includes(s.key)) return fail(`${a.name}'s role needs ${s.label}. Change its role first.`);
      a.skills = a.skills.filter((x) => x !== s.key);
      summaries.push(`${a.name} no longer has ${s.label}.`);
    } else if (c.op === "autonomy") {
      const v = AUTONOMY.find((x) => x.key === c.value);
      if (!v) return fail("That isn't an autonomy setting.");
      if (isRoot) return fail("The orchestrator never sends email, so it has no autonomy setting.");
      if (a.autonomy === v.key) return fail(`${a.name} is already on ${v.label}.`);
      a.autonomy = v.key;
      summaries.push(`${a.name}: ${v.label}${v.key === "auto" && !a.skills.includes("email") ? " (it has no Email skill yet)" : ""}.`);
    } else if (c.op === "rhythm") {
      const v = RHYTHMS.find((x) => x.key === c.value);
      if (!v) return fail("That isn't a rhythm.");
      if (a.rhythm === v.key) return fail(`${a.name} already runs ${v.label.toLowerCase()}.`);
      a.rhythm = v.key;
      summaries.push(`${a.name} now runs: ${v.label}.`);
    } else if (c.op === "reports_to") {
      const boss = find(c.value);
      if (!boss) return fail("Choose who it reports to.");
      if (isRoot) return fail("The orchestrator is at the top; it reports to you.");
      if (boss.id === a.id) return fail(`${a.name} can't report to itself.`);
      if (a.reports_to === boss.id) return fail(`${a.name} already reports to ${boss.name}.`);
      if (isUnder(agents, boss.id, a.id)) return fail(`${a.name} can't report to someone in its own team.`);
      const below = teamOf(agents, a.id).length ? 1 : 0;
      const bossDepth = boss.role === "orchestrator" ? 0 : depthOf(agents, boss.id);
      if (bossDepth + 1 + below > MAX_DEPTH) return fail(`Teams go at most ${MAX_DEPTH} levels below the orchestrator.`);
      if (boss.locked) return fail(`${boss.name} runs from the registers and can't manage a team.`);
      let promoted = "";
      if (boss.role !== "orchestrator" && boss.role !== "lead") {
        promoted = `, who becomes a Lead (was ${role(boss.role)?.label || boss.role})`;
        boss.role = "lead"; if (!boss.skills.includes("planning")) boss.skills.push("planning");
      }
      a.reports_to = boss.id;
      summaries.push(`${a.name} now reports to ${boss.name}${promoted}.`);
    } else if (c.op === "remove") {
      if (isRoot) return fail("The orchestrator stays at the top. Pause it if you want it to stop.");
      if (a.stages && a.stages.length) return fail(`${a.name} owns ${a.stages.join(", ")} on the board. Remove the swarm, or keep it.`);
      const boss = a.reports_to ? find(a.reports_to) : null;
      const team = teamOf(agents, a.id);
      for (const t of team) t.reports_to = a.reports_to;
      agents.splice(agents.indexOf(a), 1);
      used = Math.max(0, used - 1);
      summaries.push(`Removed ${a.name}${team.length ? `; its team now reports to ${boss?.name || "the top"}` : ""}.`);
    } else return fail("Unknown change.");
  }
  return { ok: true, agents, summaries, hires };
}
