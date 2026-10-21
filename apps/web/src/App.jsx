import React from "react";
import { RouterProvider, useRoute, match } from "./router.jsx";
import { Header, Footer, WorkspaceProvider } from "./layout.jsx";
import Home from "./pages/Home.jsx";
import { AgentsIndex, AgentPage } from "./pages/Agents.jsx";
import { Start, Unsubscribe } from "./pages/Start.jsx";
import Method from "./pages/Method.jsx";
import { WsOverview, WsAgents, WsHire, WsAgent, WsRun, WsApprovals, WsActivity, WsLeads, WsInbox, WsInvoices, WsTasks } from "./pages/Ws.jsx";
import { WsUsage, WsSettings } from "./pages/Account.jsx";
import { HealthCheck, Pricing, Standards, Developers, BookCall, NotFound } from "./pages/Service.jsx";
import { Gate, SignIn, LiveAlerts, LiveClients, LiveClient, LiveCheck, LiveImport, LiveProspects } from "./pages/Live.jsx";
import Admin from "./pages/Admin.jsx";
import { DevDashboard, ForAgents } from "./pages/Dev.jsx";

// Workspace pages show your workspace when signed in, and the demo workspace when not.
const ws = (live) => (props) => <Gate live={live} {...props} />;

const ROUTES = [
  ["/", Home],
  ["/agents", AgentsIndex],
  ["/agents/:slug", AgentPage],
  ["/start", Start],
  ["/unsubscribe", Unsubscribe],
  ["/how-it-works", Method],
  ["/method", Method],
  ["/workspace", ws(WsOverview)],
  ["/workspace/approvals", ws(WsApprovals)],
  ["/workspace/agents", ws(WsAgents)],
  ["/workspace/agents/new", ws(WsHire)],
  ["/workspace/agents/:id", ws(WsAgent)],
  ["/workspace/activity", ws(WsActivity)],
  ["/workspace/runs/:id", ws(WsRun)],
  ["/workspace/leads", ws(WsLeads)],
  ["/workspace/inbox", ws(WsInbox)],
  ["/workspace/invoices", ws(WsInvoices)],
  ["/workspace/tasks", ws(WsTasks)],
  ["/workspace/alerts", ws(LiveAlerts)],
  ["/workspace/clients", ws(LiveClients)],
  ["/workspace/clients/:no", ws(LiveClient)],
  ["/workspace/check", ws(LiveCheck)],
  ["/workspace/import", ws(LiveImport)],
  ["/workspace/prospects", ws(LiveProspects)],
  ["/workspace/usage", ws(WsUsage)],
  ["/workspace/settings", ws(WsSettings)],
  ["/sign-in", SignIn],
  ["/admin", Admin],
  ["/health-check", HealthCheck],
  ["/pricing", Pricing],
  ["/trust", Standards],
  ["/standards", Standards],
  ["/developers", Developers],
  ["/developers/dashboard", DevDashboard],
  ["/for-agents", ForAgents],
  ["/book-a-call", BookCall],
];

function Routes() {
  const { path } = useRoute();
  for (const [pattern, C] of ROUTES) {
    const params = match(pattern, path);
    if (params) return <C key={path} {...params} />;
  }
  return <NotFound />;
}

export default function App() {
  return (
    <RouterProvider>
      <WorkspaceProvider>
        <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main").focus(); }}>Skip to content</a>
        <Header />
        <main id="main" tabIndex={-1}><Routes /></main>
        <Footer />
      </WorkspaceProvider>
    </RouterProvider>
  );
}
