// The API showcase and MCP terminal script, shared by the home and developers pages.
import React, { useEffect, useState } from "react";
import { Link } from "../router.jsx";
import { reduced } from "../ui.jsx";
import { Reveal, Editor, useInView } from "../kit.jsx";

export const HOST = typeof location !== "undefined" && /^https?:$/.test(location.protocol) ? location.origin : "https://agenthouse.example";

const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
export const TERM = [
  { cmd: `claude mcp add --transport http agent-house ${HOST}/mcp` },
  { out: [["t-ok", "✓ "], ["", "Connected to agent-house · 8 tools, more from developers"]] },
  { out: [] },
  { out: [["t-h", "COMPANIES"]] },
  { out: [["", "  "], ["t-cmd", pad("uk-check", 18)], ["", "Resolve, profile and flag   5p"]] },
  { out: [["", "  "], ["t-cmd", pad("find-companies", 18)], ["", "By area, trade and age      5p"]] },
  { out: [["t-h", "RESEARCH"]] },
  { out: [["", "  "], ["t-cmd", pad("company-research", 18)], ["", "Register plus the web       8p"]] },
  { out: [["", "  "], ["t-cmd", pad("read-page", 18)], ["", "Any public page as text     1p"]] },
  { out: [] },
  { cmd: `"Find three dental practices in Leeds and their websites"` },
  { out: [["t-dim", "  find-companies → company-research ×3 → read-page ×3"]] },
  { out: [["t-ok", "✓ "], ["", "3 practices, each with its website and register status"]] },
  { out: [["t-dim", "  signed ed25519 · 7 calls · £0.32"]] },
];

/* ---------- 5. API showcase: editor, floating result, auto-advancing ---------- */
const ADV = 7000;
const API = [
  { k: "Run an agent", title: "Run an agent", d: "Give instructions and a set of tools. We run the loop, call the tools, and hand back the answer with every step, signed.", file: "agent.ts",
    code: `const res = await fetch("${HOST}/v1/agents/run", {
  method: "POST",
  headers: { Authorization: \`Bearer \${AH_KEY}\` },
  body: JSON.stringify({
    instructions: "Find three dental practices in Leeds and their websites.",
    tools: ["find-companies", "company-research"],
    max_steps: 6,
  }),
});
const { output, steps } = await res.json();
// 12p a step: max_steps 6 is 72p`,
    float: () => (<><p className="float-t">Agent run · 6 steps</p><p className="float-big">3 found</p>{[["find-companies", "LS1, LS2 · 86"], ["company-research", "Kirkgate Dental"], ["company-research", "Aire Smiles"]].map(([t, v], i) => <div className="mini-row" key={i}><span className="mono" style={{ fontSize: 13 }}>{t}</span><span className="dt">{v}</span></div>)}</>) },
  { k: "Call a tool", title: "Call a tool", d: "Every tool in the catalogue is one POST. Company data, web research, page reading, and tools developers publish.", file: "tool.ts",
    code: `const res = await fetch(
  "${HOST}/v1/tools/company-research",
  {
    method: "POST",
    headers: { Authorization: \`Bearer \${AH_KEY}\` },
    body: JSON.stringify({ name: "Peel Street Accountants" }),
  },
);
const { result, signature } = await res.json();
console.log(result.check.status, result.likely_website);`,
    float: () => (<><p className="float-t">company-research · 8p</p><p className="float-big">Active</p><div className="mini-row" style={{ marginTop: 12 }}><div><b>PEEL STREET ACCOUNTANTS LTD</b><span>Companies House · 10284419</span></div></div><div className="mini-row"><span>Likely website</span><b className="mono" style={{ fontSize: 13 }}>peelstreet.example</b></div></>) },
  { k: "Publish a tool", title: "Publish a tool", d: "Put your API in front of every agent. List it once; it shows in the catalogue, MCP and llms.txt, and you earn 80% of each call.", file: "publish.ts",
    code: `await fetch("${HOST}/api/dev/tools", {
  method: "POST",
  headers: { Authorization: \`Bearer \${AH_KEY}\` },
  body: JSON.stringify({
    slug: "uk-vat-check",
    name: "UK VAT number check",
    description: "Whether a VAT number is valid, and who it belongs to.",
    endpoint: "https://vat.example.com/check",
    price_pence: 3,
    input_schema: { type: "object", properties: { number: { type: "string" } } },
  }),
});`,
    float: () => (<><p className="float-t">uk-vat-check</p><p className="float-big">Live</p><div className="mini-row" style={{ marginTop: 12 }}><span>Calls this month</span><b>1,284</b></div><div className="mini-row"><span>You earned, 80%</span><span className="chip-ok">£30.82</span></div></>) },
  { k: "MCP", title: "MCP", d: "One URL gives Claude, or any MCP client, the whole catalogue as tools, billed to your key.", file: "mcp.json",
    code: `{
  "mcpServers": {
    "agent-house": {
      "url": "${HOST}/mcp",
      "headers": {
        "Authorization": "Bearer ah_live_…"
      }
    }
  }
}`,
    float: () => (<><p className="float-t">tools/list</p><p className="float-big">8 + yours</p>{["uk-check", "company-research", "read-page"].map((t) => <div className="mini-row" key={t}><span className="mono" style={{ fontSize: 13 }}>{t}</span><span className="chip-ok">ready</span></div>)}</>) },
  { k: "Pay per call", title: "Pay per call", d: "No account, no key. Agents pay each call in USDC with x402 and get the same signed answer.", file: "x402.ts",
    code: `// 1. Ask: the API answers 402 with its price
let res = await fetch(\`\${HOST}/v1/tools/uk-check\`, req);
const quote = res.headers.get("PAYMENT-REQUIRED");

// 2. Pay the quote with your x402 wallet
const payment = await wallet.pay(quote);

// 3. Retry with the payment attached
res = await fetch(\`\${HOST}/v1/tools/uk-check\`, {
  ...req,
  headers: { "PAYMENT-SIGNATURE": payment },
});`,
    float: () => (<><p className="float-t">x402 · Base</p><p className="float-big">0.0625 USDC</p><div className="mini-row" style={{ marginTop: 12 }}><span>402 Payment Required</span><span className="dt">quoted</span></div><div className="mini-row"><span>200 OK, signed answer</span><span className="chip-ok">settled</span></div></>) },
  { k: "Verify", title: "Verify", d: "Every answer is signed with Ed25519. Check it against our published key before you act on it.", file: "verify.ts",
    code: `const { keys } = await fetch(
  "${HOST}/.well-known/agent-house-key",
).then((r) => r.json());

const key = await crypto.subtle.importKey(
  "jwk", keys[0], { name: "Ed25519" }, false, ["verify"],
);
const { signature, ...body } = answer;
const ok = await crypto.subtle.verify(
  "Ed25519", key, sig(signature), canonical(body),
);`,
    float: () => (<><p className="float-t">Signature</p><p className="float-big">Valid</p><div className="mini-row" style={{ marginTop: 12 }}><span>Key</span><b className="mono">ah-2026-10</b></div><div className="mini-row"><span>Tampered copy</span><span className="sev sev-crit">Rejected</span></div></>) },
];
export function ApiShowcase({ title }) {
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(false);
  const [ref, seen] = useInView({ threshold: 0.3 });
  useEffect(() => {
    if (!seen || pause || reduced()) return;
    const t = setTimeout(() => setI((x) => (x + 1) % API.length), ADV);
    return () => clearTimeout(t);
  }, [i, seen, pause]);
  const a = API[i];
  const F = a.float;
  return (
    <section className="band" style={{ paddingTop: 40 }}>
      <div className="wrap">
        {title && <Reveal as="h2" className="display" style={{ marginBottom: 88 }}>{title}</Reveal>}
        <div className="api" ref={ref} onMouseEnter={() => setPause(true)} onMouseLeave={() => setPause(false)}>
          <div className="api-left">
            <div className="api-prog" aria-hidden="true">
              {API.map((_, j) => <span key={j} className={j < i ? "done" : j === i ? "cur" : ""}><i key={i + "-" + j + (pause ? "p" : "")} style={j === i ? { animationDuration: ADV + "ms", animationPlayState: pause || !seen ? "paused" : "running" } : undefined} /></span>)}
            </div>
            <div className="api-copy api-fade" key={a.k}>
              <h3>{a.title}</h3>
              <p>{a.d}</p>
              <Link to="/developers?s=reference" className="link">API reference</Link>
            </div>
          </div>
          <div className="api-right">
            <Editor key={a.file} className="api-fade" file={a.file} code={a.code} />
            <div className="float" key={"f" + a.k}><F /></div>
          </div>
        </div>
        <div className="api-tabs" role="tablist" aria-label="API examples">
          {API.map((x, j) => <button key={x.k} role="tab" aria-selected={j === i} className={j === i ? "is-on" : ""} onClick={() => setI(j)}>{x.k}</button>)}
        </div>
      </div>
    </section>
  );
}

