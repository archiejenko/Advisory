// This month's credits for the demo business: the same history and selectors as the Usage page, so every screen agrees.
import { useStore } from "./core.jsx";
import * as q from "./demo/selectors";

export function useCredits() {
  const s = useStore();
  const p = q.planStatus(s);
  return { left: Math.round(p.left), used: Math.round(p.used), plan: p.allowance, resetOn: p.resetOn, paused: p.left <= 0, byAgent: q.monthByAgent(s) };
}
