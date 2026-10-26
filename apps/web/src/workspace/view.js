// Owner view and accountant view: the same data with different words and defaults. The choice is saved per user.
import { useStore } from "./core.jsx";

const WORDS = {
  owed: ["Money owed to you", "Receivables"],
  bills: ["Bills", "Payables"],
  books: ["Books", "Ledger"],
  overdue: ["Overdue", "Overdue receivables"],
  owedShort: ["Owed to you", "Debtors"],
  oweShort: ["You owe", "Creditors"],
  collected: ["Collected", "Cash receipts"],
};
export function useView() {
  const view = useStore((s) => s.prefs.view);
  return { view, accountant: view === "accountant", say: (k) => (WORDS[k] ? WORDS[k][view === "accountant" ? 1 : 0] : k) };
}
