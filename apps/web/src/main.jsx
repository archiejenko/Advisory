import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);

/* On phones, data tables become cards (see .m-cards in theme.css). Each cell carries its column's heading
   so a card can label "Amount", "Due" or "Status" without the header row. Tables that already have their own
   phone layout (use cases, prices, endpoints) are left alone. */
const CARD_TABLES = "main table.ledger:not(.uc-table):not(.price-table):not(.endpoints), main table.co-t";
let queued = false;
function labelTables() {
  queued = false;
  for (const t of document.querySelectorAll(CARD_TABLES)) {
    const heads = [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim());
    if (!heads.length) continue;
    t.classList.add("m-cards");
    for (const tr of t.querySelectorAll("tbody tr")) {
      [...tr.children].forEach((td, i) => { if (heads[i] && td.getAttribute("data-l") !== heads[i]) td.setAttribute("data-l", heads[i]); });
    }
  }
}
new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(labelTables); } })
  .observe(document.getElementById("root"), { childList: true, subtree: true });
