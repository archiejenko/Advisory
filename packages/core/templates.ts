import { ROLES } from "./badges";
// The agent catalogue. One source for the API (what an agent may do) and the website (what we say it does).

export type Profile = { what?: string; customers?: string; area?: string; tone?: string; sign_off?: string; website?: string };
export type Template = {
  key: string;
  name: string;
  category: "Grow" | "Get paid" | "Run" | "Protect" | "Know";
  glyph: string;
  short: string;                 // one line for cards
  description: string;           // two sentences for the agent page
  does: string[];                // what it does, in order
  needs: string;                 // what the owner provides
  status: "live" | "next";
  engine: "llm" | "watch" | "check" | "prospect";
  rhythm: "weekdays" | "daily" | "weekly" | "monthly" | "on_demand" | "on_event";
  tools: string[];               // tool slugs it may call (llm engine)
  instructions?: string;         // the agent's standing orders
  kickoff?: string;              // what a scheduled run is asked to do
  brief: (p: Profile & { name: string }) => string;
};

const tone = (p: Profile) => p.tone || "friendly, plain and brief";

export const TEMPLATES: Template[] = [
  {
    key: "outreach", name: "Outreach", category: "Grow", glyph: "send",
    short: "Finds the right companies, researches them and drafts a personal first email.",
    description: "Finds companies that match your ideal customer, researches each one, and drafts a short, personal first email and one follow-up. You approve what goes out; replies become leads.",
    does: ["Searches the register for companies that fit your ideal customer", "Reads their website and the public record", "Finds a published business contact address", "Drafts a short first email with a real reason to talk", "Follows up once, five days later, if there's no reply"],
    needs: "A sentence about who your ideal customer is",
    status: "live", engine: "llm", rhythm: "weekdays",
    tools: ["business-profile", "find-companies", "company-research", "web-research", "read-page", "list-leads", "save-lead", "propose-email", "create-task"],
    instructions: `You run outreach for a small UK business. Each run:
1. Read the business profile.
2. Find up to 3 new companies that match the ideal customer with find-companies. Skip any already in list-leads.
3. For each: use company-research, then read-page on its website to find a business contact email that is published on the site. Never guess or construct an email address.
4. save-lead for each company, with the email if you found one. If none is published, save it without an email and create-task for the owner to find a contact.
5. For each lead with an email, propose-email a first message: under 120 words, plain text, one specific reason this company would care, one question, signed off as the business. No hype, no claims you can't back.
6. For leads contacted 5 or more days ago with no reply and only one email sent, propose-email one short follow-up.
Finish with a two-line summary of what you did.`,
    kickoff: "Run today's outreach.",
    brief: (p) => `Find ${p.customers || "businesses that would buy from us"}${p.area ? ` in ${p.area}` : ""}. Introduce ${p.name}${p.what ? `: ${p.what}` : ""}. Tone: ${tone(p)}.`,
  },
  {
    key: "inbox", name: "Inbox", category: "Run", glyph: "inbox",
    short: "Sorts every enquiry, drafts the reply and flags what needs you.",
    description: "Reads the enquiries you forward to your Agent House address, sorts them by urgency and type, and drafts a reply in your voice. Anything it can't answer becomes a task for you.",
    does: ["Reads each new enquiry as it arrives", "Sorts it: urgent, quote, booking, complaint, supplier or other", "Drafts a reply in your tone", "Turns anything it can't answer into a task for you"],
    needs: "Forward your enquiries inbox to your Agent House address",
    status: "live", engine: "llm", rhythm: "on_event",
    tools: ["business-profile", "list-inbox", "triage-message", "propose-email", "create-task", "notify-owner"],
    instructions: `You handle the enquiries inbox for a small UK business. For each new message from list-inbox:
1. triage-message with urgency (high, normal, low), a category (quote, booking, question, complaint, supplier, spam, other) and a one-line summary.
2. If it's a real enquiry you can answer from the business profile, propose-email a reply to the sender: helpful, under 150 words, in the business's tone. Never promise prices, dates or anything the profile doesn't state; offer to confirm instead.
3. If it needs the owner (pricing, complaints, anything uncertain), create-task with what's needed.
4. If anything is urgent, notify-owner in one line.
Ignore spam. Finish with a one-line summary.`,
    kickoff: "Handle the new messages in the inbox.",
    brief: (p) => `Reply as ${p.name}${p.what ? ` (${p.what})` : ""}. Tone: ${tone(p)}. Never quote prices or dates; offer to confirm them.`,
  },
  {
    key: "credit-control", name: "Credit control", category: "Get paid", glyph: "pound",
    short: "Chases unpaid invoices politely, on time, every time.",
    description: "Works through your unpaid invoices and sends polite reminders on a steady schedule: a nudge, a firmer note, then a final reminder. After that it hands the account to you.",
    does: ["Checks which invoices are overdue", "Sends a friendly reminder a day after the due date", "Follows up at 7 and 14 days, a little firmer each time", "Hands you the account after the third reminder"],
    needs: "Your unpaid invoices as a spreadsheet",
    status: "live", engine: "llm", rhythm: "weekdays",
    tools: ["business-profile", "list-invoices", "propose-email", "create-task", "notify-owner"],
    instructions: `You run credit control for a small UK business. Call list-invoices with overdue_only. For each overdue invoice:
- If it has had no reminder and is 1+ days overdue: propose-email a friendly reminder.
- If it has had 1 reminder, the last 6+ days ago, and is 7+ days overdue: propose-email a firmer reminder.
- If it has had 2 reminders, the last 6+ days ago, and is 14+ days overdue: propose-email a final reminder saying you may need to add statutory interest.
- If it has had 3 reminders: create-task for the owner to call the customer. Do not email again.
Always pass invoice_id. Each email: invoice reference, amount, due date, how to pay or reply. Under 100 words, courteous. Never threaten.
Finish with a one-line summary.`,
    kickoff: "Chase today's overdue invoices.",
    brief: (p) => `Remind customers of ${p.name} about overdue invoices. Tone: courteous and firm. Sign off as ${p.sign_off || p.name}.`,
  },
  {
    key: "customer-watch", name: "Customer and supplier watch", category: "Protect", glyph: "watch",
    short: "Watches every company you deal with and warns you before trouble hits.",
    description: "Checks every customer and supplier against Companies House, The Gazette and the FCA register, and alerts you the moment something changes that affects whether you get paid or delivered to.",
    does: ["Matches your customer list to the register", "Watches status, filings, directors, charges and insolvency notices", "Sends critical changes straight to you", "Collects smaller changes into a weekly digest"],
    needs: "Your customer or supplier list",
    status: "live", engine: "watch", rhythm: "on_event", tools: [],
    brief: (p) => `Watch the companies ${p.name} sells to and buys from.`,
  },
  {
    key: "customer-check", name: "New customer check", category: "Protect", glyph: "check",
    short: "A one-page sourced brief on any company before you sign or give credit.",
    description: "Type a name, number or invoice line and get a one-page brief: status, filings, officers, charges and insolvency notices, every fact footnoted. If a name could be two companies, it asks.",
    does: ["Matches messy input to the right company", "Pulls every register fact with its source", "Flags anything worth a second look", "Never guesses between two companies"],
    needs: "Nothing",
    status: "live", engine: "check", rhythm: "on_demand", tools: [],
    brief: (p) => `Check companies before ${p.name} signs or gives credit.`,
  },
  {
    key: "lead-finder", name: "Lead finder", category: "Grow", glyph: "prospect",
    short: "A monthly list of established companies in the areas you serve.",
    description: "Builds a monthly list of active companies in the postcode districts and industries you choose, filtered by age and checked against the register, ready for your CRM or the outreach agent.",
    does: ["Filters the register by district, industry and age", "Leaves out companies you already work with", "Delivers a CSV on the first working day of the month"],
    needs: "Postcode districts and industries",
    status: "live", engine: "prospect", rhythm: "monthly", tools: [],
    brief: (p) => `Find companies${p.area ? ` in ${p.area}` : ""} that could buy from ${p.name}.`,
  },
  {
    key: "research", name: "Research", category: "Know", glyph: "search",
    short: "Answers business questions with sources: a competitor, a company, a market.",
    description: "Ask a question and get a short, sourced answer: who a competitor is, whether a supplier is sound, what a market looks like. It reads the web and the registers and shows its working.",
    does: ["Searches the web and the UK registers", "Reads the pages that matter", "Writes a short answer with every source linked"],
    needs: "Nothing",
    status: "live", engine: "llm", rhythm: "on_demand",
    tools: ["business-profile", "web-research", "read-page", "company-research", "uk-check", "find-companies"],
    instructions: `You are a careful business researcher for a small UK business. Answer the question you're given.
Use web-research and read-page for the web, and company-research or uk-check for UK companies. Prefer primary sources.
Write the answer in plain English: a two-sentence answer first, then up to 6 short points, then a Sources list of the URLs you actually read. Say clearly what you could not find. Never invent figures.`,
    kickoff: "Answer this question:",
    brief: (p) => `Research questions for ${p.name}. Keep answers short and sourced.`,
  },
  {
    key: "briefing", name: "Weekly briefing", category: "Know", glyph: "bell",
    short: "One short note each Monday: what your agents did and what needs you.",
    description: "Every Monday morning it reads what every agent did in the last week, what it found and what is waiting for you, and sends one short note to your channel or inbox.",
    does: ["Reads the week's runs, actions, alerts and tasks", "Picks out what needs a decision", "Sends one short note on Monday morning"],
    needs: "Nothing",
    status: "live", engine: "llm", rhythm: "weekly",
    tools: ["recent-activity", "notify-owner"],
    instructions: `Write the owner's weekly briefing. Call recent-activity, then notify-owner once with a note of at most 8 short lines: first what needs a decision (approvals waiting, open tasks, critical alerts), then what the agents did, with numbers. No fluff.`,
    kickoff: "Write this week's briefing.",
    brief: (p) => `A short Monday note for ${p.name}.`,
  },
  {
    key: "bookings", name: "Bookings", category: "Run", glyph: "call",
    short: "Offers times, books appointments and sends confirmations.",
    description: "Offers your free times to customers who ask, books the appointment and sends a confirmation and reminder.",
    does: ["Reads your calendar", "Offers times that suit you", "Books, confirms and reminds"],
    needs: "Google or Microsoft calendar", status: "next", engine: "llm", rhythm: "on_event", tools: [],
    brief: (p) => `Book appointments for ${p.name}.`,
  },
  {
    key: "reviews", name: "Reviews", category: "Grow", glyph: "star",
    short: "Asks happy customers for reviews and drafts replies to new ones.",
    description: "Asks customers for a review after a job goes well, and drafts a reply to every new review for you to approve.",
    does: ["Asks for reviews at the right moment", "Drafts replies to new reviews"],
    needs: "Google Business Profile", status: "next", engine: "llm", rhythm: "on_event", tools: [],
    brief: (p) => `Look after reviews for ${p.name}.`,
  },
  {
    key: "social", name: "Social", category: "Grow", glyph: "megaphone",
    short: "Turns your news and wins into posts, ready to schedule.",
    description: "Drafts posts from your news, jobs and wins, and schedules the ones you approve.",
    does: ["Drafts posts from your news", "Schedules what you approve"],
    needs: "LinkedIn and Meta", status: "next", engine: "llm", rhythm: "weekly", tools: [],
    brief: (p) => `Post about ${p.name}'s work.`,
  },
  {
    key: "bookkeeping", name: "Bookkeeping", category: "Get paid", glyph: "ledger",
    short: "Chases missing receipts and tidies your transactions.",
    description: "Finds transactions without receipts, asks the right person for them, and tidies categories for your accountant.",
    does: ["Finds missing receipts", "Asks for them", "Tidies categories"],
    needs: "Xero or QuickBooks", status: "next", engine: "llm", rhythm: "weekly", tools: [],
    brief: (p) => `Keep ${p.name}'s books tidy.`,
  },
];

/** The orchestrator leads a swarm. It is part of every swarm and isn't hired from the catalogue. */
export const ORCHESTRATOR: Template = {
  key: "orchestrator", name: "Orchestrator", category: "Run", glyph: "split",
  short: "Breaks the swarm's goals into tasks, assigns them and checks they finish.",
  description: "Sits at the top of a swarm. It reads the goals and the team, assigns tasks to the agent whose role fits, follows up what stalls, and brings you only the decisions.",
  does: ["Reads the swarm's goals and the team", "Assigns tasks to the right agent", "Checks they finish and follows up what's blocked", "Brings you the decisions"],
  needs: "Goals for the swarm",
  status: "live", engine: "llm", rhythm: "weekdays",
  tools: ["business-profile", "list-team", "assign-task", "check-tasks", "create-task", "recent-activity"],
  instructions: ROLES.find((r) => r.key === "orchestrator")!.orders, // one source with the Orchestrator role badge
  kickoff: "Plan today's work for the team.",
  brief: (p) => `Keep ${p.name}'s agents working on what matters most.`,
};

export const template = (key: string) => TEMPLATES.find((t) => t.key === key) || (key === "orchestrator" ? ORCHESTRATOR : undefined);
export const RHYTHM_LABEL: Record<Template["rhythm"], string> = {
  weekdays: "Every weekday", daily: "Every day", weekly: "Every Monday", monthly: "First working day of the month", on_demand: "When you ask", on_event: "When something arrives",
};

/** Plans: how many agents a business can hire and how many tool calls its agents get a month. */
export const PLANS: Record<string, { name: string; price: number | null; agents: number; actions: number; blurb: string }> = {
  trial: { name: "Free trial", price: 0, agents: 6, actions: 1500, blurb: "14 days, everything in Growth" },
  pilot: { name: "Pilot", price: null, agents: 12, actions: 5000, blurb: "Founding rate, agreed with us" },
  starter: { name: "Starter", price: 49, agents: 2, actions: 300, blurb: "Two agents for a sole trader or small team" },
  growth: { name: "Growth", price: 149, agents: 6, actions: 1500, blurb: "Six agents across sales, admin and cash" },
  scale: { name: "Scale", price: 399, agents: 12, actions: 5000, blurb: "Every agent, for busy teams" },
};
