import React, { useEffect, useState } from "react";
import { Link, useRoute } from "../router.jsx";
import { LIVE, api, useApi, useTurnstile } from "../api.js";
import { Page, PageHead, Section, SectionHead, SpecTable, QA, NextPrev, CtaBand, Range, CodePanel, Brief, gbp, gbp2 } from "../ui.jsx";
import { Reveal, Marquee, Terminal } from "../kit.jsx";
import { ApiShowcase, TERM } from "./showcase.jsx";
import { ENDPOINTS } from "../data.js";
import { TOOLS, AGENT_RUN_STEP_PENCE, pence } from "../catalogue.js";
import { PLANS } from "../../../../packages/core/templates.ts";

/* ---------- Shared form ---------- */
// Validates the shared fields, then calls `send` (the real request on the hosted site).
// Opened as a local file, there is no server, so the form only shows what would happen.
function useForm(fields, send, extraCheck) {
  const [f, setF] = useState(Object.fromEntries(fields.map((k) => [k, ""])));
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const miss = [];
    if (!f.name.trim()) miss.push("your name");
    if (!/^\S+@\S+\.\S+$/.test(f.email)) miss.push("a valid work email");
    if (!f.company.trim()) miss.push("your company name");
    const extra = extraCheck && extraCheck();
    if (extra) miss.push(extra);
    if (miss.length) return setErr("Add " + miss.join(", ") + " to continue.");
    setErr("");
    if (!LIVE || !send) return setSent(true);
    setBusy(true);
    try { await send(f); setSent(true); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return { f, setF, err, setErr, sent, busy, submit };
}

function Fields({ f, setF }) {
  return [["name", "Your name", "text", "name"], ["email", "Work email", "email", "email"], ["company", "Company name", "text", "organization"]].map(([k, l, t, ac]) => (
    <div className="field" key={k}>
      <label htmlFor={"f-" + k}>{l}</label>
      <input id={"f-" + k} type={t} autoComplete={ac} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  ));
}

/* ---------- Health check ---------- */
export function HealthCheck() {
  const [file, setFile] = useState(null);
  const ts = useTurnstile();
  const { f, setF, err, sent, busy, submit } = useForm(["name", "email", "company"], async (v) => {
    const fd = new FormData();
    for (const k of ["name", "email", "company"]) fd.append(k, v[k].trim());
    fd.append("file", file);
    if (ts.token) fd.append("cf-turnstile-response", ts.token);
    try { await api("POST", "/api/public/health-checks", fd); } catch (e) { ts.reset(); throw e; }
  }, () => (!file ? "your customer list" : !/\.(csv|xlsx)$/i.test(file.name) ? "a CSV or Excel (.xlsx) file" : !ts.ready ? "the check that you're not a robot" : ""));
  const findings = [["Dissolved or being struck off", 1], ["Insolvency notices", 1], ["Accounts or confirmation statement overdue", 3], ["Director or registered office changed in 90 days", 2]];
  return (
    <Page title="Free customer check">
      <PageHead crumbs={[["Customer check"]]} label="Free customer check" title="Who owes you money, and are they all right?" lede="Send your customer or supplier list. We check every company against Companies House and The Gazette and email you a sourced report within 24 hours: administrations, overdue accounts, strike-off notices, director changes." />
      <Section tight>
        <div className="grid">
          <form className="col-6 form" onSubmit={submit} noValidate>
            {sent ? (
              <div aria-live="polite">
                <h2 className="h-small">List received</h2>
                <p className="body mt-s">Your customer check for {f.company} will be sent to {f.email} within 24 hours.</p>
                <p className="more"><Link to="/book-a-call" className="link">Book a call to go through it together</Link></p>
                {!LIVE && <p className="source">Prototype: nothing was uploaded or sent.</p>}
              </div>
            ) : (
              <>
                <h2 className="h-small">Request your free check</h2>
                <Fields f={f} setF={setF} />
                <div className="field">
                  <span className="flabel">Customer or supplier list</span>
                  <label className={"file" + (file ? " has-file" : "")} htmlFor="f-file">
                    <span>{file ? file.name : "Choose a CSV or Excel file"}</span>
                    <span className="file-btn">{file ? "Change" : "Browse"}</span>
                    <input id="f-file" type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files[0] || null)} />
                  </label>
                </div>
                {ts.needed && <div className="field" ref={ts.el} />}
                {err && <p className="form-err" role="alert">{err}</p>}
                <button className="btn btn-block" type="submit" disabled={busy}>{busy ? "Sending…" : "Send my list"}</button>
                <p className="source">Names are enough; company numbers help. Used only for this check and deleted after 30 days.</p>
              </>
            )}
          </form>
          <div className="col-5 col-start-8">
            <p className="label">What happens next</p>
            <ol className="steps-v">
              <li><span className="m-n">01</span><div><b>You send the list</b><p>A spreadsheet export is fine. One column of names is enough.</p></div></li>
              <li><span className="m-n">02</span><div><b>We run it</b><p>Every name matched and checked against Companies House and The Gazette. Uncertain matches are listed for you to confirm.</p></div></li>
              <li><span className="m-n">03</span><div><b>You get the report</b><p>Within 24 hours, by email, with every finding sourced.</p></div></li>
              <li><span className="m-n">04</span><div><b>Optional call</b><p>Twenty minutes to go through it. No obligation.</p></div></li>
            </ol>
          </div>
        </div>
      </Section>
      <Section stone>
        <SectionHead label="Example report" title="What the report looks like" lede="The first page of an example report for a list of 214 customers. Every finding links to the register entry behind it." />
        <div className="sheet sheet-wide">
          <div className="sheet-head">
            <div><p className="sheet-kind">Customer check</p><p className="sheet-co">Brightwork Cleaning</p></div>
            <div className="sheet-meta"><span>Run 20 October 2026</span><span>214 companies sent</span></div>
          </div>
          <div className="hc-stats">
            <div><span className="dt">Matched</span><b>209</b></div>
            <div><span className="dt">For you to confirm</span><b>5</b></div>
            <div><span className="dt">Flagged</span><b className="signal">7</b></div>
          </div>
          <table className="sheet-tab">
            <thead><tr><th>Finding</th><th className="num">Companies</th></tr></thead>
            <tbody>{findings.map(([k, n]) => <tr key={k}><td>{k}</td><td className="num">{n}</td></tr>)}</tbody>
          </table>
          <p className="sheet-sig">Example figures. Your report lists each company by name with the register entry for each finding.</p>
        </div>
      </Section>
      <NextPrev prev={["Pricing", "/pricing"]} next={["Customer and supplier watch", "/agents/customer-watch"]} />
    </Page>
  );
}

/* ---------- Pricing ---------- */
export function Pricing() {
  return (
    <Page title="Pricing">
      <PageHead crumbs={[["Pricing"]]} label="Pricing" title="Simple for businesses. Per call for agents." lede="Businesses pay a monthly plan for agents that work for them. Developers and agents pay per tool call, with a free monthly allowance. Publishers earn 80% of every call to their tools." />
      <Section tight>
        <h2 className="h-sub">For businesses</h2>
        <div className="plans plans-l">
          <article className="plan">
            <p className="plan-n">Free trial</p>
            <p className="plan-p"><b>£0</b><span>for 14 days</span></p>
            <p className="dt">Everything in Growth. No card.</p>
            <ul className="ticks"><li>{PLANS.trial.agents} agents working at once</li><li>{PLANS.trial.actions.toLocaleString("en-GB")} actions</li><li>Every agent in the catalogue</li></ul>
            <Link to="/start" className="btn btn-sm btn-line btn-block">Start free</Link>
          </article>
          {["starter", "growth", "scale"].map((k) => {
            const p = PLANS[k];
            return (
              <article key={k} className={"plan" + (k === "growth" ? " is-pick" : "")}>
                <p className="plan-n">{p.name}{k === "growth" && <span className="st st-done">Most chosen</span>}</p>
                <p className="plan-p"><b>£{p.price}</b><span>a month</span></p>
                <p className="dt">{p.blurb}</p>
                <ul className="ticks"><li>{p.agents} agents working at once</li><li>{p.actions.toLocaleString("en-GB")} actions a month</li><li>Every agent in the catalogue</li></ul>
                <Link to="/start" className={"btn btn-sm btn-block" + (k === "growth" ? "" : " btn-line")}>Start with a free trial</Link>
              </article>
            );
          })}
        </div>
        <p className="source">Prices before VAT. Monthly, cancel any time. An action is one tool call by an agent. When a month's actions are used, agents pause until the 1st: there are no overage charges.</p>
      </Section>
      <Section stone>
        <SectionHead label="For developers and agents" title="Pay per call" lede="Every tool has a price per call. Pay with x402 and no account, or use an API key with 100 free calls a month and prepaid credits after that." more={["See the catalogue", "/for-agents?s=catalogue"]} />
        <table className="ledger ws-table price-table">
          <thead><tr><th>Tool</th><th className="hide-sm">What it returns</th><th className="num">Per call</th></tr></thead>
          <tbody>
            {TOOLS.map((t) => <tr key={t.slug}><td><b>{t.name}</b><br /><span className="mono muted">{t.slug}</span></td><td className="hide-sm muted">{t.description}</td><td className="num"><b>{pence(t.price.pence)}</b></td></tr>)}
            <tr><td><b>Run an agent</b><br /><span className="mono muted">/v1/agents/run</span></td><td className="hide-sm muted">Instructions plus up to eight tools; we run the loop and sign the answer.</td><td className="num"><b>{pence(AGENT_RUN_STEP_PENCE)}</b> a step</td></tr>
          </tbody>
        </table>
        <div className="grid-2 mt-l">
          <SpecTable rows={[["Free calls", "100 a month on every API key"], ["Credits", "Prepaid by card, from £10"], ["x402", "USDC on Base, settled per call, no account"], ["Failed calls", "Never charged"]]} />
          <SpecTable rows={[["Publish a tool", "Free"], ["You earn", "80% of every paid call"], ["Review", "Within one working day"], ["Payouts", "Monthly, from £20 earned"]]} />
        </div>
      </Section>
      <Section id="billing">
        <SectionHead label="Billing" title="Questions about paying" />
        <QA items={[
          ["What happens when the trial ends?", "Your agents pause and nothing is charged. Choose a plan in your workspace and they pick up where they left off."],
          ["What counts as an action?", "One tool call by one of your agents: a search, a page read, a lead saved, an email drafted. Watching customers against the registers and company checks don't count."],
          ["Can I change plan?", "Any time, from Usage and plan in your workspace. Changes apply from the next bill."],
          ["Do agents cost more if they're busy?", "No. Each plan has a monthly allowance and agents stop at it. You can set a lower limit per agent too."],
          ["How are developers paid?", "We pay 80% of each settled call to your tools, monthly by bank transfer once you've earned £20."],
          ["Do you charge VAT?", "Prices are shown before VAT."],
        ]} />
      </Section>
      <CtaBand />
    </Page>
  );
}

/* ---------- Trust ---------- */
export function Standards() {
  return (
    <Page title="Trust">
      <PageHead crumbs={[["Trust"]]} label="Trust" title="Agents you can leave alone" lede="An agent that acts in your name has to earn it. These are the rules every Agent House agent, and every tool in the catalogue, works to." />
      <Section tight>
        <SpecTable head={["Rule", "In practice"]} wide rows={[
          ["Nothing goes out without you", "Every email waits in Approvals by default. You can let follow-ups go on their own once you've approved the first, and change that any time."],
          ["Never invent facts", "Agents use tools for facts: the registers, web search, pages they read. They're told never to make up a figure, a claim or an email address, and every step is recorded for you to check."],
          ["Only published contact details", "Outreach uses business addresses published on a company's own website. It never guesses or constructs an address."],
          ["Easy to say no", "Every outreach email has an unsubscribe link and honours a STOP reply. An address that opts out is never emailed by any agent again, for any business."],
          ["Uncertain matches come back to you", "If a name could be more than one company, we ask. We never guess which company you meant."],
          ["Your data stays yours", "Each business's leads, invoices and messages are held separately, used only to run your agents, and never used to train AI models."],
          ["Every answer is signed", "Tool responses carry an ID and an Ed25519 signature over their exact bytes. Every action in your workspace is kept in an audit log."],
          ["Tools are reviewed", "Developer tools are checked before they go live, and every call to them is signed so publishers know it came from us."],
        ]} />
      </Section>
      <Section id="data" stone>
        <SectionHead label="Data we hold" title="What we keep, why, and for how long" lede="As little as the service needs." />
        <SpecTable head={["Data", "Why we hold it", "Kept until"]} rows={[
          ["Your business profile", "So agents know who you are and how you write", "30 days after you cancel"],
          ["Leads, invoices, messages and tasks", "The work your agents do for you", "30 days after you cancel, or exported to you first"],
          ["Run records", "So you can see each step an agent took", "12 months"],
          ["Customers and suppliers you watch", "To compare this week's register record with last week's", "30 days after you cancel"],
          ["Unsubscribed addresses", "So nobody who opted out is emailed again", "Indefinitely, address only"],
          ["API keys", "A hash only; we never store the key itself", "Until you revoke it"],
        ]} />
        <p className="source">A data processing agreement sets these out formally for each business.</p>
      </Section>
      <NextPrev prev={["Pricing", "/pricing"]} next={["For agents", "/for-agents"]} />
      <CtaBand />
    </Page>
  );
}

/* ---------- Developers ---------- */
function PaymentSequence() {
  const lanes = [["Your agent", 90], ["Agent House API", 380], ["x402 facilitator", 670]];
  const msgs = [
    [0, 1, "POST /v1/check", 80],
    [1, 0, "402 Payment Required, with price", 130],
    [0, 2, "Pay the quoted price", 180],
    [2, 0, "Payment proof", 230],
    [0, 1, "Retry with payment header", 280],
    [1, 0, "200 OK, signed answer", 330],
  ];
  return (
    <figure className="vis">
      <div className="vis-head"><span className="vis-title">Paying per call with x402</span><span className="vis-sub">No account or API key</span></div>
      <svg viewBox="0 0 760 370" className="seq" role="img" aria-label="Sequence: request, 402 with price, payment, proof, retry, signed answer">
        {lanes.map(([t, x]) => (
          <g key={t}>
            <rect x={x - 80} y="8" width="160" height="36" fill="var(--paper)" stroke="var(--ink)" />
            <text x={x} y="31" textAnchor="middle" className="seq-t">{t}</text>
            <line x1={x} x2={x} y1="44" y2="360" stroke="var(--rule)" />
          </g>
        ))}
        {msgs.map(([a, b, t, y], i) => {
          const xa = lanes[a][1], xb = lanes[b][1], dir = xb > xa ? 1 : -1;
          const last = i === msgs.length - 1;
          return (
            <g key={t}>
              <line x1={xa} x2={xb - dir * 6} y1={y} y2={y} stroke={last ? "var(--ink)" : "var(--graphite)"} strokeWidth={last ? 2 : 1} />
              <polygon points={`${xb},${y} ${xb - dir * 8},${y - 4} ${xb - dir * 8},${y + 4}`} fill={last ? "var(--ink)" : "var(--graphite)"} />
              <text x={(xa + xb) / 2} y={y - 8} textAnchor="middle" className={"seq-m" + (last ? " seq-last" : "")}>{t}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>Developers with an account use an API key and prepaid card credits instead, and skip the 402 step.</figcaption>
    </figure>
  );
}

// On the hosted site, examples show this site's own address.
const HOST = LIVE ? location.origin : "https://agenthouse.example";
const here = (t) => t.replaceAll("https://api.example.com", HOST).replaceAll("https://mcp.example.com", HOST + "/mcp");

function KeyForm() {
  const { query } = useRoute();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const [buy, setBuy] = useState({ key_id: "", pounds: "20" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (fn) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const getKey = (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email address.");
    if (!LIVE) return setSent(email);
    go(async () => { await api("POST", "/api/public/api-keys", { email: email.trim() }); setSent(email.trim()); });
  };
  const credits = (e) => {
    e.preventDefault();
    if (!/^key_\w+$/.test(buy.key_id.trim())) return setErr("Enter the key id from your key email. It starts key_.");
    if (!LIVE) return setErr("Buying credits works on the hosted site.");
    go(async () => { const r = await api("POST", "/api/public/credits/checkout", { key_id: buy.key_id.trim(), pounds: Number(buy.pounds) }); window.location.href = r.url; });
  };
  return (
    <div className="grid">
      <div className="col-5">
        {query.credits === "done" && <p className="notice" role="status">Payment received. Credits appear on your key within a minute.</p>}
        {query.credits === "cancelled" && <p className="notice" role="status">Checkout cancelled. Nothing was charged.</p>}
        {sent ? (
          <div className="form" aria-live="polite">
            <h2 className="h-small">Check your email</h2>
            <p className="body mt-s">Your key is on its way to {sent}. It's shown once; we keep only a hash of it. It includes 100 free calls a month.</p>
            {!LIVE && <p className="source">Prototype: no key was issued.</p>}
          </div>
        ) : (
          <form className="form" onSubmit={getKey} noValidate>
            <h2 className="h-small">Get a free API key</h2>
            <div className="field"><label htmlFor="k-email">Email</label><input id="k-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <button className="btn btn-block" type="submit" disabled={busy}>Email me a key</button>
            <p className="source">100 calls a month free. Then prepaid credits, or pay per call with x402 and no key at all.</p>
          </form>
        )}
      </div>
      <form className="col-5 col-start-8 form" onSubmit={credits} noValidate>
        <h2 className="h-small">Buy credits</h2>
        <div className="field"><label htmlFor="k-id">Key id</label><input id="k-id" className="mono" value={buy.key_id} onChange={(e) => setBuy({ ...buy, key_id: e.target.value })} placeholder="key_…" /></div>
        <div className="field"><label htmlFor="k-amt">Amount</label>
          <select id="k-amt" value={buy.pounds} onChange={(e) => setBuy({ ...buy, pounds: e.target.value })}>{["10", "20", "50", "100", "250"].map((p) => <option key={p} value={p}>£{p}</option>)}</select>
        </div>
        <button className="btn btn-line btn-block" type="submit" disabled={busy}>Pay by card</button>
        {err && <p className="form-err mt-s" role="alert">{err}</p>}
      </form>
    </div>
  );
}

/* Dev mode tabs: what the user sees, or the code behind it */
const DEV_TABS = [
  { k: "Run an agent", h: "An agent in one call", d: "Send instructions and the tools it may use. We run the loop on our side, call the tools, and return the answer with every step, signed.",
    pts: ["Up to eight first-party tools a run", "12p a step, for the steps you allow", "Every step returned, so you can audit it"],
    ui: () => (
      <div className="mini" style={{ width: "100%", maxWidth: 520, padding: 28 }}>
        <p className="dt">Agent run · agr_41c7e2</p>
        <p style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em", margin: "6px 0 14px" }}>Three dental practices in Leeds city centre, each with an active company and a website.</p>
        {[["find-companies", '{"districts":["LS1","LS2"],"sic":["86"]}'], ["company-research", '{"name":"Kirkgate Dental Ltd"}'], ["company-research", '{"name":"Aire Smiles Ltd"}'], ["read-page", '{"url":"https://kirkgatedental.example"}']].map(([t, i], n) => (
          <div className="mini-row" key={n}><span className="mono" style={{ fontSize: 13 }}>{n + 1}. {t}</span><span className="dt mono" style={{ fontSize: 11, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i}</span></div>
        ))}
        <p className="dt mono" style={{ marginTop: 10 }}>6 steps · signed ed25519 · £0.25</p>
      </div>
    ),
    code: `<span class="k">curl</span> ${"$"}HOST/v1/agents/run \\
  -H <span class="s">"Authorization: Bearer ah_live_…"</span> \\
  -d <span class="s">'{
    "instructions": "Find three dental practices in Leeds city centre with a website.",
    "tools": ["find-companies", "company-research", "read-page"],
    "max_steps": 6
  }'</span>

<span class="cm"># 200 OK</span>
{
  "output": <span class="s">"1. Kirkgate Dental Ltd, kirkgatedental.example …"</span>,
  "steps": [{ "tool": <span class="s">"find-companies"</span>, "ok": true }, …],
  "signature": <span class="f">"ed25519:…"</span>
}` },
  { k: "Publish a tool", h: "Your API, in front of every agent", d: "List an endpoint with a price and a schema. Once reviewed it's in the catalogue, the MCP server and llms.txt. Agents pay per call; you earn 80%.",
    pts: ["Every request to you is signed with your secret", "Failed calls are never charged", "Earnings per call in your dashboard"],
    ui: () => (
      <div className="mini" style={{ width: "100%", maxWidth: 460, padding: 28 }}>
        <div className="mini-h"><span className="mono">uk-vat-check</span><span className="st st-done">Live</span></div>
        <p className="mini-big">£30.82</p>
        <p className="dt">earned this month, 80% of 1,284 calls at 3p</p>
        <div className="mini-row" style={{ marginTop: 12, borderTop: "1px solid var(--line)" }}><span>In the catalogue</span><span className="chip-ok">/v1/tools</span></div>
        <div className="mini-row"><span>On the MCP server</span><span className="chip-ok">/mcp</span></div>
        <div className="mini-row"><span>Request signature</span><b className="mono">v1=hmac-sha256</b></div>
      </div>
    ),
    code: `<span class="k">curl</span> ${"$"}HOST/api/dev/tools \\
  -H <span class="s">"Authorization: Bearer ah_live_…"</span> \\
  -d <span class="s">'{
    "slug": "uk-vat-check",
    "name": "UK VAT number check",
    "description": "Whether a VAT number is valid, and the business it belongs to.",
    "endpoint": "https://vat.example.com/check",
    "price_pence": 3,
    "input_schema": { "type": "object",
      "properties": { "number": { "type": "string" } } }
  }'</span>

<span class="cm"># 201 Created: in review. Keep the signing secret.</span>
{ "status": <span class="s">"review"</span>, "signing_secret": <span class="f">"ahs_…"</span> }` },
  { k: "Use MCP", h: "The catalogue as MCP tools", d: "Add one server to Claude or any MCP client. Your agent gets every tool in the catalogue, including developers' tools, billed to your key.",
    pts: ["Streamable HTTP, JSON responses", "tools/list needs no key", "Same prices and signatures as REST"],
    ui: () => (
      <div className="mini" style={{ width: "100%", maxWidth: 460, padding: 28 }}>
        <p className="dt">tools/list</p>
        <p className="mini-big" style={{ marginTop: 8 }}>8 + developers'</p>
        {[["uk-check", "5p"], ["company-research", "8p"], ["web-research", "3p"], ["read-page", "1p"]].map(([t, p]) => <div className="mini-row" key={t}><span className="mono">{t}</span><b>{p}</b></div>)}
      </div>
    ),
    code: `<span class="k">claude</span> mcp add --transport http agent-house ${"$"}HOST/mcp \\
  --header <span class="s">"Authorization: Bearer ah_live_…"</span>

<span class="cm"># Or in any MCP client's config:</span>
{
  "mcpServers": {
    "agent-house": {
      "url": <span class="s">"${"$"}HOST/mcp"</span>,
      "headers": { "Authorization": <span class="s">"Bearer ah_live_…"</span> }
    }
  }
}` },
];

function DevTabs() {
  const [i, setI] = useState(0);
  const [dev, setDev] = useState(false);
  const t = DEV_TABS[i];
  const UI = t.ui;
  return (
    <>
      <div className="devhead">
        <h2>Build with agents, or for them</h2>
        <span className="devmode">Dev mode <button aria-pressed={dev} aria-label="Dev mode" onClick={() => setDev(!dev)} /></span>
      </div>
      <div className="devtabs" role="tablist">
        {DEV_TABS.map((x, j) => <button key={x.k} role="tab" aria-selected={j === i} className={j === i ? "is-on" : ""} onClick={() => setI(j)}>{x.k}</button>)}
      </div>
      <div className="devpanel" role="tabpanel">
        <div className="devpanel-copy api-fade" key={"c" + i}>
          <div><h3>{t.h}</h3><p>{t.d}</p></div>
          <ul>{t.pts.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
        <div className={"devpanel-stage" + (dev ? " is-dark" : "")}>
          {dev
            ? <pre className="dark api-fade" key={"d" + i} dangerouslySetInnerHTML={{ __html: t.code.replaceAll("$HOST", HOST) }} />
            : <div className="api-fade" key={"u" + i} style={{ width: "100%", display: "grid", placeItems: "center" }}><UI /></div>}
        </div>
      </div>
    </>
  );
}

export function Developers() {
  const [k, setK] = useState("tools");
  const ep = ENDPOINTS.find((e) => e.k === k);
  return (
    <Page title="Developers">
      <PageHead label="For developers" title="Tools for your agents. Customers for your tools." lede="Call a catalogue of signed tools from your own agents, run a whole agent in one request, or publish your API so every agent on Agent House can pay to use it."
        actions={<><Link to="/developers?s=key" className="btn btn-lg">Get a free API key</Link><Link to="/developers/dashboard" className="btn btn-lg btn-line">Publish a tool</Link></>} />
      <section style={{ padding: "32px 0 0" }}><Marquee caption="One gateway for agent tools" items={["REST", "MCP", "x402", "Ed25519", "USDC on Base", "Stripe credits", "llms.txt", "Agents API", "80% to publishers", "Companies House", "Web research"]} /></section>
      <section className="band" style={{ paddingTop: 96 }}><div className="wrap"><DevTabs /></div></section>
      <ApiShowcase title="Six things you can build today." />
      <Section id="reference">
        <SectionHead label="Reference" title="Endpoints" lede="The catalogue, any tool, the Agents API and publishing, plus the company endpoints. The same tools are on MCP. 100 calls a month are free on a key." />
        <div className="grid">
          <div className="col-5">
            <table className="ledger endpoints">
              <thead><tr><th>Endpoint</th><th className="hide-sm">Use it to</th></tr></thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={e.k} className={"click-row" + (k === e.k ? " is-sel" : "")} onClick={() => setK(e.k)}>
                    <td><button className="ep" aria-pressed={k === e.k} onClick={() => setK(e.k)}><span className="mono ep-m">{e.method}</span><span className="mono">{e.path}</span></button></td>
                    <td className="hide-sm muted">{e.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <SpecTable rows={[["Free tier", "100 calls a month"], ["Payment", "x402 per call, or prepaid card credits"], ["Access", "REST API and MCP server"], ["Base URL", HOST], ["MCP server", HOST + "/mcp"]]} />
          </div>
          <div className="col-7 col-start-6">
            <p className="ep-what"><span className="mono">{ep.method} {ep.path}</span>{ep.what}</p>
            <CodePanel key={k} tabs={{ Request: here(ep.req), Response: ep.res }} />
          </div>
        </div>
      </Section>
      <section className="band band-stone" id="mcp">
        <div className="wrap split">
          <Reveal>
            <p className="label">MCP server</p>
            <h2>Give your agent the whole catalogue</h2>
            <p className="body-l">Add one URL to Claude or any MCP client. Your agent gets every tool in the catalogue, including the ones developers publish, billed to your key like the REST API.</p>
            <div className="actions"><Link to="/developers?s=key" className="btn btn-lg">Get a free API key</Link></div>
          </Reveal>
          <Reveal delay={120}><Terminal title="~ — zsh" lines={TERM} /></Reveal>
        </div>
      </section>
      <Section id="payments">
        <SectionHead label="Payments" title="Two ways to pay" lede="Agents without an account pay per call in x402. Teams that prefer invoices buy prepaid credits by card and call with an API key." />
        <PaymentSequence />
      </Section>
      <Section id="verify" stone>
        <SectionHead label="Verification" title="Check that an answer came from us" lede="Every response carries a response ID and an Ed25519 signature over its body. Verify it against our published key before you act on it." />
        <CodePanel tabs={Object.fromEntries(Object.entries({
          Verify: `# 1. Fetch the public key (cache it; it rotates rarely)
GET https://api.example.com/.well-known/agent-house-key

# 2. Verify the signature over the response body
verify(
  public_key,
  message = response_body_without_signature,
  signature = response["signature"]
)

# Signed bytes: the response JSON without "signature",
# keys sorted at every level, no whitespace.

# 3. Keep the response_id with your own record
#    of the decision, for audit`,
          MCP: `# Add the MCP server to your agent
{
  "mcpServers": {
    "agent-house": {
      "type": "http",
      "url": "https://mcp.example.com",
      "headers": { "Authorization": "Bearer ah_live_…" }
    }
  }
}

# Tools: resolve, profile, check, watch
# Billed to the key, like the REST API`,
        }).map(([t, v]) => [t, here(v)]))} />
      </Section>
      <Section id="key"><SectionHead label="Get started" title="Your key, in your inbox" lede="100 calls a month free. Then prepaid credits by card, or pay per call with x402 and no key at all." /><KeyForm /></Section>
      <section className="close">
        <div className="wrap grid">
          <h2 className="col-8 close-h">Make your first call in a minute.</h2>
          <div className="col-4 close-side">
            <p className="body-l">One email for a key, one request for a signed answer.</p>
            <div className="actions"><Link to="/developers?s=key" className="btn">Get a free API key</Link><Link to="/book-a-call" className="link">Talk to us</Link></div>
          </div>
        </div>
      </section>
    </Page>
  );
}

/* ---------- Book a call ---------- */
const DAYS = (() => {
  const out = [];
  const d = new Date(Date.UTC(2026, 9, 21));
  while (out.length < 10) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
})();
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIMES = ["09:30", "11:00", "14:00", "16:00"];
const TAKEN = { "0-09:30": 1, "1-14:00": 1, "3-11:00": 1, "4-09:30": 1, "6-16:00": 1 };

export function BookCall() {
  const [day, setDay] = useState(0);
  const [time, setTime] = useState("");
  const ts = useTurnstile();
  // On the hosted site, days and free times come from the booking API; offline, the example calendar.
  const slots = useApi(LIVE ? "/api/public/slots" : null);
  const live = slots.data?.days;
  const days = live ? live.map((x) => new Date(x.date + "T00:00:00Z")) : DAYS;
  const isTaken = (i, t) => (live ? !live[i]?.times.find((x) => x.time === t)?.available : TAKEN[i + "-" + t]);
  const [booked, setBooked] = useState("");
  const { f, setF, err, sent, busy, submit } = useForm(["name", "email", "company"], async (v) => {
    try {
      await api("POST", "/api/public/bookings", { date: live[day].date, time, name: v.name.trim(), email: v.email.trim(), company: v.company.trim(), ...(ts.token ? { turnstile: ts.token } : {}) });
    } catch (e) {
      ts.reset();
      if (e.status === 409) { setTime(""); slots.reload(); }
      throw e;
    }
  }, () => (!time ? "a time" : !ts.ready ? "the check that you're not a robot" : ""));
  const d = days[Math.min(day, days.length - 1)];
  const label = `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
  useEffect(() => { if (sent) setBooked(`${label}, ${time}`); }, [sent]);
  return (
    <Page title="Book a call">
      <PageHead crumbs={[["Book a call"]]} label="Book a call" title="Twenty minutes on what agents could do for you" lede="Tell us about your business, or the tool you want to publish. We'll show you the agents that fit and answer questions about data, approvals and pricing. Times are UK time." />
      <Section tight>
        {sent ? (
          <div className="confirm" aria-live="polite">
            <p className="label">Booked</p>
            <h2>{booked || `${label}, ${time}`}</h2>
            <p className="body-l mt-s">A calendar invitation {LIVE ? "has been" : "will be"} sent to {f.email}. If you'd like us to look at your book first, send your list for a health check before the call.</p>
            <div className="actions"><Link to="/health-check" className="btn">Request a health check</Link><Link to="/" className="link">Back to home</Link></div>
            {!LIVE && <p className="source">Prototype: no booking was made.</p>}
          </div>
        ) : (
          <div className="grid">
            <div className="col-7">
              <p className="label">1. Choose a day</p>
              {slots.error && <p className="form-err" role="alert">{slots.error.message}</p>}
              <div className="days" role="radiogroup" aria-label="Day">
                {days.map((x, i) => (
                  <button key={i} role="radio" aria-checked={day === i} className={day === i ? "is-on" : ""} onClick={() => { setDay(i); setTime(""); }}>
                    <span className="dt">{WD[x.getUTCDay()]}</span><b>{x.getUTCDate()}</b><span className="dt">{MO[x.getUTCMonth()]}</span>
                  </button>
                ))}
              </div>
              <p className="label mt-l">2. Choose a time on {label}</p>
              <div className="times" role="radiogroup" aria-label="Time">
                {TIMES.map((t) => {
                  const taken = isTaken(day, t);
                  return <button key={t} role="radio" aria-checked={time === t} disabled={!!taken || (LIVE && !live)} className={time === t ? "is-on" : ""} onClick={() => setTime(t)}>{t}{taken && <span className="dt">Taken</span>}</button>;
                })}
              </div>
            </div>
            <form className="col-4 col-start-9 form" onSubmit={(e) => { if (!time) { e.preventDefault(); return; } submit(e); }} noValidate>
              <h2 className="h-small">3. Your details</h2>
              <Fields f={f} setF={setF} />
              {ts.needed && <div className="field" ref={ts.el} />}
              {err && <p className="form-err" role="alert">{err}</p>}
              <button className="btn btn-block" type="submit" disabled={!time || busy}>{busy ? "Booking…" : time ? `Book ${label}, ${time}` : "Choose a time first"}</button>
            </form>
          </div>
        )}
      </Section>
    </Page>
  );
}

/* ---------- Not found ---------- */
export function NotFound() {
  return (
    <Page title="Page not found">
      <PageHead label="Page not found" title="That page isn't here" lede="The link may be old, or the address may have a typo." />
      <Section tight>
        <ul className="rule-list rule-list-l nf-links">
          <li><Link to="/" className="link">Home</Link></li>
          <li><Link to="/agents" className="link">The agents</Link></li>
          <li><Link to="/workspace" className="link">Workspace demo</Link></li>
          <li><Link to="/health-check" className="link">Request a health check</Link></li>
        </ul>
      </Section>
    </Page>
  );
}
