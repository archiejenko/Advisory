// A hub page: header with its numbers, a tab for each app, and the app's view underneath. Apps that are outsourced
// or kept in another tool show as read-only cards. Every row opens a drawer with "Open full record".
import React from "react";
import { Icon, useStore } from "../core.jsx";
import { AgentBadge, Button, EmptyState, PageHeader, StatusChip, Tabs } from "../ui.jsx";
import { HUBS, appName, elsewhereApps, shellApps } from "../demo/catalogue";
import { ukDate } from "../demo/format";

const DEADLINES = { vat: ["Next return due", 7 * 86400e3 + 12 * 86400e3], yearend: ["Accounts due", 156 * 86400e3], payroll: ["Next pay run", 2 * 86400e3], books: ["Last synced", -2 * 3600e3] };

export function ElsewhereCards({ hub }) {
  const s = useStore();
  const list = elsewhereApps(s.os, hub);
  if (!list.length) return null;
  return (
    <section className="w-section" aria-labelledby={"w-else-" + hub}>
      <div className="w-section-h"><h2 id={"w-else-" + hub}>Handled elsewhere</h2><span className="w-sub">Read-only: these run outside the workspace, and agents keep them in step</span></div>
      <div className="w-elsewhere">
        {list.map((a) => {
          const m = s.os.apps[a.key];
          const [label, off] = DEADLINES[a.key] || ["Next check-in", 7 * 86400e3];
          return (
            <div key={a.key} className="w-card">
              <div className="w-row"><Icon name={a.icon} size={18} /><b>{appName(a, s.prefs.view)}</b><span style={{ flex: 1 }} /><StatusChip tone="neutral">{m.mode === "outsourced" ? "Outsourced" : "Kept in " + m.tool}</StatusChip></div>
              <dl className="w-dl" style={{ marginTop: 12, fontSize: 14 }}>
                <dt>{m.mode === "outsourced" ? "Provider" : "Tool"}</dt><dd>{m.provider || m.tool}</dd>
                <dt>{label}</dt><dd>{ukDate(new Date(Date.parse(s.now) + off).toISOString())}</dd>
                {a.agentId && <><dt>Kept in step by</dt><dd><AgentBadge agentId={a.agentId} /></dd></>}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HubFrame({ hub, tab, metrics, actions, children }) {
  const s = useStore();
  const h = HUBS.find((x) => x.id === hub);
  const apps = shellApps(s.os, hub);
  return (
    <div>
      <PageHeader title={h.name} purpose={h.purpose} metrics={metrics} actions={actions} />
      {apps.length ? <Tabs label={h.name + " apps"} current={tab} tabs={apps.map((a) => ({ key: a.key, label: appName(a, s.prefs.view), icon: a.icon, to: `/workspace/${hub}/${a.key}` }))} /> : null}
      <div style={{ marginTop: 20 }}>
        {apps.length ? children : <EmptyState icon={h.icon} title={`No ${h.name.toLowerCase()} apps switched on`} body="Turn apps on in Setup and they appear here as tabs." action={<Button variant="primary" to="/workspace/setup">Open Setup</Button>} />}
      </div>
      <ElsewhereCards hub={hub} />
    </div>
  );
}

/** The app a tab belongs to, if it's on in this workspace. */
export function useTab(hub, tab) {
  const s = useStore();
  const apps = shellApps(s.os, hub);
  return apps.find((a) => a.key === tab) || apps[0] || null;
}
