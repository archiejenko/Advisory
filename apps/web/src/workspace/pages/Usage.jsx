// Usage and credits inside the workspace: the credits page (balance, top-ups, use by agent and by mode, the
// ledger, plan changes) shown in the workspace shell, answered by the demo API from the same six agents.
import React from "react";
import { PageHeader } from "../ui.jsx";
import { WsCtx, useWs } from "../../layout.jsx";
import { DEMO_ME } from "../../demo.js";
import { EmbedCtx } from "../../pages/Live.jsx";
import { WsUsage } from "../../pages/Account.jsx";

export function Usage() {
  const ctx = useWs();
  return (
    <div>
      <PageHeader title="Usage and credits" purpose="What your AI Team has used this month, what's left, and your plan." crumbs={[["Setup", "/workspace/setup"], ["Usage and credits"]]} />
      <div style={{ marginTop: 20 }}>
        <WsCtx.Provider value={{ ...ctx, me: DEMO_ME }}><EmbedCtx.Provider value={true}><WsUsage /></EmbedCtx.Provider></WsCtx.Provider>
      </div>
    </div>
  );
}
