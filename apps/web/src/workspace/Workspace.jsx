// The demo workspace's own routes. App.jsx hands every /workspace and /floor path here when nobody is signed in;
// signed-in customers keep the live workspace pages.
import React, { useEffect } from "react";
import { navigate, useRoute } from "../router.jsx";
import { AppShell } from "./AppShell.jsx";
import { Design } from "./pages/Design.jsx";

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
  let page;
  if (parts[1] === "design") page = <Design />;
  else page = <Design />;
  return <AppShell>{page}</AppShell>;
}
