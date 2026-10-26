// Developer dashboard (signed in with an API key) and the For agents page (catalogue, discovery, x402).
import React, { useEffect, useState } from "react";
import { Link, useRoute } from "../router.jsx";
import { Page, PageHead, Section, SectionHead, CodePanel } from "../ui.jsx";
import { Reveal, Glyph, Tile, Terminal, DarkBand } from "../kit.jsx";
import { LIVE, ApiError, dateTimeOf, pounds } from "../api.js";
import { TOOLS, AGENT_RUN_STEP_PENCE, pence } from "../catalogue.js";
import { HOST } from "./showcase.jsx";
import { LensTable } from "./UseCases.jsx";

/* ---------- Developer API, authenticated with the key itself ---------- */
const KEY = "ah-dev-key";
const loadKey = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
const keepKey = (k) => { try { k ? sessionStorage.setItem(KEY, k) : sessionStorage.removeItem(KEY); } catch {} };
async function dev(key, method, path, body) {
  const init = { method, headers: { Authorization: "Bearer " + key } };
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch("/api/dev" + path, init); } catch { throw new ApiError(0, "offline", "Can't reach Agent House. Check your connection."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, j.error?.code, j.error?.message || `Something went wrong (${res.status}).`, j.error?.details);
  return j;
}

const SCHEMA = `{
  "type": "object",
  "properties": {
    "number": { "type": "string", "description": "UK VAT number, e.g. GB123456789" }
  },
  "required": ["number"]
}`;
const STATUS = { review: ["In review", "st-running"], live: ["Live", "st-done"], rejected: ["Not approved", "st-waiting"], retired: ["Retired", "st-paused"] };
const verifyCode = (secret) => `// Every request from Agent House to your endpoint is signed.
// Reject anything that fails this check or is more than 5 minutes old.
import { createHmac, timingSafeEqual } from "node:crypto";

export function fromAgentHouse(req, rawBody) {
  const ts = req.headers["x-agenthouse-timestamp"];
  const sig = req.headers["x-agenthouse-signature"];          // "v1=<hex>"
  if (!ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = "v1=" + createHmac("sha256", "${secret || "ahs_your_signing_secret"}")
    .update(ts + "." + rawBody).digest("hex");
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

// The body is {"tool": "<slug>", "input": {...}}. Reply 200 with JSON.
// Anything else and the caller isn't charged.`;

export function DevDashboard() {
  const [key, setKey] = useState(loadKey);
  const [draft, setDraft] = useState("");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [secret, setSecret] = useState(null);
  const blank = { slug: "", name: "", description: "", endpoint: "https://", price_pence: 3, schema: SCHEMA };
  const [f, setF] = useState(blank);
  const go = async (fn) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr(e.message); if (e.status === 401) { keepKey(""); setKey(""); } } finally { setBusy(false); } };
  const refresh = (k = key) => go(async () => {
    const [me, tools, calls] = await Promise.all([dev(k, "GET", "/me"), dev(k, "GET", "/tools"), dev(k, "GET", "/calls")]);
    setD({ me, tools: tools.tools, calls: calls.calls, earnings: calls.earnings });
  });
  useEffect(() => { if (key && LIVE) refresh(); }, [key]);
  const signIn = (e) => {
    e.preventDefault();
    const k = draft.trim();
    if (!/^ah_\w+/.test(k)) return setErr("Paste the full API key from your key email. It starts ah_.");
    if (!LIVE) return setErr("The dashboard works on the hosted site.");
    keepKey(k); setKey(k); setDraft("");
  };
  const publish = (e) => {
    e.preventDefault();
    let schema;
    try { schema = JSON.parse(f.schema); } catch { return setErr("The input schema isn't valid JSON."); }
    go(async () => {
      const r = await dev(key, "POST", "/tools", { slug: f.slug.trim(), name: f.name.trim(), description: f.description.trim(), endpoint: f.endpoint.trim(), price_pence: Number(f.price_pence), input_schema: schema });
      setSecret({ slug: r.slug, secret: r.signing_secret }); setF(blank); setNote(r.message); await refresh();
    });
  };
  const retire = (t) => go(async () => { await dev(key, "PATCH", "/tools/" + t.slug, { status: "retired" }); setNote(`${t.slug} retired. It's out of the catalogue and the MCP server.`); await refresh(); });

  if (!key) {
    return (
      <Page title="Developer dashboard">
        <PageHead crumbs={[["Developers", "/developers"], ["Dashboard"]]} label="Developers" title="Developer dashboard" lede="Publish tools to the catalogue, see your calls, credits and earnings. Sign in with your API key; it stays in this browser tab only." />
        <Section tight>
          <div className="grid">
            <form className="form col-6" onSubmit={signIn} noValidate>
              <h2 className="h-small">Sign in with your API key</h2>
              <div className="field"><label htmlFor="dk">API key</label><input id="dk" type="password" autoComplete="off" className="mono" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ah_live_…" /></div>
              {err && <p className="form-err" role="alert">{err}</p>}
              <button className="btn btn-block">Open the dashboard</button>
              <p className="source">No key yet? <Link to="/developers?s=key" className="link link-s">Get one free</Link>: 100 calls a month included.</p>
            </form>
          </div>
        </Section>
      </Page>
    );
  }
  const live = (d?.tools || []).filter((t) => t.status === "live").length;
  return (
    <Page title="Developer dashboard">
      <PageHead crumbs={[["Developers", "/developers"], ["Dashboard"]]} label="Developers" title="Developer dashboard" lede={d ? `Signed in as ${d.me.email}, key ${d.me.key_id}.` : "Loading your key…"}
        actions={<button className="btn btn-line" onClick={() => { keepKey(""); setKey(""); setD(null); }}>Sign out</button>} />
      <Section tight>
        {err && <p className="notice notice-signal" role="alert">{err}</p>}
        {note && <p className="notice" role="status">{note}</p>}
        {d && (
          <>
            <div className="kpis">
              <div className="kpi"><span className="dt">Calls this month</span><b>{d.me.calls_this_month}</b><span className="kpi-sub">{Math.max(0, d.me.free_calls - d.me.calls_this_month)} of {d.me.free_calls} free left</span></div>
              <div className="kpi"><span className="dt">Credit balance</span><b>{pounds(d.me.credit_pence)}</b><span className="kpi-sub"><Link to="/developers?s=key" className="link link-s">Buy credits</Link></span></div>
              <div className={"kpi" + (d.me.earnings_month_pence ? " kpi-hot" : "")}><span className="dt">Earned this month</span><b>{pounds(d.me.earnings_month_pence)}</b><span className="kpi-sub">80% of every paid call</span></div>
              <div className="kpi"><span className="dt">Tools live</span><b>{live}</b><span className="kpi-sub">{pounds(d.me.earnings_pence)} earned in total</span></div>
            </div>

            {secret && (
              <section className="panel mt-l secret">
                <h2 className="h-sub">Signing secret for {secret.slug}</h2>
                <p className="body">Shown once. Store it with your endpoint and check every request with it.</p>
                <p className="secret-v mono">{secret.secret}</p>
                <CodePanel tabs={{ "Verify (Node)": verifyCode(secret.secret) }} />
                <button className="link link-s mt-s" onClick={() => setSecret(null)}>I've stored it</button>
              </section>
            )}

            <h2 className="h-sub mt-l">Your tools</h2>
            <table className="ledger ws-table">
              <thead><tr><th>Tool</th><th className="num">Price</th><th>Status</th><th className="num hide-sm">Calls</th><th className="num">Actions</th></tr></thead>
              <tbody>
                {d.tools.length === 0 && <tr><td colSpan={5} className="empty">No tools yet. Publish one below; agents find it in the catalogue, the MCP server and llms.txt.</td></tr>}
                {d.tools.map((t) => (
                  <tr key={t.slug}>
                    <td><b>{t.name}</b><br /><span className="mono muted">{t.slug}</span>{t.review_note && <><br /><span className="dt">Review note: {t.review_note}</span></>}</td>
                    <td className="num">{pence(t.price_pence)}</td>
                    <td><span className={"st " + STATUS[t.status][1]}>{STATUS[t.status][0]}</span></td>
                    <td className="num hide-sm">{t.calls}</td>
                    <td className="num">{t.status !== "retired" && <button className="link link-s" disabled={busy} onClick={() => retire(t)}>Retire</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="publish mt-l">
              <form className="form" onSubmit={publish} noValidate>
                <h2 className="h-small">Publish a tool</h2>
                <div className="grid-2 g-tight">
                  <div className="field"><label htmlFor="t-slug">Slug</label><input id="t-slug" className="mono" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="uk-vat-check" /><p className="hint">Lowercase letters, numbers, hyphens. Agents call it by this.</p></div>
                  <div className="field"><label htmlFor="t-name">Name</label><input id="t-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="UK VAT number check" /></div>
                </div>
                <div className="field"><label htmlFor="t-desc">What it returns</label><textarea id="t-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Whether a UK VAT number is valid, and the registered business name and address." /><p className="hint">Agents choose tools from this, so say exactly what comes back.</p></div>
                <div className="grid-2 g-tight">
                  <div className="field"><label htmlFor="t-ep">Endpoint</label><input id="t-ep" className="mono" value={f.endpoint} onChange={(e) => setF({ ...f, endpoint: e.target.value })} /></div>
                  <div className="field"><label htmlFor="t-price">Price per call, pence</label><input id="t-price" type="number" min={1} max={500} value={f.price_pence} onChange={(e) => setF({ ...f, price_pence: e.target.value })} /><p className="hint">You earn {pence(Math.floor(Number(f.price_pence || 0) * 0.8))} a call. Failed calls aren't charged.</p></div>
                </div>
                <div className="field"><label htmlFor="t-schema">Input schema (JSON Schema)</label><textarea id="t-schema" rows={8} className="mono" value={f.schema} onChange={(e) => setF({ ...f, schema: e.target.value })} spellCheck={false} /></div>
                <button className="btn" disabled={busy}>{busy ? "Publishing…" : "Send for review"}</button>
              </form>
              <aside className="publish-side">
                <h3 className="flabel">How publishing works</h3>
                <ol className="steps-s">
                  <li><b>You send it for review.</b> We check the endpoint answers and the description is accurate, usually within a working day.</li>
                  <li><b>It goes live.</b> It appears in /v1/tools, the MCP server and llms.txt, and business agents can use it.</li>
                  <li><b>Agents pay per call.</b> By x402 or a key. We sign each request to you with your secret.</li>
                  <li><b>You earn 80%.</b> Earnings show here as each call settles.</li>
                </ol>
              </aside>
            </div>

            <div className="grid-2 mt-l">
              <div>
                <h2 className="h-sub">Recent calls you made</h2>
                <table className="ledger">
                  <thead><tr><th>When</th><th>Call</th><th className="num">Cost</th></tr></thead>
                  <tbody>
                    {d.calls.length === 0 && <tr><td colSpan={3} className="empty">No calls yet.</td></tr>}
                    {d.calls.slice(0, 15).map((c, i) => <tr key={i}><td className="dt">{dateTimeOf(c.at)}</td><td className="mono">{c.kind}</td><td className="num">{c.payment === "free" ? "Free" : pence(c.cost_pence)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div>
                <h2 className="h-sub">Earnings</h2>
                <table className="ledger">
                  <thead><tr><th>When</th><th>Tool</th><th className="num">You earned</th></tr></thead>
                  <tbody>
                    {d.earnings.length === 0 && <tr><td colSpan={3} className="empty">Nothing yet. Earnings appear when a paid call to one of your tools settles.</td></tr>}
                    {d.earnings.slice(0, 15).map((e, i) => <tr key={i}><td className="dt">{dateTimeOf(e.at)}</td><td className="mono">{e.tool_slug}</td><td className="num">{pence(e.share_pence)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Section>
    </Page>
  );
}

/* ---------- For agents ---------- */
const X402 = [
  ["Call", "POST /v1/tools/uk-check", "Your agent calls a tool with no key."],
  ["402", "PAYMENT-REQUIRED", "We answer 402 with the price in USDC on Base and where to pay."],
  ["Sign", "PAYMENT-SIGNATURE", "The agent signs a payment authorisation and calls again with it."],
  ["200", "PAYMENT-RESPONSE", "We settle, run the tool and return a signed answer with the receipt."],
];
const DISCOVER = [
  ["globe", "/.well-known/agent-house.json", "Where everything is: catalogue, MCP, payment details, signing key."],
  ["api", "/v1/tools", "Every tool with its price, input schema and how to call it."],
  ["mcp", "/mcp", "The same tools over MCP, for Claude and any MCP client."],
  ["method", "/llms.txt", "A plain-text summary written for language models."],
];
const AGENT_TERM = (h) => [
  { cmd: `curl -s ${h}/v1/tools | jq -r '.tools[].slug'` },
  { out: [["t-cmd", "uk-check  uk-resolve  uk-profile  find-companies"]] },
  { out: [["t-cmd", "company-research  web-research  read-page  uk-watch"]] },
  { out: [] },
  { cmd: `curl -si ${h}/v1/tools/read-page -d '{"url":"https://…"}'` },
  { out: [["t-h", "HTTP/2 402"]] },
  { out: [["t-dim", "payment-required: eyJ4NDAyVmVyc2lvbiI6Miwi…"]] },
  { out: [["t-dim", "# 1p = 12,500 atomic USDC on Base. Sign, retry."]] },
  { out: [] },
  { cmd: `curl -si ${h}/v1/tools/read-page -H "payment-signature: …"` },
  { out: [["t-ok", "HTTP/2 200"]] },
  { out: [["t-dim", "payment-response: eyJzdWNjZXNzIjp0cnVl…"]] },
  { out: [["", '{ "result": { "title": "…", "text": "…" },']] },
  { out: [["", '  "signature": "ed25519:…" }']] },
];

export function ForAgents() {
  const [tools, setTools] = useState(TOOLS);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!LIVE) return;
    fetch("/v1/tools").then((r) => r.json()).then((j) => j.tools && setTools(j.tools)).catch(() => {});
  }, []);
  const term = AGENT_TERM(HOST);
  return (
    <Page title="For agents">
      <PageHead label="For agents" title="Facts your agent can cite, paid one call at a time." lede="Check a UK company before your agent pays, signs or onboards. Research the web with sources. No account and no subscription: your agent finds the catalogue, pays per call in USDC with x402, and gets an answer signed by us."
        actions={<><a href="#/for-agents?s=catalogue" className="btn btn-lg">See the catalogue</a><Link to="/developers/dashboard" className="btn btn-lg btn-line">Publish a tool</Link></>} />
      <section className="band" style={{ paddingTop: 72 }}>
        <div className="wrap split">
          <Reveal>
            <p className="label">How an agent uses it</p>
            <h2>Discover, pay, verify.</h2>
            <p className="body-l">Point your agent at our well-known file and it can work out the rest: which tools exist, what they cost, how to pay, and how to check the answer came from us.</p>
            <ul className="disc">
              {DISCOVER.map(([g, p, t]) => <li key={p}><Tile name={g} /><span><b className="mono">{p}</b><span>{t}</span></span></li>)}
            </ul>
          </Reveal>
          <Reveal delay={120}><Terminal title="agent — x402" lines={term} /></Reveal>
        </div>
      </section>

      <Section id="jobs">
        <SectionHead label="What agents pay for" title="Checks first, then research" lede="From our map of 80 small-business jobs, scored for how likely another agent is to pay per call for each one. The top of the list is verification: stateless, quick and worth citing. Coming next: asking a business for a quote or a booking, and paying it." more={["All use cases", "/use-cases"]} />
        <LensTable lens="agent" label="Agents" n={8} />
      </Section>

      <Section id="catalogue" stone>
        <SectionHead label="Catalogue" title="Every tool, priced per call" lede={`First-party tools from Agent House and tools published by developers, who earn 80% of each call. Prices are in pence; x402 settles the same amount in USDC.`} />
        <div className="tool-list">
          {tools.map((t) => (
            <article key={t.slug} className={"tool" + (open === t.slug ? " is-open" : "")}>
              <button className="tool-h" aria-expanded={open === t.slug} onClick={() => setOpen(open === t.slug ? null : t.slug)}>
                <span className="tool-n"><b>{t.name}</b><span className="mono muted">{t.slug}</span></span>
                <span className="tool-d">{t.description}</span>
                <span className="tool-p"><b>{pence(t.price.pence)}</b><span className="dt">{t.publisher === "Agent House" ? "Agent House" : "Developer"}</span></span>
              </button>
              {open === t.slug && (
                <div className="tool-b">
                  <CodePanel tabs={{ curl: `curl -X POST ${HOST}/v1/tools/${t.slug} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(sampleInput(t))}'`, ...(t.input_schema ? { "Input schema": JSON.stringify(t.input_schema, null, 2) } : {}) }} />
                </div>
              )}
            </article>
          ))}
          <article className="tool tool-run">
            <div className="tool-h">
              <span className="tool-n"><b>Run an agent</b><span className="mono muted">POST /v1/agents/run</span></span>
              <span className="tool-d">Hand over instructions and up to eight first-party tools; we run the agent loop and return its answer with every step, signed.</span>
              <span className="tool-p"><b>{pence(AGENT_RUN_STEP_PENCE)}</b><span className="dt">a step (max_steps, default 4)</span></span>
            </div>
          </article>
        </div>
      </Section>

      <Section id="x402">
        <SectionHead label="Payments" title="x402, in four messages" lede="The standard HTTP 402 flow. No account, no key, no invoice: the payment travels with the request." />
        <ol className="x4">
          {X402.map(([n, h, t], i) => <li key={n}><span className="x4-n">{i + 1}</span><b>{n}</b><span className="mono">{h}</span><p>{t}</p></li>)}
        </ol>
        <div className="grid-2 mt-l">
          <CodePanel tabs={{
            "Agents API": `curl -X POST ${HOST}/v1/agents/run \\
  -H "Authorization: Bearer ah_live_…" \\
  -d '{
    "instructions": "Find three dental practices in Leeds and their websites.",
    "tools": ["find-companies", "company-research"],
    "max_steps": 6
  }'`,
            MCP: `{
  "mcpServers": {
    "agent-house": {
      "url": "${HOST}/mcp",
      "headers": { "Authorization": "Bearer ah_live_…" }
    }
  }
}`,
          }} />
          <div>
            <h3 className="h-small">Every answer is signed</h3>
            <p className="body mt-s">Responses carry a response ID and an Ed25519 signature over their exact bytes. Verify against our published key before your agent acts on an answer, and keep the ID for your records.</p>
            <p className="more"><Link to="/developers?s=verify" className="link">How to verify</Link></p>
            <h3 className="h-small mt-l">Failed calls are free</h3>
            <p className="body mt-s">If a tool errors or times out, the payment isn't settled and your credits aren't touched.</p>
          </div>
        </div>
      </Section>

      <DarkBand glyph="tools" title="Built a tool agents would pay for?" body="Publish it to the catalogue and earn 80% of every call. We handle discovery, payment and MCP." cta={["Publish a tool", "/developers/dashboard"]} note="Free to list. Reviewed within a working day." />
    </Page>
  );
}
function sampleInput(t) {
  const props = t.input_schema?.properties || {};
  const ex = { input: "Tarnbrook Logistics, INV-2207", number: "11420987", query: "office cleaning Salford prices", url: "https://example.com", name: "Peel Street Accountants", districts: ["M2", "M3"], sic: ["69"], numbers: ["11420987"], webhook: "https://your-app.example/hooks" };
  const keys = Object.keys(props).length ? Object.keys(props) : ["input"];
  return Object.fromEntries(keys.filter((k) => ex[k] !== undefined || (t.input_schema?.required || []).includes(k)).map((k) => [k, ex[k] ?? "…"]));
}
