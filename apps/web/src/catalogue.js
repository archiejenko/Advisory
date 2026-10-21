// The first-party tool catalogue, for pages that render before /v1/tools answers (and for the offline copy).
// The live catalogue, including developer tools, comes from GET /v1/tools.
export const TOOLS = [
  ["uk-check", "Check a UK company", 5, "Companies", "Resolve, profile and flag a UK company in one call: the moment before you pay, sign or onboard."],
  ["uk-resolve", "Resolve a UK company", 2, "Companies", "Turn a name, website, invoice line or email signature into ranked UK companies with a confidence score."],
  ["uk-profile", "UK company profile", 3, "Companies", "Every field for one company number: status, filings, officers, PSCs, charges, Gazette notices, FCA status, each sourced."],
  ["find-companies", "Find UK companies", 5, "Companies", "Active companies by postcode district, industry and age. Up to 25 a call."],
  ["company-research", "Company research", 8, "Research", "The register check plus the top web results about a company, including its likely website."],
  ["web-research", "Web research", 3, "Research", "Search the web for a question and get ranked results with links and snippets."],
  ["read-page", "Read a web page", 1, "Research", "The readable text of one public page, its title, and any email addresses on it."],
  ["uk-watch", "Watch UK companies", 10, "Companies", "Subscribe to changes on a set of companies; each change is posted to your webhook, signed."],
].map(([slug, name, pence, group, description]) => ({ slug, name, description, group, price: { pence }, publisher: "Agent House" }));

export const AGENT_RUN_PENCE = 25;
export const pence = (p) => (p < 100 ? `${p}p` : "£" + (p / 100).toFixed(2));
