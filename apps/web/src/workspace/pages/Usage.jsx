// Usage and credits: what the AI Team used, day by day for a year, who used it, the plan, and the biggest runs.
// Every figure comes from the credits history (packages/core/demoUsage.ts), priced from config/model-pricing.ts.
// ?agent= filters the heatmap; the sidebar's AI Team list and Spend by agent both set it.
import React from "react";
import { navigate, useRoute } from "../../router.jsx";
import { useStore } from "../core.jsx";
import { MetricTile, PageHeader, delta } from "../ui.jsx";
import * as q from "../demo/selectors";
import { pounds } from "../demo/format";
import { Heatmap } from "../usage/Heatmap.jsx";
import { SpendByAgent } from "../usage/SpendByAgent.jsx";
import { PlanCard } from "../usage/PlanCard.jsx";
import { BiggestRuns } from "../usage/BiggestRuns.jsx";

const n = (x) => Math.round(x).toLocaleString("en-GB");
export function Usage() {
  const s = useStore();
  const { path, query } = useRoute();
  const agentId = s.agents.some((a) => a.id === query.agent) ? query.agent : null;
  const onAgent = (id) => navigate(path + (id ? "?agent=" + id : ""));
  const f = q.usageFigures(s, 30);
  const vs = { vs: "the 30 days before" };
  return (
    <div className="w-wide">
      <PageHeader title="Usage and credits" purpose="What your AI Team used, day by day, and what's left on your plan. 1 credit is 1p of AI." crumbs={[["Setup", "/workspace/setup"], ["Usage and credits"]]}
        metrics={[
          <MetricTile key="c" label="Credits, last 30 days" value={n(f.now.credits)} delta={delta(f.now.credits, f.before.credits, { higherIsBetter: false, ...vs })} />,
          <MetricTile key="p" label="AI cost" value={pounds(f.now.cost)} delta={delta(f.now.cost, f.before.cost, { higherIsBetter: false, ...vs })} />,
          <MetricTile key="a" label="Actions" value={n(f.now.actions)} delta={delta(f.now.actions, f.before.actions, vs)} />,
          <MetricTile key="x" label="Credits per action" value={f.now.perAction.toFixed(1)} delta={delta(f.now.perAction, f.before.perAction, { higherIsBetter: false, ...vs })} />,
          <MetricTile key="l" label="Credits left this cycle" value={<span data-testid="usage-left">{n(f.left)}</span>} sub="Plan credits reset on the 1st; top-ups roll over" />,
        ]} />
      <div className="w-usage">
        <Heatmap agentId={agentId} onAgent={onAgent} />
        <div className="w-usage-2">
          <SpendByAgent agentId={agentId} onAgent={onAgent} />
          <PlanCard />
        </div>
        <BiggestRuns />
      </div>
    </div>
  );
}
