// This month's credits for the demo business, from the same summary the Usage page shows.
import { useApi } from "../api.js";

export function useCredits() {
  const { data } = useApi("/api/ws/usage");
  const c = data?.credits;
  return c ? { left: c.balance.available, used: c.used, plan: c.plan_credits, resetOn: c.reset_on, paused: c.paused, byAgent: c.by_agent || [] } : null;
}
