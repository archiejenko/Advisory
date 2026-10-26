// The workspace's component library. Every screen is built from these; /workspace/design shows each in every state.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "../router.jsx";
import { Icon, hrefFor, useStore, useToasts, dismissToast } from "./core.jsx";
import { getState, undo } from "./demo/store";
import { pounds, relative } from "./demo/format";
import * as q from "./demo/selectors";

/* ---------- Basics ---------- */
export function Button({ variant, size, icon, children, className, as, to, ...rest }) {
  const cls = ["w-btn", variant && "w-btn-" + variant, size && "w-btn-" + size, !children && icon && "w-btn-icon", className].filter(Boolean).join(" ");
  const inner = <>{icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}{children}</>;
  if (to) return <Link to={to} className={cls} {...rest}>{inner}</Link>;
  return <button type="button" className={cls} {...rest}>{inner}</button>;
}
export const Money = ({ pence, className }) => <span className={"w-money " + (className || "")}>{pounds(pence)}</span>;

/** Status colours have fixed meanings: attn = needs you, done = done or paid, risk = overdue or risk, agent = agent or info, neutral. */
export function StatusChip({ tone = "neutral", children, title }) { return <span className={"w-chip w-chip-" + tone} title={title}>{children}</span>; }

export function AgentBadge({ agentId, role = true, size }) {
  const a = useStore((s) => q.agent(s, agentId));
  if (!a) return null;
  return (
    <Link to={hrefFor({ type: "agent", id: a.id })} className="w-agent" title={`${a.name} is an agent (${a.roleName})`}>
      <span className="w-agent-dot" aria-hidden="true"><Icon name="Bot" size={size || 14} /></span>
      <span>{a.name}{role && <span className="w-agent-role"> · {a.roleName}</span>}</span>
      <span className="sr-only">(agent)</span>
    </Link>
  );
}
export function Avatar({ actor, size }) {
  const s = useStore();
  if (!actor) return null;
  if (actor.kind === "agent") { const a = q.agent(s, actor.id); return <span className={"w-avatar w-avatar-agent" + (size === "lg" ? " w-avatar-lg" : "")} title={a ? `${a.name}, agent` : "Agent"}><Icon name="Bot" size={size === "lg" ? 24 : 15} /></span>; }
  const p = q.person(s, actor.id);
  return <span className={"w-avatar" + (size === "lg" ? " w-avatar-lg" : "")} title={p?.name}>{p?.initials || "?"}</span>;
}
/** Who did it: a person's name, or an agent's badge. */
export function ActorName({ actor }) {
  const s = useStore();
  if (!actor) return null;
  if (actor.kind === "agent") return <AgentBadge agentId={actor.id} role={false} />;
  return <Link to={hrefFor({ type: "person", id: actor.id })} className="w-reflink">{q.person(s, actor.id)?.name}</Link>;
}
/** Every reference to another record is a link. */
export function RecordLink({ refTo, children, className }) {
  const s = useStore();
  if (!refTo) return children || null;
  return <Link to={hrefFor(refTo, s)} className={className || "w-reflink"}>{children || q.title(s, refTo)}</Link>;
}

/* ---------- Page structure ---------- */
export function Crumbs({ items }) {
  return (
    <nav className="w-crumbs" aria-label="Breadcrumb">
      <ol>{items.map(([t, to], i) => <li key={i}>{to ? <Link to={to}>{t}</Link> : <span aria-current="page">{t}</span>}</li>)}</ol>
    </nav>
  );
}
export function PageHeader({ title, purpose, crumbs, metrics, actions, titleId, scrollMetrics = true }) {
  useEffect(() => { document.title = `${title} | ${getState().org.name}`; }, [title]);
  return (
    <header>
      {crumbs && <Crumbs items={crumbs} />}
      <div className="w-page-h">
        <div><h1 id={titleId}>{title}</h1>{purpose && <p className="w-purpose">{purpose}</p>}</div>
        {actions && <div className="w-page-a">{actions}</div>}
      </div>
      {metrics && <div className={"w-metrics" + (scrollMetrics ? " is-scroll" : "")}>{metrics}</div>}
    </header>
  );
}
/** A number that opens the filtered view behind it, with its change on last period. */
export function MetricTile({ label, value, tone, to, delta, sub }) {
  const body = (
    <>
      <span className="w-metric-l">{label}</span>
      <span className={"w-metric-v" + (tone ? " is-" + tone : "")}>{value}</span>
      {delta && <span className={"w-metric-d " + (delta.good === undefined ? "" : delta.good ? "up" : "down")}>{delta.dir && <Icon name={delta.dir === "up" ? "ArrowUpRight" : "ArrowDownRight"} size={13} />}{delta.text}</span>}
      {sub && !delta && <span className="w-metric-d">{sub}</span>}
    </>
  );
  return to ? <Link to={to} className="w-metric">{body}</Link> : <div className="w-metric">{body}</div>;
}
/** Change against a previous figure: "↑ 12% vs same week last month". higherIsBetter decides the colour. */
export function delta(now, before, { higherIsBetter = true, unit = "%", vs = "last month" } = {}) {
  if (!before) return { text: `Nothing to compare from ${vs}` };
  const ch = (now - before) / before;
  if (Math.abs(ch) < 0.005) return { text: `Same as ${vs}` };
  const up = ch > 0;
  return { dir: up ? "up" : "down", good: up === higherIsBetter, text: `${Math.abs(Math.round(ch * 100))}${unit} ${up ? "up" : "down"} on ${vs}` };
}

export function Tabs({ tabs, current, label }) {
  return (
    <nav className="w-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} className={"w-tab" + (t.key === current ? " is-on" : "")} aria-current={t.key === current ? "page" : undefined}>
          {t.icon && <Icon name={t.icon} size={16} />}{t.label}{t.count ? <span className="w-count" aria-label={`${t.count} need you`}>{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
export function SegmentedControl({ options, value, onChange, label }) {
  return (
    <div className="w-seg" role="group" aria-label={label}>
      {options.map(([v, t]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}
export function FilterChips({ options, value, onChange, label }) {
  return (
    <div className="w-filters" role="group" aria-label={label}>
      {options.map(([v, t, n]) => <button key={v} type="button" className="w-fchip" aria-pressed={value === v} onClick={() => onChange(v)}>{t}{n !== undefined && <span className="w-n tnum">{n}</span>}</button>)}
    </div>
  );
}
/** Every empty state says what will appear and offers one thing to do. */
export function EmptyState({ icon = "Inbox", title, body, action }) {
  return (
    <div className="w-empty">
      <span className="w-empty-i"><Icon name={icon} size={22} /></span>
      <b>{title}</b>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}
export function Section({ title, sub, actions, children, id }) {
  return (
    <section className="w-section" aria-labelledby={id}>
      <div className="w-section-h"><h2 id={id}>{title}</h2>{sub && <span className="w-sub">{sub}</span>}<span className="w-sp" />{actions}</div>
      {children}
    </section>
  );
}

/* ---------- Overlays ---------- */
function useOverlay(open, onClose, ref) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const key = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll("a[href],button:not([disabled]),textarea,input,select,[tabindex='0']")];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    setTimeout(() => ref.current?.querySelector("[data-autofocus],button,a[href]")?.focus(), 20);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key, true); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open]);
}
export function Drawer({ open, onClose, title, sub, children, footer, label }) {
  const ref = useRef(null);
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return (
    <>
      <div className="w-scrim" onClick={onClose} />
      <aside className="w-drawer" role="dialog" aria-modal="true" aria-label={label || title} ref={ref}>
        <div className="w-drawer-h">
          <div style={{ flex: 1, minWidth: 0 }}><h2>{title}</h2>{sub && <div className="w-sub" style={{ marginTop: 4 }}>{sub}</div>}</div>
          <Button variant="ghost" icon="X" onClick={onClose} aria-label="Close" />
        </div>
        <div className="w-drawer-b">{children}</div>
        {footer && <div className="w-drawer-f">{footer}</div>}
      </aside>
    </>
  );
}
/** The standard record drawer: a summary, the key facts and "Open full record". */
export function RecordDrawer({ refTo, onClose, children, footer }) {
  const s = useStore();
  if (!refTo) return null;
  return (
    <Drawer open onClose={onClose} title={q.title(s, refTo)} footer={<><Button variant="primary" to={hrefFor(refTo, s)} icon="ExternalLink" onClick={onClose}>Open full record</Button>{footer}</>}>
      {children}
    </Drawer>
  );
}
export function Dialog({ open, onClose, title, children, label }) {
  const ref = useRef(null);
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return (
    <>
      <div className="w-scrim" onClick={onClose} />
      <div className="w-dialog" role="dialog" aria-modal="true" aria-label={label || title} ref={ref}>
        <div className="w-drawer-h"><h2 style={{ flex: 1 }}>{title}</h2><Button variant="ghost" icon="X" onClick={onClose} aria-label="Close" /></div>
        <div className="w-drawer-b">{children}</div>
      </div>
    </>
  );
}

/* ---------- Toasts with undo ---------- */
export function Toaster() {
  const list = useToasts();
  const [, tick] = useState(0);
  useEffect(() => { if (!list.length) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [list.length]);
  return (
    <div className="w-toasts" role="status" aria-live="polite">
      {list.map((t) => {
        const left = Math.max(0, Math.ceil((t.ms - (Date.now() - t.at)) / 1000));
        return (
          <div key={t.id} className="w-toast">
            <Icon name={t.undo ? "CircleCheck" : "Info"} size={18} />
            <p>{t.text}</p>
            {t.undo && <Button size="sm" icon="Undo2" onClick={() => { undo(t.undo); dismissToast(t.id); }}>Undo <span className="muted tnum">{left}s</span></Button>}
            <Button size="sm" variant="ghost" icon="X" aria-label="Dismiss" onClick={() => dismissToast(t.id)} />
            {t.undo && <span className="w-bar" style={{ width: `${(left / (t.ms / 1000)) * 100}%` }} aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Timeline: people and agents ---------- */
export function Timeline({ events, empty = "Nothing has happened here yet. Actions by your team and agents will appear here." }) {
  const s = useStore();
  if (!events.length) return <EmptyState icon="Clock" title="No activity yet" body={empty} />;
  return (
    <ol className="w-tl">
      {events.map((e) => (
        <li key={e.id}>
          <Avatar actor={e.actor} />
          <div className="w-tl-b">
            <p><b>{q.actorName(s, e.actor)}</b> {e.verb}</p>
            <div className="w-tl-m">
              {e.actor.kind === "agent" && <StatusChip tone="agent">Agent</StatusChip>}
              <time dateTime={e.at} title={new Date(e.at).toLocaleString("en-GB")}>{relative(e.at, s.now > e.at ? s.now : undefined)}</time>
              {e.linkedRecord && <RecordLink refTo={e.linkedRecord} />}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Data table ---------- */
/**
 * columns: { key, label, render(row), sort(row) → value, num, hideMobile }
 * Rows open with a click or Enter. Built-in loading, error and empty states.
 */
export function DataTable({ columns, rows, rowKey = (r) => r.id, onRow, empty, loading, error, onRetry, initialSort, caption }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort || !rows) return rows || [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "asc" ? 1 : -1); });
  }, [rows, sort, columns]);
  if (error) return <div className="w-table-wrap"><div className="w-table-state"><EmptyState icon="AlertTriangle" title="This list didn't load" body={String(error)} action={onRetry && <Button onClick={onRetry} icon="RotateCcw">Try again</Button>} /></div></div>;
  return (
    <div className="w-table-wrap">
      <table className="w-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => (
            <th key={c.key} className={c.num ? "num" : undefined} aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
              {c.sort ? <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}>{c.label}<Icon name="ArrowUpDown" size={12} /></button> : c.label}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {loading ? [0, 1, 2, 3].map((i) => <tr key={i} aria-hidden="true">{columns.map((c) => <td key={c.key}><div className="w-skel" style={{ width: `${50 + ((i * 17 + c.key.length * 7) % 40)}%` }} /></td>)}</tr>)
            : sorted.map((r) => (
              <tr key={rowKey(r)} tabIndex={0} onClick={(e) => { if (!e.target.closest("a,button")) onRow?.(r); }} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRow?.(r); }}>
                {columns.map((c) => <td key={c.key} className={[c.num && "num", c.hideMobile && "w-hide-m"].filter(Boolean).join(" ") || undefined} data-label={c.label}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
        </tbody>
      </table>
      {!loading && !sorted.length && <div className="w-table-state">{empty || <EmptyState title="Nothing here yet" />}</div>}
    </div>
  );
}

/* ---------- Status of common records ---------- */
export function invoiceStatus(s, i) {
  if (i.status === "paid") return ["done", "Paid"];
  if (i.status === "draft") return ["neutral", "Draft"];
  if (q.isOverdue(s, i)) return ["risk", `${q.daysLate(s, i)} days late`];
  return ["agent", "Sent"];
}
export const InvoiceChip = ({ invoice }) => { const s = useStore(); const [t, l] = invoiceStatus(s, invoice); return <StatusChip tone={t}>{l}</StatusChip>; };
export const DEAL_TONE = { new: "neutral", qualified: "agent", quoted: "attn", won: "done", lost: "risk" };
export const QUOTE_TONE = { draft: "neutral", sent: "attn", accepted: "done", declined: "risk" };
export const CONV_TONE = { new: "attn", open: "agent", waiting: "neutral", resolved: "done" };
export const BILL_TONE = { due: "neutral", scheduled: "agent", overdue: "risk", paid: "done" };
export const cap = (x) => x[0].toUpperCase() + x.slice(1);
