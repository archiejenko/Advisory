// Engagement: every touch with every buyer and supplier, from people and agents, with the contact rules checked
// before anyone sends. Overview (figures, the chart, what needs attention and the account grid), the guard log and
// the rules. Keyboard: J and K move through the grid, Enter opens, L logs a touch, / filters, Esc closes.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { navigate, useRoute } from "../../router.jsx";
import { Icon, useMedia, useStore } from "../core.jsx";
import { Button, Drawer, MetricTile, PageHeader, StatusChip, Tabs, delta } from "../ui.jsx";
import * as q from "../demo/selectors";
import { TouchChart } from "./TouchChart.jsx";
import { AccountGrid } from "./AccountGrid.jsx";
import { Inspector } from "./Inspector.jsx";
import { LogTouch } from "./LogTouch.jsx";
import { GuardLog } from "./GuardLog.jsx";
import { ContactRules } from "./ContactRules.jsx";
import { PresenceDots, VerdictChip, parseAcc } from "./bits.jsx";

const TABS = [["overview", "Overview", "/workspace/engagement"], ["guard", "Guard log", "/workspace/engagement/guard"], ["rules", "Contact rules", "/workspace/engagement/rules"]];
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

export function Engagement({ tab = "overview" }) {
  const s = useStore();
  const { path, query } = useRoute();
  const wide = useMedia("(min-width: 1280px)");
  const open = parseAcc(query.a);
  const [grid, setGridState] = useState({ view: query.view || "all", text: "", owner: "all", channel: "all", sort: { key: "verdict", dir: 1 }, selected: [] });
  const setGrid = (o) => { setGridState((g) => ({ ...g, ...o })); setCursor(null); };
  const [cursor, setCursor] = useState(null);
  const [log, setLog] = useState(null);
  const filterRef = useRef(null);
  const rows = useMemo(() => q.engagementAccounts(s, grid), [s, grid]);
  const go = (o) => { const qs = new URLSearchParams(Object.fromEntries(Object.entries({ ...query, ...o }).filter(([, v]) => v))).toString(); navigate(path + (qs ? "?" + qs : "")); };
  // ⌘K's "Log a touch with …" arrives as ?log=1: open the dialog once, then drop it from the address.
  useEffect(() => { if (query.log) { setLog({ refTo: open || null }); go({ log: "" }); } }, [query.log]);
  const openAcc = (r) => go({ a: r ? q.accKey(r) : "" });
  const waiting = q.engagementWaiting(s), c = q.guardCounts(s);

  useEffect(() => {
    const k = (e) => {
      if (log || e.metaKey || e.ctrlKey || e.altKey || typing(e) || document.querySelector(".w-cmd")) return;
      if (e.key === "/" && tab === "overview") { e.preventDefault(); filterRef.current?.focus(); }
      else if ((e.key === "j" || e.key === "k") && tab === "overview" && rows.length) { e.preventDefault(); setCursor((i) => Math.max(0, Math.min(rows.length - 1, i == null ? 0 : i + (e.key === "j" ? 1 : -1)))); }
      else if (e.key === "l" || e.key === "L") { const r = open || (cursor != null && rows[cursor]?.ref); if (r || tab === "overview") { e.preventDefault(); setLog({ refTo: r || null }); } }
      else if (e.key === "Escape" && open && wide) openAcc(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [rows, cursor, open, log, tab, wide, query]);

  const inspector = open && q.accountOf(s, open) && <Inspector refTo={open} onClose={() => openAcc(null)} onLog={(preset) => setLog({ refTo: open, preset })} docked={wide ? "side" : "drawer"} />;
  return (
    <div className="w-wide">
      <PageHeader title="Engagement" purpose="Every touch with every buyer and supplier, from people and agents, with the contact rules checked before anyone sends."
        actions={<Button variant="primary" icon="Plus" onClick={() => setLog({ refTo: open || null })} aria-keyshortcuts="L">Log a touch</Button>} />
      <Tabs label="Engagement" current={tab} tabs={TABS.map(([k, l, to]) => ({ key: k, label: l, to: to + (open ? "?a=" + q.accKey(open) : ""), count: k === "overview" ? waiting : k === "guard" ? c.pending : 0 }))} />
      <div className={"w-eng" + (open && wide ? " has-insp" : "")}>
        <div className="w-eng-main">
          {tab === "overview" && <Overview grid={grid} setGrid={setGrid} rows={rows} cursor={cursor} setCursor={setCursor} onOpen={openAcc} openKey={open && q.accKey(open)} filterRef={filterRef} />}
          {tab === "guard" && <GuardLog onOpen={openAcc} />}
          {tab === "rules" && <ContactRules />}
          <p className="w-sub w-keys w-hide-m" aria-hidden="true"><kbd className="w-kbd">J</kbd> <kbd className="w-kbd">K</kbd> move · <kbd className="w-kbd">Enter</kbd> open · <kbd className="w-kbd">L</kbd> log a touch · <kbd className="w-kbd">/</kbd> filter · <kbd className="w-kbd">Esc</kbd> close</p>
        </div>
        {open && wide && <aside className="w-eng-side" aria-labelledby="w-insp-title">{inspector}</aside>}
      </div>
      {open && !wide && q.accountOf(s, open) && (
        <Drawer open onClose={() => openAcc(null)} title={q.accountName(s, open)} label={`${q.accountName(s, open)}: engagement`}
          sub={<>{q.accountKind(open)} · owned by {q.ownerOf(s, open) ? q.actorName(s, q.ownerOf(s, open)) : "nobody"}<br /><PresenceDots list={q.presenceOn(s, open)} verbose /></>}
          footer={<Button variant="primary" icon="Plus" onClick={() => setLog({ refTo: open })}>Log a touch</Button>}>{inspector}</Drawer>
      )}
      <LogTouch open={!!log} onClose={() => setLog(null)} refTo={log?.refTo || null} preset={log?.preset} />
    </div>
  );
}

const fmt = (x) => (x.unit === "share" ? Math.round(x.value * 100) + "%" : x.unit === "hours" ? (x.value ? (x.value < 10 ? x.value.toFixed(1) : Math.round(x.value)) + " h" : "None") : x.value.toLocaleString("en-GB"));
function Overview({ grid, setGrid, rows, cursor, setCursor, onOpen, openKey, filterRef }) {
  const s = useStore();
  const figs = q.engagementFigures(s, 7);
  const needs = q.needsAttention(s);
  return (
    <>
      <div className="w-metrics w-metrics-6" role="list" aria-label="Last 7 days">
        {figs.map((x) => <div role="listitem" key={x.key}><MetricTile label={x.label} value={fmt(x)} delta={delta(x.value, x.before, { higherIsBetter: x.higherIsBetter, vs: "the 7 days before" })} /></div>)}
      </div>
      <div className="w-eng-top">
        <TouchChart days={30} />
        <section className="w-card w-needs" aria-labelledby="w-needs-h">
          <div className="w-row w-row-sp"><h2 className="w-h3" id="w-needs-h">Needs attention</h2><span className="w-count" aria-label={`${needs.length} waiting on us`}>{needs.length}</span></div>
          <p className="w-sub">Waiting on us, soonest limit first</p>
          {!needs.length ? <p className="w-sub" style={{ marginTop: 12 }}>Nothing is waiting on anyone.</p> : (
            <ol className="w-needs-l">
              {needs.map((n) => (
                <li key={n.key}>
                  <button type="button" className="w-needs-i" onClick={() => onOpen(n.ref)} aria-current={openKey === q.accKey(n.ref) || undefined}>
                    <Icon name={n.kind === "held" ? "ShieldCheck" : n.kind === "confirm" ? "CircleCheck" : "MessageCircle"} size={16} />
                    <span className="w-needs-b"><b>{n.title}</b><small>{n.detail}</small></span>
                    {n.kind === "held" ? <span className="w-verdict"><StatusChip tone="attn">Held</StatusChip><small className="tnum">{q.dueText(s, n.dueAt, "until")}</small></span> : <VerdictChip verdict={n.kind} dueAt={n.dueAt} />}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <AccountGrid grid={grid} setGrid={setGrid} rows={rows} cursor={cursor} setCursor={setCursor} onOpen={onOpen} openKey={openKey} filterRef={filterRef} />
    </>
  );
}
