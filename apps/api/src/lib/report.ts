// The health-check report: a self-contained page in the site's design system, served only after approval.
import { longDate } from "../../../../packages/core/util";
import { wordmarkSvg } from "../../../../packages/core/brand";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderReport(hc: { company: string; created_at: string }, rows: any[]) {
  const matched = rows.filter((r) => r.confidence === "high");
  const confirm = rows.filter((r) => r.confidence === "confirm");
  const none = rows.filter((r) => r.confidence === "none");
  const flagged = matched.filter((r) => (JSON.parse(r.extra || "{}").findings || []).length);
  const counts: Record<string, number> = {};
  for (const r of flagged) for (const f of JSON.parse(r.extra).findings) counts[f.title] = (counts[f.title] || 0) + 1;
  const summary = { sent: rows.length, matched: matched.length, confirm: confirm.length, unmatched: none.length, flagged: flagged.length, counts };
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Customer check, ${esc(hc.company)}</title>
<style>
:root{--paper:#fff;--stone:#F3F3F0;--rule:#D8D8D3;--graphite:#5E6166;--ink:#121417;--signal:#C8361E}
*{box-sizing:border-box}body{margin:0;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:var(--ink);background:var(--paper);line-height:1.5}
main{max-width:960px;margin:0 auto;padding:48px 24px 80px}h1{font-size:40px;letter-spacing:-.02em;margin:0 0 8px}h2{font-size:22px;margin:56px 0 12px}
.sub{color:var(--graphite)}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:40px}
.stats div{border-top:1px solid var(--ink);padding-top:10px}.stats b{display:block;font-size:40px;letter-spacing:-.03em}.stats .s{color:var(--signal)}
table{width:100%;border-collapse:collapse;border-top:1px solid var(--ink);font-size:15px}th,td{text-align:left;padding:10px 12px 10px 0;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-weight:400;color:var(--graphite);font-size:13px}.crit{color:var(--signal);font-weight:700}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.note{font-size:13px;color:var(--graphite);margin-top:40px}@media(max-width:600px){.stats{grid-template-columns:1fr 1fr}h1{font-size:30px}}
.brand{display:block;margin-bottom:40px}
</style></head><body><main>
<a class="brand" href="/">${wordmarkSvg(22)}</a>
<p class="sub">Customer check</p><h1>${esc(hc.company)}</h1><p class="sub">Run ${esc(longDate(hc.created_at))}. Every finding names the register it came from.</p>
<div class="stats"><div><span class="sub">Clients sent</span><b>${summary.sent}</b></div><div><span class="sub">Matched</span><b>${summary.matched}</b></div><div><span class="sub">For you to confirm</span><b>${summary.confirm}</b></div><div><span class="sub">Flagged</span><b class="s">${summary.flagged}</b></div></div>
<h2>Findings</h2>
${flagged.length ? `<table><thead><tr><th>Client</th><th>Company no.</th><th>Finding</th><th>Source</th></tr></thead><tbody>
${flagged.flatMap((r) => { const x = JSON.parse(r.extra); return x.findings.map((f: any) => `<tr><td>${esc(x.registered_name || x.name)}</td><td class="mono">${esc(r.chosen_number)}</td><td class="${f.severity === "Critical" ? "crit" : ""}">${esc(f.title)}. ${esc(f.summary)}</td><td>${esc(f.source)}</td></tr>`); }).join("")}
</tbody></table>` : `<p>Nothing flagged. Every matched client is active with filings up to date and no insolvency notices.</p>`}
${confirm.length ? `<h2>For you to confirm</h2><p class="sub">More than one company could match these names. We haven't guessed.</p><table><thead><tr><th>Your list</th><th>Possible matches</th></tr></thead><tbody>
${confirm.map((r) => `<tr><td>${esc(JSON.parse(r.extra).name || r.input)}</td><td>${JSON.parse(r.candidates || "[]").map((c: any) => `${esc(c.name)} <span class="mono">${esc(c.number)}</span>`).join("<br>")}</td></tr>`).join("")}</tbody></table>` : ""}
${none.length ? `<h2>Not matched</h2><p class="sub">Not found on Companies House. Often sole traders or partnerships, which aren't registered there.</p><table><tbody>${none.map((r) => `<tr><td>${esc(JSON.parse(r.extra).name || r.input)}</td></tr>`).join("")}</tbody></table>` : ""}
<p class="note">Sources: Companies House and The Gazette (Open Government Licence v3.0), FCA Financial Services Register. Facts, not verdicts: this report says what the public registers record and leaves decisions to you. Your list is deleted 30 days after this check.</p>
</main></body></html>`;
  return { html, summary };
}
