// Every buyer and supplier on one grid: saved views, a filter, owner and channel filters, sortable columns, bulk
// actions (assign an owner, pause automations, export CSV), a 14-day touch strip and who's on each account now.
import React, { useEffect, useRef } from "react";
import { Icon, toast, useStore } from "../core.jsx";
import { ActorName, Button, FilterChips } from "../ui.jsx";
import { assignOwner, pauseSequences } from "../demo/store";
import * as q from "../demo/selectors";
import { relative } from "../demo/format";
import { toCsv } from "../../../../../packages/core/csv";
import { ChannelIcon, PresenceDots, TouchStrip, VerdictChip } from "./bits.jsx";

const COLS = [
  { key: "name", label: "Account" }, { key: "verdict", label: "Next step" }, { key: "owner", label: "Owner" },
  { key: "last", label: "Last touch" }, { key: null, label: "Last 14 days" }, { key: "touches", label: "30 days", num: true },
];

export function AccountGrid({ grid, setGrid, rows, cursor, setCursor, onOpen, openKey, filterRef }) {
  const s = useStore();
  const counts = q.viewCounts(s);
  const owners = q.accountOwners(s);
  const sel = grid.selected;
  const allOn = rows.length > 0 && rows.every((r) => sel.includes(r.key));
  const toggle = (k) => setGrid({ selected: sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k] });
  const refs = rows.filter((r) => sel.includes(r.key)).map((r) => r.ref);
  const sortBy = (key) => setGrid({ sort: { key, dir: grid.sort.key === key ? -grid.sort.dir : 1 } });
  const body = useRef(null);
  // Keep the keyboard cursor's row in view and focused.
  useEffect(() => { if (cursor != null) body.current?.querySelectorAll("tr")[cursor]?.focus({ preventScroll: false }); }, [cursor]);
  const exportCsv = () => {
    const list = refs.length ? rows.filter((r) => sel.includes(r.key)) : rows;
    const url = URL.createObjectURL(new Blob([toCsv(q.engagementCsv(s, list))], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "engagement.csv"; a.click(); URL.revokeObjectURL(url);
    toast(`Exported ${list.length} ${list.length === 1 ? "account" : "accounts"} as CSV.`);
  };
  return (
    <section className="w-section" aria-labelledby="w-grid-h">
      <div className="w-section-h"><h2 id="w-grid-h">Accounts</h2><span className="w-sub">Every buyer and supplier, and where each stands</span></div>
      <FilterChips label="Saved views" value={grid.view} onChange={(v) => setGrid({ view: v, selected: [] })} options={q.ENG_VIEWS.map((v) => [v.key, v.label, counts[v.key]])} />
      <div className="w-row w-grid-tools">
        <label className="w-search"><Icon name="Search" size={16} /><span className="sr-only">Filter accounts</span>
          <input ref={filterRef} className="w-input" type="search" placeholder="Filter by name" value={grid.text} onChange={(e) => setGrid({ text: e.target.value })} />
          <kbd className="w-kbd" aria-hidden="true">/</kbd>
        </label>
        <label className="w-field-inline"><span>Owner</span>
          <select className="w-input" value={grid.owner} onChange={(e) => setGrid({ owner: e.target.value })}>
            <option value="all">Anyone</option>{owners.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="w-field-inline"><span>Channel</span>
          <select className="w-input" value={grid.channel} onChange={(e) => setGrid({ channel: e.target.value })}>
            <option value="all">Any</option>{q.CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <span className="w-sp" />
        <Button size="sm" icon="ExternalLink" onClick={exportCsv}>{refs.length ? `Export ${refs.length}` : "Export CSV"}</Button>
      </div>
      {refs.length > 0 && (
        <div className="w-bulk" role="region" aria-label="Bulk actions">
          <b className="tnum">{refs.length} selected</b>
          <label className="w-field-inline"><span>Assign owner</span>
            <select className="w-input" value="" onChange={(e) => { if (!e.target.value) return; const [kind, id] = e.target.value.split(":"); const tok = assignOwner(refs, { kind, id }); toast(`Owner changed on ${refs.length}.`, { undo: tok }); }}>
              <option value="">Choose…</option>
              <optgroup label="People">{s.people.filter((p) => p.team === "office" || p.role === "Crew lead").map((p) => <option key={p.id} value={"person:" + p.id}>{p.name}</option>)}</optgroup>
              <optgroup label="AI Team">{s.agents.map((a) => <option key={a.id} value={"agent:" + a.id}>{a.name} · {a.roleName}</option>)}</optgroup>
            </select>
          </label>
          <Button size="sm" icon="Pause" onClick={() => { const tok = pauseSequences(refs); toast("Paused the agents' automations on those accounts.", { undo: tok }); }}>Pause automations</Button>
          <Button size="sm" variant="ghost" onClick={() => setGrid({ selected: [] })}>Clear</Button>
        </div>
      )}
      <div className="w-table-wrap w-eng-grid">
        <table className="w-table">
          <caption className="sr-only">Accounts, {q.ENG_VIEWS.find((v) => v.key === grid.view).label}. J and K move, Enter opens.</caption>
          <thead><tr>
            <th className="w-cb"><input type="checkbox" checked={allOn} onChange={() => setGrid({ selected: allOn ? [] : rows.map((r) => r.key) })} aria-label="Select every account shown" /></th>
            {COLS.map((c) => (
              <th key={c.label} className={[c.num && "num", (c.key === "owner" || c.key === "touches" || c.key === "last") && "w-hide-insp"].filter(Boolean).join(" ") || undefined} aria-sort={c.key && grid.sort.key === c.key ? (grid.sort.dir === 1 ? "ascending" : "descending") : undefined}>
                {c.key ? <button type="button" onClick={() => sortBy(c.key)}>{c.label}<Icon name="ArrowUpDown" size={12} /></button> : c.label}
              </th>
            ))}
          </tr></thead>
          <tbody ref={body}>
            {rows.map((r, i) => (
              <tr key={r.key} tabIndex={cursor === i || (cursor == null && i === 0) ? 0 : -1} aria-selected={openKey === r.key} className={(cursor === i ? "is-cursor" : "") + (openKey === r.key ? " is-open" : "")}
                onFocus={() => setCursor(i)} onClick={(e) => { if (!e.target.closest("a,button,input,label")) onOpen(r.ref); }} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(r.ref); if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); toggle(r.key); } }}>
                <td className="w-cb"><input type="checkbox" checked={sel.includes(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.name}`} /></td>
                <td data-label="Account"><button type="button" className="w-cell-main w-linklike" onClick={() => onOpen(r.ref)}>{r.name}</button><span className="w-cell-sub">{r.kind} · {r.status}{r.holds > 0 && <> · <b className="w-held-n">{r.holds} held</b></>}</span><PresenceDots list={r.presence} /></td>
                <td data-label="Next step"><VerdictChip verdict={r.verdict} dueAt={r.dueAt} /></td>
                <td data-label="Owner" className="w-hide-m w-hide-insp">{r.owner ? <ActorName actor={r.owner} /> : <span className="muted">Nobody</span>}</td>
                <td data-label="Last touch" className="w-hide-insp">{r.last ? <span className="w-last"><ChannelIcon channel={r.last.channel} /><span>{relative(r.last.at, s.now > r.last.at ? s.now : undefined)}</span></span> : <span className="muted">None</span>}</td>
                <td data-label="Last 14 days"><TouchStrip refTo={r.ref} /></td>
                <td data-label="30 days" className="num w-hide-m w-hide-insp">{r.touches30}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="w-table-state"><p className="w-sub">No accounts match. Clear the filter or pick another view.</p></div>}
      </div>
    </section>
  );
}
