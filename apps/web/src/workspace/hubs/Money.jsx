// Money: invoices, money owed to you (with every chase), bills, cash, and the outsourced bits as read-only cards.
import React, { useState } from "react";
import { navigate, useRoute } from "../../router.jsx";
import { useStore } from "../core.jsx";
import { BILL_TONE, Button, DataTable, EmptyState, FilterChips, InvoiceChip, MetricTile, RecordDrawer, RecordLink, StatusChip, cap, delta } from "../ui.jsx";
import { HubFrame, useTab } from "./Hub.jsx";
import { ChaseLine, Summary } from "../records/Summary.jsx";
import { useView } from "../view.js";
import * as q from "../demo/selectors";
import { plural, pounds, poundsRound, ukDate, ukShort } from "../demo/format";

function useFilter(def = "all") {
  const { path, query } = useRoute();
  const set = (f) => navigate(path + (f === def ? "" : "?f=" + f));
  return [query.f || def, set];
}

function Invoices() {
  const s = useStore();
  const { accountant } = useView();
  const [f, setF] = useFilter();
  const [open, setOpen] = useState(null);
  const all = [...s.invoices].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const groups = { all, draft: all.filter((i) => i.status === "draft"), sent: all.filter((i) => q.isUnpaid(i) && !q.isOverdue(s, i)), overdue: all.filter((i) => q.isOverdue(s, i)), paid: all.filter((i) => i.status === "paid") };
  const rows = groups[f] || all;
  const cols = [
    { key: "id", label: "Invoice", sort: (r) => r.id, render: (r) => <span className="w-cell-main mono">{r.id}</span> },
    { key: "co", label: "Customer", sort: (r) => q.company(s, r.companyId).name, render: (r) => <RecordLink refTo={{ type: "company", id: r.companyId }} /> },
    ...(accountant ? [{ key: "iss", label: "Issued", sort: (r) => r.issuedAt, render: (r) => ukShort(r.issuedAt), hideMobile: true }, { key: "net", label: "Net", num: true, render: (r) => pounds(Math.round(r.total / 1.2)), hideMobile: true }, { key: "vat", label: "VAT", num: true, render: (r) => pounds(r.total - Math.round(r.total / 1.2)), hideMobile: true }] : []),
    { key: "amt", label: accountant ? "Gross" : "Amount", num: true, sort: (r) => r.total, render: (r) => pounds(r.total) },
    { key: "due", label: "Due", sort: (r) => r.dueAt, render: (r) => ukShort(r.dueAt) },
    { key: "st", label: "Status", render: (r) => <InvoiceChip invoice={r} /> },
  ];
  return (
    <>
      <FilterChips label="Show invoices" value={f} onChange={setF} options={[["all", "All", all.length], ["draft", "Draft", groups.draft.length], ["sent", "Sent, not due", groups.sent.length], ["overdue", "Overdue", groups.overdue.length], ["paid", "Paid", groups.paid.length]]} />
      <DataTable caption="Invoices" columns={cols} rows={rows} onRow={(r) => setOpen(r.id)}
        empty={<EmptyState icon="ReceiptText" title="No invoices here" body="Fern raises an invoice when a job is done; they appear here as drafts, then sent." action={<Button onClick={() => setF("all")}>Show all invoices</Button>} />} />
      {open && <RecordDrawer refTo={{ type: "invoice", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "invoice", id: open }} /></RecordDrawer>}
    </>
  );
}

function Owed() {
  const s = useStore();
  const { say, accountant } = useView();
  const [f, setF] = useFilter();
  const [open, setOpen] = useState(null);
  const buckets = q.ageing(s);
  const unpaid = s.invoices.filter(q.isUnpaid).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const b = buckets.find((x) => x.key === f);
  const rows = f === "overdue" ? q.overdueInvoices(s) : b ? unpaid.filter((i) => b.ids.includes(i.id)) : f === "notdue" ? unpaid.filter((i) => !q.isOverdue(s, i)) : unpaid;
  const cols = [
    { key: "co", label: "Customer", sort: (r) => q.company(s, r.companyId).name, render: (r) => (
      <div style={{ minWidth: 0 }}>
        <RecordLink refTo={{ type: "company", id: r.companyId }}>{q.company(s, r.companyId).short}</RecordLink> · <RecordLink refTo={{ type: "invoice", id: r.id }} />
        <ChaseLine inv={r} />
      </div>
    ) },
    { key: "amt", label: "Amount", num: true, sort: (r) => r.total, render: (r) => pounds(r.total) },
    { key: "late", label: accountant ? "Days overdue" : "Late", num: true, sort: (r) => q.daysLate(s, r), render: (r) => <InvoiceChip invoice={r} /> },
    ...(accountant ? [{ key: "due", label: "Due date", sort: (r) => r.dueAt, render: (r) => ukShort(r.dueAt), hideMobile: true }, { key: "pay", label: "Payer history", render: (r) => q.company(s, r.companyId).paymentBehaviour, hideMobile: true }] : []),
  ];
  return (
    <>
      <div className="w-ageing" role="group" aria-label="Overdue by age">
        {buckets.map((x) => (
          <button key={x.key} type="button" className="w-metric" aria-pressed={f === x.key} style={f === x.key ? { boxShadow: "inset 0 0 0 2px var(--primary)" } : undefined} onClick={() => setF(f === x.key ? "all" : x.key)}>
            <span className="w-metric-l">{x.label} overdue</span>
            <span className={"w-metric-v" + (x.total ? " is-risk" : "")}>{pounds(x.total)}</span>
            <span className="w-metric-d">{plural(x.count, "invoice")}</span>
          </button>
        ))}
      </div>
      <FilterChips label="Show" value={f} onChange={setF} options={[["all", `All ${say("owedShort").toLowerCase()}`, unpaid.length], ["overdue", "Overdue", q.overdueCount(s)], ["notdue", "Not due yet", unpaid.length - q.overdueCount(s)]]} />
      <DataTable caption={say("owed")} columns={cols} rows={rows} onRow={(r) => setOpen(r.id)}
        empty={<EmptyState icon="HandCoins" title="Nobody owes you anything here" body="Unpaid invoices appear here with every reminder Rosa has sent and what happens next." action={<Button onClick={() => setF("all")}>Show everything owed</Button>} />} />
      {open && <RecordDrawer refTo={{ type: "invoice", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "invoice", id: open }} /></RecordDrawer>}
    </>
  );
}

function Bills() {
  const s = useStore();
  const [f, setF] = useFilter("open");
  const [open, setOpen] = useState(null);
  const now = Date.parse(s.now);
  const status = (b) => (b.status !== "paid" && Date.parse(b.dueAt) < now ? "overdue" : b.status);
  const all = [...s.bills].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const sets = { open: all.filter((b) => b.status !== "paid"), overdue: all.filter((b) => status(b) === "overdue"), paid: all.filter((b) => b.status === "paid").reverse(), all };
  const cols = [
    { key: "sup", label: "Supplier", sort: (r) => r.supplier, render: (r) => <><span className="w-cell-main">{r.supplier}</span><span className="w-cell-sub">{r.category}</span></> },
    { key: "amt", label: "Amount", num: true, sort: (r) => r.total, render: (r) => pounds(r.total) },
    { key: "due", label: "Due", sort: (r) => r.dueAt, render: (r) => ukShort(r.dueAt) },
    { key: "st", label: "Status", render: (r) => { const st = status(r); const pend = s.approvals.find((a) => a.status === "pending" && a.linkedRecord.id === r.id); return <span className="w-row" style={{ gap: 6 }}><StatusChip tone={BILL_TONE[st]}>{cap(st)}</StatusChip>{pend && <RecordLink refTo={{ type: "approval", id: pend.id }} className="w-link">Payment waiting for you</RecordLink>}</span>; } },
  ];
  return (
    <>
      <FilterChips label="Show bills" value={f} onChange={setF} options={[["open", "To pay", sets.open.length], ["overdue", "Overdue", sets.overdue.length], ["paid", "Paid", sets.paid.length], ["all", "All", all.length]]} />
      <DataTable caption="Bills" columns={cols} rows={sets[f] || all} onRow={(r) => setOpen(r.id)} empty={<EmptyState icon="Wallet" title="No bills here" body="Forward a supplier bill to your inbox and Fern records it here with its due date." />} />
      {open && <RecordDrawer refTo={{ type: "bill", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "bill", id: open }} /></RecordDrawer>}
    </>
  );
}

function CashChart({ weeks, start }) {
  const W = 640, H = 220, P = 36;
  const vals = [start, ...weeks.map((w) => w.balance)];
  const max = Math.max(...vals) * 1.1, min = Math.min(0, ...vals);
  const x = (i) => P + (i * (W - P * 2)) / (vals.length - 1);
  const y = (v) => H - P - ((v - min) / (max - min)) * (H - P * 2);
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-chart" role="img" aria-label={`Cash forecast: ${vals.map((v, i) => `${i ? "week " + i : "today"} ${poundsRound(v)}`).join(", ")}`}>
      {[0, 0.5, 1].map((t) => { const v = min + (max - min) * t; return <g key={t}><line x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="var(--line-divider)" /><text x={4} y={y(v) + 4} fontSize="11" fill="var(--text-muted)">{poundsRound(v).replace(",000", "k")}</text></g>; })}
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
      {vals.map((v, i) => <g key={i}><circle cx={x(i)} cy={y(v)} r="4" fill="var(--primary)" /><text x={x(i)} y={H - 10} fontSize="11" textAnchor="middle" fill="var(--text-muted)">{i ? "Wk " + i : "Today"}</text></g>)}
    </svg>
  );
}
function Cash() {
  const s = useStore();
  const weeks = q.cashForecast(s);
  const low = weeks.reduce((m, w) => (w.balance < m.balance ? w : m), weeks[0]);
  return (
    <div className="w-stack">
      <div className="w-metrics" style={{ marginTop: 0 }}>
        <MetricTile label="In the bank today" value={pounds(s.org.cashBalance)} sub={`Updated ${ukDate(s.org.balanceAt)}`} />
        <MetricTile label="Lowest point in 6 weeks" value={pounds(low.balance)} tone={low.balance < 500000 ? "attn" : undefined} sub={`Week ${low.week}, after payroll`} />
        <MetricTile label="Expected in, 6 weeks" value={pounds(weeks.reduce((n, w) => n + w.in, 0))} />
        <MetricTile label="Going out, 6 weeks" value={pounds(weeks.reduce((n, w) => n + w.out, 0))} />
      </div>
      <div className="w-card"><h2 style={{ fontSize: 17, marginBottom: 8 }}>Next six weeks</h2><CashChart weeks={weeks} start={s.org.cashBalance} /><p className="w-sub">Fern works this out from unpaid invoices, contract renewals, bills and payroll. Overdue money is expected within two weeks.</p></div>
      <DataTable caption="Cash by week" rowKey={(r) => r.week} columns={[
        { key: "w", label: "Week starting", render: (r) => ukShort(r.start) },
        { key: "in", label: "In", num: true, render: (r) => pounds(r.in) },
        { key: "out", label: "Out", num: true, render: (r) => pounds(r.out) },
        { key: "bal", label: "Balance", num: true, render: (r) => <b>{pounds(r.balance)}</b> },
      ]} rows={weeks} />
    </div>
  );
}

const VIEWS = { invoices: Invoices, owed: Owed, bills: Bills, cash: Cash };

export function Money({ tab }) {
  const s = useStore();
  const { say } = useView();
  const app = useTab("money", tab);
  const o = q.outcomes(s);
  const V = app && VIEWS[app.key];
  const metrics = [
    <MetricTile key="o" label={say("overdue")} value={pounds(q.overdueTotal(s))} tone={q.overdueTotal(s) ? "risk" : undefined} to="/workspace/money/owed?f=overdue" sub={plural(q.overdueCount(s), "invoice")} />,
    <MetricTile key="d" label="Due in the next 7 days" value={pounds(q.dueSoonTotal(s))} to="/workspace/money/invoices?f=sent" sub={plural(q.dueSoon(s).length, "invoice")} />,
    <MetricTile key="c" label={say("collected") + " this week"} value={pounds(o.collected)} to="/workspace/money/invoices?f=paid" delta={delta(o.collected, o.collectedBefore)} />,
    <MetricTile key="b" label="In the bank" value={pounds(s.org.cashBalance)} to="/workspace/money/cash" sub="6-week forecast" />,
    <MetricTile key="bl" label={say("oweShort")} value={pounds(q.billsUnpaidTotal(s))} to="/workspace/money/bills" sub={q.billsOverdue(s).length ? `${q.billsOverdue(s).length} overdue` : "None overdue"} tone={q.billsOverdue(s).length ? "attn" : undefined} />,
  ];
  return <HubFrame hub="money" tab={app?.key} metrics={metrics}>{V ? <V /> : <GenericApp app={app} />}</HubFrame>;
}

/** The standard hub table, for installed apps without their own screen. */
export function GenericApp({ app }) {
  const s = useStore();
  const [open, setOpen] = useState(null);
  if (!app) return null;
  const rows = s.records.filter((r) => r.appKey === app.key);
  return (
    <>
      <DataTable caption={app.name} columns={[
        { key: "t", label: "Item", sort: (r) => r.title, render: (r) => <span className="w-cell-main">{r.title}</span> },
        { key: "st", label: "Status", sort: (r) => r.status, render: (r) => <StatusChip tone={/needs|open|low/i.test(r.status) ? "attn" : /resolved|current|ok/i.test(r.status) ? "done" : "neutral"}>{r.status}</StatusChip> },
        { key: "o", label: "Owner", render: (r) => r.ownerId ? <RecordLink refTo={{ type: "person", id: r.ownerId }} /> : "—" },
        { key: "c", label: "Site", render: (r) => r.companyId ? <RecordLink refTo={{ type: "company", id: r.companyId }} /> : "—", hideMobile: true },
        { key: "d", label: "Due", sort: (r) => r.dueAt || "", render: (r) => (r.dueAt ? ukShort(r.dueAt) : "—") },
      ]} rows={rows} onRow={(r) => setOpen(r.id)} empty={<EmptyState icon={app.icon} title={`Nothing in ${app.name} yet`} body={app.blurb} />} />
      {open && <RecordDrawer refTo={{ type: "record", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "record", id: open }} /></RecordDrawer>}
    </>
  );
}
