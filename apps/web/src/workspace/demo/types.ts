// The demo workspace's data model. Every entity links to others by ID; every figure on screen is a selector
// over these collections (see selectors.ts). Money is held in pence; dates are ISO strings.

export type RecordType =
  | "company" | "contact" | "deal" | "quote" | "job" | "invoice" | "bill"
  | "conversation" | "task" | "approval" | "person" | "agent" | "record";
export type Ref = { type: RecordType; id: string };
export type Actor = { kind: "person" | "agent"; id: string };

export type Company = {
  id: string; name: string; short: string; type: string; postcode: string; staff: number | null;
  status: "lead" | "customer" | "lost"; paymentBehaviour: "on time" | "sometimes late" | "usually late" | "new";
  website: string | null; email: string | null; source: string; createdAt: string; customerSince: string | null; notes: string;
};
export type Contact = { id: string; companyId: string; name: string; role: string; email: string | null; phone: string | null };
export type DealStage = "new" | "qualified" | "quoted" | "won" | "lost";
export type Deal = {
  id: string; companyId: string; title: string; stage: DealStage; value: number; ownerId: string;
  nextStep: string; updatedAt: string; createdAt: string;
};
export type Line = { description: string; qty: number; unit: number };
export type Quote = {
  id: string; number: string; dealId: string; companyId: string; lines: Line[]; total: number;
  status: "draft" | "sent" | "accepted" | "declined"; sentAt: string | null; decidedAt: string | null;
};
export type Schedule =
  | { kind: "weekly"; days: number[]; time: string; durationMins: number }   // days: 1 = Monday … 7 = Sunday
  | { kind: "once"; date: string; time: string; durationMins: number };
export type Job = {
  id: string; companyId: string; quoteId: string | null; kind: "clean" | "visit"; title: string; site: string;
  schedule: Schedule; crewIds: string[]; status: "proposed" | "scheduled" | "active" | "paused" | "done"; startsOn: string;
  contractId: string | null; monthlyValue: number | null;
};
export type ChaseEntry = { at: string; agentId: string | null; actorId: string | null; kind: "reminder" | "call" | "note" | "promise"; summary: string; approvalId: string | null };
export type Invoice = {
  id: string; companyId: string; jobId: string | null; lines: Line[]; total: number; issuedAt: string; dueAt: string;
  status: "draft" | "sent" | "paid" | "overdue"; paidAt: string | null; chaseLog: ChaseEntry[];
};
export type Bill = {
  id: string; supplier: string; category: string; total: number; issuedAt: string; dueAt: string;
  status: "due" | "overdue" | "paid" | "scheduled"; paidAt: string | null;
};
export type Message = { id: string; at: string; direction: "in" | "out"; from: string; body: string; actor: Actor | null };
export type Conversation = {
  id: string; companyId: string | null; contactId: string | null; channel: "email" | "web" | "phone"; subject: string;
  origin: "enquiry" | "reply" | "customer" | "supplier"; messages: Message[];
  status: "new" | "open" | "waiting" | "resolved"; assignedTo: Actor | null;
};
export type Task = {
  id: string; title: string; detail: string | null; assignee: Actor; dueAt: string | null; linkedRecord: Ref | null;
  status: "open" | "done"; createdAt: string; createdBy: Actor;
};
export type ApprovalType =
  | "send_outreach" | "reply_enquiry" | "send_reminder" | "pay_bill" | "confirm_job" | "post_briefing" | "send_invoice" | "follow_up_quote";
export type Preview =
  | { kind: "email"; to: string; subject: string; body: string }
  | { kind: "message"; channel: string; body: string }
  | { kind: "action"; summary: string; detail: string };
export type Approval = {
  id: string; agentId: string; type: ApprovalType; title: string; reason: string; preview: Preview;
  linkedRecord: Ref; risk: "routine" | "review"; value: number | null; createdAt: string;
  status: "pending" | "approved" | "rejected" | "auto"; decidedAt: string | null; decidedBy: string | null; edited: boolean; note: string | null;
};
export type Person = { id: string; name: string; role: string; team: "office" | "crew"; email: string; phone: string; startedOn: string; initials: string };
export type AutonomyRule = { type: ApprovalType; label: string; mode: "ask" | "auto"; maxValue: number | null };
export type Agent = {
  id: string; name: string; roleName: string; description: string; hubIds: HubId[]; appKeys: string[];
  autonomy: AutonomyRule[]; minutesPerAction: number; subAgents: string[];
};
export type ActivityEvent = {
  id: string; actor: Actor; verb: string; linkedRecord: Ref | null; at: string; undoable: boolean; minutesSaved: number;
};
export type Channel = { id: string; name: string; purpose: string };
export type ActionCard = { label: string; ref: Ref };
export type ChatMessage = { id: string; channelId: string; author: Actor; body: string; at: string; card: ActionCard | null };
export type Payment = { id: string; invoiceId: string; amount: number; at: string };
export type Contract = { id: string; companyId: string; title: string; startsOn: string; endsOn: string; monthlyValue: number; status: "active" | "ending" | "draft" };
export type GenericRecord = { id: string; appKey: string; title: string; status: string; ownerId: string | null; dueAt: string | null; companyId: string | null; detail: string };
export type DiaryEntry = { id: string; title: string; at: string; durationMins: number; with: Ref | null; personIds: string[] };

export type HubId = "customers" | "money" | "work" | "team";
export type AppMode = "here" | "kept" | "outsourced" | "off";
export type InstalledApp = { mode: AppMode; tool: string | null; provider: string | null; autonomy: "ask" | "limits" | "watch" };
export type OsConfig = { version: number; apps: Record<string, InstalledApp>; history: { version: number; at: string; summary: string }[] };

export type Prefs = { view: "owner" | "accountant"; trustDismissed: string[]; leaksDismissed: string[]; onboarded: boolean };

export type State = {
  now: string;                // the demo clock: every "this week" and "days late" is measured from here
  org: { name: string; owner: string; postcode: string; cashBalance: number; balanceAt: string };
  companies: Company[]; contacts: Contact[]; deals: Deal[]; quotes: Quote[]; jobs: Job[]; invoices: Invoice[];
  payments: Payment[]; bills: Bill[]; conversations: Conversation[]; tasks: Task[]; approvals: Approval[];
  people: Person[]; agents: Agent[]; activity: ActivityEvent[]; channels: Channel[]; chat: ChatMessage[];
  contracts: Contract[]; records: GenericRecord[]; diary: DiaryEntry[];
  os: OsConfig; paused: boolean; prefs: Prefs;
};
export type Collection = Exclude<keyof State, "now" | "org" | "os" | "paused" | "prefs">;
