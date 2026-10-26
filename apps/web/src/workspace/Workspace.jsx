// The demo workspace's own routes. App.jsx hands every /workspace and /floor path here when nobody is signed in;
// signed-in customers keep the live workspace pages.
import React, { useEffect } from "react";
import { navigate, useRoute } from "../router.jsx";
import { AppShell } from "./AppShell.jsx";
import { Design } from "./pages/Design.jsx";
import { Home } from "./pages/Home.jsx";
import { Customers } from "./hubs/Customers.jsx";
import { Money } from "./hubs/Money.jsx";
import { Work } from "./hubs/Work.jsx";
import { Team } from "./hubs/Team.jsx";
import { RecordPage } from "./records/Records.jsx";
import { Setup } from "./pages/Setup.jsx";
import { EmptyState, Button, Toaster } from "./ui.jsx";
import { Start } from "./pages/Start.jsx";
import { Link } from "../router.jsx";

const HUB_PAGES = { customers: Customers, money: Money, work: Work, team: Team };

/** Old demo addresses, sent to where that thing lives now. */
const LEGACY = {
  "/workspace/today": "/workspace", "/workspace/overview": "/workspace", "/workspace/approvals": "/workspace",
  "/workspace/build": "/workspace/setup", "/workspace/settings/os": "/workspace/setup", "/workspace/apps": "/workspace/setup", "/workspace/settings": "/workspace/setup", "/workspace/usage": "/workspace/setup",
  "/workspace/messages": "/workspace/team/chat", "/workspace/agents": "/workspace/team", "/workspace/agents/new": "/workspace/team/floor", "/workspace/activity": "/workspace", "/workspace/rules": "/workspace/team",
  "/workspace/leads": "/workspace/customers/leads", "/workspace/inbox": "/workspace/customers/inbox", "/workspace/invoices": "/workspace/money/invoices", "/workspace/tasks": "/workspace/work/tasks",
  "/workspace/alerts": "/workspace/customers", "/workspace/clients": "/workspace/customers/leads", "/workspace/check": "/workspace/customers", "/workspace/import": "/workspace/setup", "/workspace/prospects": "/workspace/customers/leads",
};

function Redirect({ to }) { useEffect(() => { navigate(to); }, [to]); return null; }

export function Workspace() {
  const { path } = useRoute();
  if (LEGACY[path]) return <Redirect to={LEGACY[path]} />;
  const parts = path.split("/").filter(Boolean); // ["workspace", hub, tab, id]
  if (parts[1] === "start") {
    // Onboarding gets a quiet frame: no navigation until the workspace exists.
    return (
      <div className="wk">
        <header className="w-top" style={{ position: "static" }}><Link to="/" className="w-brand" style={{ margin: 0 }}><span className="w-brand-mark" aria-hidden="true">A</span><b>Agent House</b></Link><span style={{ flex: 1 }} /><Link to="/workspace" className="w-link">Back to the demo</Link></header>
        <main id="w-main" tabIndex={-1} className="w-content"><Start /></main>
        <Toaster />
      </div>
    );
  }
  let page;
  if (parts[0] === "floor") page = <Team tab="floor" />;
  else if (parts.length === 1) page = <Home />;
  else if (parts[1] === "design") page = <Design />;
  else if (parts[1] === "setup") page = <Setup />;
  else if (HUB_PAGES[parts[1]]) {
    const H = HUB_PAGES[parts[1]];
    if (parts[1] === "team" && parts[2] === "floor") page = <Team tab="floor" />;
    else page = parts[3] ? <RecordPage hub={parts[1]} tab={parts[2]} id={parts.slice(3).join("/")} /> : <H tab={parts[2]} />;
  } else page = <EmptyState icon="Search" title="There's nothing at this address" body="The page may have moved. Everything starts from Home." action={<Button variant="primary" to="/workspace">Go to Home</Button>} />;
  return <AppShell key={parts[1] === "start" ? "start" : "shell"}>{page}</AppShell>;
}
