// /workspace/design: every component in every state, at desktop width and (in the frame) at 375px. Not in the navigation.
import React, { useState } from "react";
import { useRoute } from "../../router.jsx";
import { Icon, toast, useStore } from "../core.jsx";
import {
  ActorName, AgentBadge, Avatar, Button, DataTable, Dialog, Drawer, EmptyState, FilterChips, InvoiceChip, MetricTile,
  PageHeader, RecordLink, Section, SegmentedControl, StatusChip, Tabs, Timeline, delta,
} from "../ui.jsx";
import { DecisionCard } from "../DecisionCard.jsx";
import { AskButton } from "../AskBar.jsx";
import { pounds } from "../demo/format";
import * as q from "../demo/selectors";

const COLOURS = [
  ["--surface-base", "Surface: base"], ["--surface-raised", "Surface: raised"], ["--surface-overlay", "Surface: overlay"],
  ["--line-border", "Border"], ["--line-divider", "Divider"], ["--text-primary", "Text: primary"], ["--text-secondary", "Text: secondary"], ["--text-muted", "Text: muted"],
  ["--primary", "Primary (lavender)"], ["--status-attn-fill", "Amber: needs you"], ["--status-done-fill", "Green: done or paid"], ["--status-risk", "Coral: overdue or risk"], ["--status-agent", "Lavender: agent or info"], ["--status-neutral", "Grey: neutral"],
];

export function Design() {
  const s = useStore();
  const { query } = useRoute();
  const [seg, setSeg] = useState("owner");
  const [chip, setChip] = useState("all");
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const inv = s.invoices.filter((i) => i.status !== "paid").slice(0, 4);
  const sample = { ...q.pending(s).find((a) => a.id === "apr_tarnbrook") || q.pending(s)[0], id: "design_sample" };
  const cols = [
    { key: "id", label: "Invoice", sort: (r) => r.id, render: (r) => <span className="w-cell-main">{r.id}</span> },
    { key: "co", label: "Customer", sort: (r) => q.company(s, r.companyId).name, render: (r) => <RecordLink refTo={{ type: "company", id: r.companyId }} /> },
    { key: "amt", label: "Amount", num: true, sort: (r) => r.total, render: (r) => pounds(r.total) },
    { key: "st", label: "Status", render: (r) => <InvoiceChip invoice={r} /> },
  ];
  return (
    <div>
      <PageHeader title="Design system" purpose="Every workspace component, in every state. Not linked from the navigation." crumbs={query.frame ? null : [["Home", "/workspace"], ["Design system"]]} />

      <Section title="Colour tokens" id="d-colour">
        <div className="w-grid w-grid-3">{COLOURS.map(([v, t]) => <div key={v} className="w-design-swatch"><i style={{ background: `var(${v})` }} /><span>{t}<br /><code className="mono muted">{v}</code></span></div>)}</div>
      </Section>

      <Section title="Type" id="d-type">
        <div className="w-stack">
          <p className="w-greet">Good evening, Dana</p>
          <h1 style={{ fontSize: "var(--t-title)" }}>Page title, 28 to 32px</h1>
          <h2 style={{ fontSize: "var(--t-lg)" }}>Section title</h2>
          <p>Body text at 15px. Money and counts use tabular figures: <span className="tnum">£1,280.00 · £656.00 · £400.00</span></p>
          <p className="muted">Muted text for secondary detail.</p>
        </div>
      </Section>

      <Section title="Buttons" id="d-btn">
        <div className="w-row"><Button variant="primary" icon="Check">Approve</Button><Button icon="Pencil">Edit</Button><Button variant="ghost">Ghost</Button><Button variant="ghost" className="w-btn-danger" icon="X">Reject</Button><Button disabled>Disabled</Button><Button size="sm">Small</Button><Button size="lg" variant="primary">Large</Button><Button icon="Bell" aria-label="Icon only" /></div>
      </Section>

      <Section title="Status chips (fixed meanings)" id="d-chips">
        <div className="w-row"><StatusChip tone="attn">Needs you</StatusChip><StatusChip tone="done">Paid</StatusChip><StatusChip tone="risk">21 days late</StatusChip><StatusChip tone="agent">Agent</StatusChip><StatusChip tone="neutral">Draft</StatusChip><span className="w-count">10</span></div>
      </Section>

      <Section title="Agent badge, avatars and links" id="d-agent">
        <div className="w-row">{s.agents.map((a) => <AgentBadge key={a.id} agentId={a.id} />)}</div>
        <div className="w-row" style={{ marginTop: 12 }}><Avatar actor={{ kind: "person", id: "p_dana" }} /><Avatar actor={{ kind: "agent", id: "agt_credit" }} /><Avatar actor={{ kind: "person", id: "p_sam" }} size="lg" /><ActorName actor={{ kind: "person", id: "p_sam" }} /><RecordLink refTo={{ type: "invoice", id: "INV-1047" }} /><RecordLink refTo={{ type: "company", id: "co_tarnbrook" }} /></div>
      </Section>

      <Section title="Metric tiles" id="d-metric">
        <div className="w-metrics">
          <MetricTile label="Overdue" value={pounds(q.overdueTotal(s))} tone="risk" to="/workspace/money/owed" sub={`${q.overdueCount(s)} invoices`} />
          <MetricTile label="Collected this week" value={pounds(12000)} delta={delta(12000, 10000)} to="/workspace/money/invoices" />
          <MetricTile label="Reply time" value="36 min" delta={delta(36, 47, { higherIsBetter: false })} />
          <MetricTile label="Needs you" value="10" tone="attn" />
          <MetricTile label="No comparison" value="£0.00" delta={delta(0, 0)} />
        </div>
      </Section>

      <Section title="Page header, tabs and controls" id="d-header">
        <div className="w-card">
          <PageHeader title="Money" purpose="What you're owed, what you owe and the cash in the bank." actions={<Button variant="primary" icon="Plus">New invoice</Button>} />
          <Tabs label="Money apps" current="owed" tabs={[{ key: "invoices", label: "Invoices", to: "/workspace/design" }, { key: "owed", label: "Money owed to you", to: "/workspace/design", count: 3 }, { key: "bills", label: "Bills", to: "/workspace/design" }]} />
          <div className="w-row" style={{ marginTop: 16 }}>
            <SegmentedControl label="View" value={seg} onChange={setSeg} options={[["owner", "Owner"], ["accountant", "Accountant"]]} />
          </div>
          <FilterChips label="Filter" value={chip} onChange={setChip} options={[["all", "All", 12], ["overdue", "Overdue", 3], ["paid", "Paid", 8]]} />
        </div>
      </Section>

      <Section title="Data table" id="d-table">
        <DataTable caption="Invoices" columns={cols} rows={inv} onRow={() => setDrawer(true)} initialSort={{ key: "amt", dir: "desc" }} />
        <div className="w-grid w-grid-3" style={{ marginTop: 16 }}>
          <DataTable caption="Loading" columns={cols} rows={[]} loading />
          <DataTable caption="Empty" columns={cols} rows={[]} empty={<EmptyState icon="ReceiptText" title="No invoices yet" body="Invoices appear here as soon as a job is done." action={<Button icon="Plus">Raise an invoice</Button>} />} />
          <DataTable caption="Error" columns={cols} rows={[]} error="We couldn't reach the server." onRetry={() => toast("Retrying…")} />
        </div>
      </Section>

      <Section title="Drawer, dialog and toast" id="d-overlay">
        <div className="w-row"><Button onClick={() => setDrawer(true)}>Open drawer</Button><Button onClick={() => setDialog(true)}>Open dialog</Button><Button onClick={() => toast("A plain notice.")}>Show toast</Button><Button onClick={() => toast("Reminder sent: example", { undo: "none" })}>Show undo toast</Button></div>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="INV-1047" sub="Tarnbrook Logistics Ltd" footer={<Button variant="primary">Open full record</Button>}><p>Drawer content.</p></Drawer>
        <Dialog open={dialog} onClose={() => setDialog(false)} title="A dialog"><p>Dialog content.</p></Dialog>
      </Section>

      <Section title="Decision card" id="d-dc">
        <div className="w-queue-list" style={{ maxWidth: 720 }}>{sample && <DecisionCard a={sample} focused />}</div>
      </Section>

      <Section title="Timeline" id="d-tl">
        <div className="w-grid w-grid-2"><div className="w-card"><Timeline events={s.activity.slice(0, 5)} /></div><div className="w-card"><Timeline events={[]} /></div></div>
      </Section>

      <Section title="Ask bar" id="d-ask"><div style={{ maxWidth: 420 }}><AskButton onOpen={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))} /></div></Section>

      <Section title="Empty state" id="d-empty"><div className="w-card"><EmptyState icon="Inbox" title="Inbox zero" body="New emails, web enquiries and call notes appear here, with a reply drafted." action={<Button icon="Plus">Log a call</Button>} /></div></Section>

      {!query.frame && (
        <Section title="At 375px" id="d-phone" sub="The same page in a phone-width frame">
          <div className="w-design-frame" style={{ width: 375, maxWidth: "100%" }}><iframe title="Design system at 375px" src={location.href.split("#")[0] + "#/workspace/design?frame=1"} /></div>
        </Section>
      )}
      <p className="muted" style={{ marginTop: 32 }}><Icon name="Info" size={14} /> Status colours are never decorative.</p>
    </div>
  );
}
