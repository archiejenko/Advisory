import React from "react";
import { RouterProvider, useRoute, match } from "./router.jsx";
import { Header, Footer, WorkspaceProvider } from "./layout.jsx";
import Home from "./pages/Home.jsx";
import { AgentsIndex, AgentPage } from "./pages/Agents.jsx";
import { Start, Unsubscribe } from "./pages/Start.jsx";
import Method from "./pages/Method.jsx";
import UseCases from "./pages/UseCases.jsx";
import { WsOverview, WsAgents, WsHire, WsAgent, WsRun, WsApprovals, WsActivity, WsLeads, WsInbox, WsInvoices, WsTasks } from "./pages/Ws.jsx";
import { WsUsage, WsSettings } from "./pages/Account.jsx";
import { HealthCheck, Pricing, Standards, Developers, BookCall, NotFound } from "./pages/Service.jsx";
import { Gate, SignIn, LiveAlerts, LiveClients, LiveClient, LiveCheck, LiveImport, LiveProspects } from "./pages/Live.jsx";
import Admin from "./pages/Admin.jsx";
import { DevDashboard, ForAgents } from "./pages/Dev.jsx";
import { FloorHome, FloorView } from "./pages/Floor.jsx";
import { WsToday, WsRules } from "./pages/Today.jsx";
import { WsApps, WsModule, WsMessages } from "./pages/Os.jsx";
import { OsPage } from "./pages/OsPublic.jsx";
import { WsHome } from "./pages/OsHome.jsx";
import { WsBuild } from "./pages/Builder.jsx";

// Workspace pages show your workspace when signed in, and the demo workspace when not.
const ws = (live) => (props) => <Gate live={live} {...props} />;

const ROUTES = [
  ["/", Home],
  ["/agents", AgentsIndex],
  ["/agents/:slug", AgentPage],
  ["/start", Start],
  ["/unsubscribe", Unsubscribe],
  ["/how-it-works", Method],
  ["/os", OsPage],
  ["/use-cases", UseCases],
  ["/method", Method],
  ["/workspace", ws(WsHome)],
  ["/workspace/today", ws(WsToday)],
  ["/workspace/build", ws(WsBuild)],
  ["/workspace/settings/os", ws(WsBuild)],
  ["/workspace/overview", ws(WsOverview)],
  ["/workspace/apps", ws(WsApps)],
  ["/workspace/app/:module", ws(WsModule)],
  ["/workspace/messages", ws(WsMessages)],
  ["/workspace/rules", ws(WsRules)],
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
  ["/floor", ws(FloorHome)],
  ["/floor/:id", ws(FloorView)],
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

// The workspace and the Floor are the OS: full screen, with no website header or footer.
const isOs = (path) => /^\/(workspace|floor)(\/|$)/.test(path);
function Chrome({ children }) {
  const { path } = useRoute();
  const os = isOs(path);
  return (
    <>
      {!os && <Header />}
      <main id="main" tabIndex={-1} className={os ? "main-os" : undefined}>{children}</main>
      {!os && <Footer />}
    </>
  );
}

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
        <Chrome><Routes /></Chrome>
      </WorkspaceProvider>
    </RouterProvider>
  );
}
