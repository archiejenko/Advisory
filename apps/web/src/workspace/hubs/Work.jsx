// Work: jobs (list or calendar), the rota, one task list for people and agents, and contracts.
import React, { useState } from "react";
import { navigate, useRoute } from "../../router.jsx";
import { toast, useStore } from "../core.jsx";
import { ActorName, Avatar, Button, DataTable, EmptyState, FilterChips, MetricTile, RecordDrawer, RecordLink, SegmentedControl, StatusChip, cap } from "../ui.jsx";
import { HubFrame, useTab } from "./Hub.jsx";
import { GenericApp } from "./Money.jsx";
import { Summary } from "../records/Summary.jsx";
import { addTask, setTask } from "../demo/store";
import * as q from "../demo/selectors";
import { clock, plural, pounds, ukDate, ukDay, ukShort } from "../demo/format";

const D = 86400e3;
const weekFrom = (s) => { const d = new Date(Date.parse(s.now)); d.setHours(12, 0, 0, 0); const back = (d.getDay() + 6) % 7; return Array.from({ length: 7 }, (_, i) => d.getTime() + (i - back) * D); };
const isToday = (s, t) => new Date(t).toDateString() === new Date(Date.parse(s.now)).toDateString();

function Jobs() {
  const s = useStore();
  const { query, path } = useRoute();
  const view = query.view || "list";
  const [open, setOpen] = useState(null);
  const days = weekFrom(s);
  return (
    <>
      <div className="w-row" style={{ marginBottom: 12 }}>
        <SegmentedControl label="Show jobs as" value={view} onChange={(v) => navigate(path + (v === "list" ? "" : "?view=" + v))} options={[["list", "List"], ["calendar", "This week"]]} />
        <span className="w-sub">{plural(s.jobs.filter((j) => j.kind === "clean" && j.status !== "done").length, "regular clean")} · {plural(s.jobs.filter((j) => j.kind === "visit").length, "site visit")}</span>
      </div>
      {view === "list" ? (
        <DataTable caption="Jobs" columns={[
          { key: "c", label: "Customer", sort: (r) => q.company(s, r.companyId).name, render: (r) => <><span className="w-cell-main">{q.company(s, r.companyId).short}</span><span className="w-cell-sub">{r.title}</span></> },
          { key: "w", label: "When", render: (r) => q.scheduleText(r) },
          { key: "crew", label: "Crew", render: (r) => <span className="w-crew" aria-label={r.crewIds.map((p) => q.person(s, p)?.name).join(", ")}>{r.crewIds.map((p) => <Avatar key={p} actor={{ kind: "person", id: p }} />)}</span> },
          { key: "v", label: "A month", num: true, sort: (r) => r.monthlyValue || 0, render: (r) => (r.monthlyValue ? pounds(r.monthlyValue) : "—"), hideMobile: true },
          { key: "st", label: "Status", render: (r) => <StatusChip tone={r.status === "proposed" ? "attn" : r.status === "scheduled" ? "agent" : "done"}>{r.status === "proposed" ? "To confirm" : r.status === "scheduled" ? (r.kind === "visit" ? "Booked" : "Starts " + ukShort(r.startsOn)) : "Running"}</StatusChip> },
        ]} rows={s.jobs} onRow={(r) => setOpen(r.id)} empty={<EmptyState icon="SprayCan" title="No jobs yet" body="When a quote is accepted, Owen sets the job up here with its crew." />} />
      ) : (
        <div className="w-cal" role="grid" aria-label="Jobs this week">
          {days.map((t) => (
            <div key={t} className={"w-cal-d" + (isToday(s, t) ? " is-today" : "")} role="gridcell">
              <h4>{ukDay(new Date(t).toISOString())}</h4>
              {q.jobsOn(s, t).map((j) => (
                <button key={j.id} type="button" className={"w-cal-j" + (j.kind === "visit" ? " visit" : "")} onClick={() => setOpen(j.id)}>
                  <b>{q.company(s, j.companyId).short}</b>{clock(j.schedule.time)} · {j.crewIds.map((p) => q.person(s, p)?.name.split(" ")[0]).join(", ")}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {open && <RecordDrawer refTo={{ type: "job", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "job", id: open }} /></RecordDrawer>}
    </>
  );
}

function Rota() {
  const s = useStore();
  const days = weekFrom(s);
  const crew = s.people.filter((p) => p.team === "crew" || p.id === "p_sam");
  const rotaTask = s.tasks.find((t) => t.id === "task_rota");
  return (
    <>
      <div className="w-row" style={{ marginBottom: 12 }}>
        <span className="w-sub">Week {isoWeekOf(s)} · built by Owen from the jobs list</span>
        {rotaTask && rotaTask.status === "open" && <StatusChip tone="attn">Sam sends it to the crew by {ukDay(rotaTask.dueAt)}</StatusChip>}
      </div>
      <div className="w-table-wrap" style={{ maxHeight: "none" }}>
        <table className="w-rota">
          <thead><tr><th scope="col">Person</th>{days.map((t) => <th key={t} scope="col">{ukDay(new Date(t).toISOString())}</th>)}</tr></thead>
          <tbody>
            {crew.map((p) => (
              <tr key={p.id}>
                <th scope="row" style={{ textAlign: "left", fontWeight: 500 }}><RecordLink refTo={{ type: "person", id: p.id }} /><div className="w-sub">{p.role}</div></th>
                {days.map((t) => {
                  const jobs = q.jobsOn(s, t).filter((j) => j.crewIds.includes(p.id));
                  return <td key={t}>{jobs.map((j) => <RecordLink key={j.id} refTo={{ type: "job", id: j.id }} className="w-shift">{clock(j.schedule.time)} {q.company(s, j.companyId).short}</RecordLink>)}{!jobs.length && <span className="w-sub">Off</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function isoWeekOf(s) {
  const d = new Date(Date.parse(s.now)); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / D + 1) / 7);
}

function Tasks() {
  const s = useStore();
  const { query, path } = useRoute();
  const f = query.f || "open";
  const [open, setOpen] = useState(null);
  const [title, setTitle] = useState("");
  const [who, setWho] = useState("person:p_dana");
  const rows = s.tasks.filter((t) => (f === "open" ? t.status === "open" : f === "mine" ? t.status === "open" && t.assignee.id === "p_dana" : f === "agents" ? t.status === "open" && t.assignee.kind === "agent" : t.status === "done")).sort((a, b) => (a.dueAt || "9").localeCompare(b.dueAt || "9"));
  const add = (e) => {
    e.preventDefault();
    if (title.trim().length < 3) return;
    const [kind, id] = who.split(":");
    const tok = addTask({ title: title.trim(), assignee: { kind, id }, dueAt: null, linkedRecord: null });
    setTitle(""); toast("Task added.", { undo: tok });
  };
  return (
    <>
      <form className="w-row" onSubmit={add} style={{ marginBottom: 4 }}>
        <label className="sr-only" htmlFor="w-task">New task</label>
        <input id="w-task" className="w-input" style={{ flex: "1 1 240px", width: "auto" }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task, e.g. Order more bin liners" />
        <label className="sr-only" htmlFor="w-who">For</label>
        <select id="w-who" className="w-input" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)}>
          <optgroup label="People">{s.people.map((p) => <option key={p.id} value={"person:" + p.id}>{p.name}</option>)}</optgroup>
          <optgroup label="Agents">{s.agents.map((a) => <option key={a.id} value={"agent:" + a.id}>{a.name} · {a.roleName}</option>)}</optgroup>
        </select>
        <Button type="submit" variant="primary" icon="Plus">Add</Button>
      </form>
      <FilterChips label="Show tasks" value={f} onChange={(v) => navigate(path + (v === "open" ? "" : "?f=" + v))} options={[["open", "Open", q.openTasks(s).length], ["mine", "Mine", q.openTasks(s).filter((t) => t.assignee.id === "p_dana").length], ["agents", "Agents'", q.openTasks(s).filter((t) => t.assignee.kind === "agent").length], ["done", "Done", s.tasks.filter((t) => t.status === "done").length]]} />
      <DataTable caption="Tasks" columns={[
        { key: "x", label: "Done", render: (r) => <input type="checkbox" aria-label={`Mark "${r.title}" ${r.status === "done" ? "not done" : "done"}`} checked={r.status === "done"} onChange={(e) => { const tok = setTask(r.id, e.target.checked); toast(e.target.checked ? "Ticked off." : "Reopened.", { undo: tok }); }} style={{ width: 18, height: 18 }} /> },
        { key: "t", label: "Task", sort: (r) => r.title, render: (r) => <><span className="w-cell-main" style={r.status === "done" ? { textDecoration: "line-through", color: "var(--text-muted)" } : undefined}>{r.title}</span>{r.linkedRecord && <span className="w-cell-sub"><RecordLink refTo={r.linkedRecord} /></span>}</> },
        { key: "a", label: "For", render: (r) => <span className="w-row" style={{ gap: 8, flexWrap: "nowrap" }}><Avatar actor={r.assignee} /><ActorName actor={r.assignee} /></span> },
        { key: "d", label: "Due", sort: (r) => r.dueAt || "9", render: (r) => (r.dueAt ? <span style={r.status === "open" && Date.parse(r.dueAt) < Date.parse(s.now) ? { color: "var(--status-risk)" } : undefined}>{ukDay(r.dueAt)}</span> : "—") },
      ]} rows={rows} onRow={(r) => setOpen(r.id)} empty={<EmptyState icon="ListChecks" title="Nothing to do here" body="Tasks for people and agents land here, linked to the record they're about." />} />
      {open && <RecordDrawer refTo={{ type: "task", id: open }} onClose={() => setOpen(null)}><Summary refTo={{ type: "task", id: open }} /></RecordDrawer>}
    </>
  );
}

function Contracts() {
  const s = useStore();
  return (
    <DataTable caption="Contracts" initialSort={{ key: "v", dir: "desc" }} columns={[
      { key: "c", label: "Customer", sort: (r) => q.company(s, r.companyId).name, render: (r) => <><RecordLink refTo={{ type: "company", id: r.companyId }} /><span className="w-cell-sub">{r.title}</span></> },
      { key: "v", label: "A month", num: true, sort: (r) => r.monthlyValue, render: (r) => pounds(r.monthlyValue) },
      { key: "s", label: "Started", sort: (r) => r.startsOn, render: (r) => ukDate(r.startsOn), hideMobile: true },
      { key: "e", label: "Renews", sort: (r) => r.endsOn, render: (r) => ukDate(r.endsOn) },
      { key: "st", label: "Status", render: (r) => <StatusChip tone={r.status === "ending" ? "attn" : Date.parse(r.startsOn) > Date.parse(s.now) ? "agent" : "done"}>{r.status === "ending" ? "Renewal due" : Date.parse(r.startsOn) > Date.parse(s.now) ? "Starts soon" : "Active"}</StatusChip> },
    ]} rows={s.contracts} onRow={(r) => navigate(`/workspace/customers/companies/${r.companyId}`)} empty={<EmptyState icon="FileSignature" title="No contracts yet" body="Accepted quotes become contracts here, with their renewal date." />} />
  );
}

const VIEWS = { jobs: Jobs, rota: Rota, tasks: Tasks, contracts: Contracts };

export function Work({ tab }) {
  const s = useStore();
  const app = useTab("work", tab);
  const V = app && VIEWS[app.key];
  const today = q.jobsToday(s);
  const late = q.openTasks(s).filter((t) => t.dueAt && Date.parse(t.dueAt) < Date.parse(s.now));
  const metrics = [
    <MetricTile key="j" label="Jobs today" value={today.length} to="/workspace/work/jobs?view=calendar" sub={`${q.crewToday(s).length} crew out`} />,
    <MetricTile key="t" label="Open tasks" value={q.openTasks(s).length} to="/workspace/work/tasks" sub={late.length ? `${late.length} overdue` : "None overdue"} tone={late.length ? "attn" : undefined} />,
    <MetricTile key="m" label="Mine" value={q.openTasks(s).filter((t) => t.assignee.id === "p_dana").length} to="/workspace/work/tasks?f=mine" sub="Tasks for Dana" />,
    <MetricTile key="c" label="Contracts" value={pounds(s.contracts.reduce((n, c) => n + c.monthlyValue, 0))} to="/workspace/work/contracts" sub={`a month, ${plural(s.contracts.length, "contract")}`} />,
  ];
  return <HubFrame hub="work" tab={app?.key} metrics={metrics}>{V ? <V /> : <GenericApp app={app} />}</HubFrame>;
}
export { cap };
