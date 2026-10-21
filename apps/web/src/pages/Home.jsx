import React, { useEffect, useState } from "react";
import { Link } from "../router.jsx";
import { Page, reduced } from "../ui.jsx";
import { Reveal, Tile, Glyph, Marquee, Terminal, DarkBand, useInView } from "../kit.jsx";
import { ApiShowcase, TERM } from "./showcase.jsx";

/* ---------- 1. Hero: agents at work, scrolling past ---------- */
const WORK = [
  ["OUTREACH", "Drafted first email · Peel Street Accountants"], ["INBOX", "Quote request triaged · urgent"], ["CREDIT CONTROL", "Reminder sent · INV-1042 · £640.00"],
  ["uk-check", "5p · x402 settled · signed"], ["RESEARCH", "3 sources read · answer ready"], ["LEAD FINDER", "214 companies · M1–M50"],
  ["WATCH", "Administrators appointed · Ellacombe Print"], ["read-page", "1p · castlefielddental.example"], ["INBOX", "Reply drafted · Castlefield Dental"],
  ["BRIEFING", "Monday 07:00 · 14 runs · 6 sent"], ["company-research", "8p · key ah_live_7f…"], ["OUTREACH", "Lead saved · Ancoats Architects"],
  ["uk-vat-check", "3p · published by a developer"], ["TASKS", "Call Salford Quays Media"], ["CREDIT CONTROL", "Second reminder · auto"],
  ["agents/run", "72p · 6 steps · signed"], ["INBOX", "Supplier offer · ignored"], ["WATCH", "Accounts overdue · Tarnbrook Logistics"],
];
const HOT = new Set([0, 6, 9, 14]);
function Wall() {
  const cols = Array.from({ length: 6 }, (_, c) => Array.from({ length: 14 }, (_, i) => (c * 5 + i * 7) % WORK.length));
  return (
    <div className="hx-wall" aria-hidden="true">
      {cols.map((col, c) => (
        <div className="hx-col" key={c} style={{ animationDuration: 70 + c * 12 + "s", marginTop: -c * 90 }}>
          {[...col, ...col].map((w, i) => (
            <div key={i} className={"hx-row" + (HOT.has(w) && (i + c) % 3 === 0 ? " is-hot" : "")}>{WORK[w][0]} <i>{WORK[w][1]}</i></div>
          ))}
        </div>
      ))}
    </div>
  );
}

const LIVE_CARDS = [
  ["send", "var(--ink)", "Email to Peel Street Accountants", "Outreach · waiting for you"],
  ["inbox", "var(--signal)", "Quote request: 3 floors at MediaCity", "Inbox · urgent · reply drafted"],
  ["pound", "var(--data)", "Reminder sent for INV-1042", "Credit control · approved first time"],
  ["tools", "var(--data)", "uk-check called by an agent", "5p · paid with x402 · signed"],
];
export function LiveAlerts() {
  const [n, setN] = useState(1);
  useEffect(() => {
    if (reduced()) { setN(3); return; }
    const t = setInterval(() => setN((x) => (x >= LIVE_CARDS.length ? 1 : x + 1)), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hx-live" aria-hidden="true">
      {LIVE_CARDS.slice(0, n).slice(-3).map(([g, c, t, s]) => (
        <div className="hx-alert" key={t}><Tile name={g} color={c} /><div><b>{t}</b><span>{s}</span></div></div>
      ))}
    </div>
  );
}

function Hero() {
  return (
    <section className="hx" aria-labelledby="hx-h">
      <div className="hx-media"><Wall /></div>
      <div className="hx-shade" />
      <LiveAlerts />
      <div className="wrap hx-copy">
        <h1 id="hx-h">Agents that run your business.</h1>
        <p className="hx-sub">Hire them. Build for them. Sell to them.</p>
        <div className="actions">
          <Link to="/start" className="btn btn-lg btn-light">Start free</Link>
          <Link to="/workspace" className="link">Explore the demo workspace</Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- 2. Three doors ---------- */
function MiniApprove() {
  return (
    <div className="mini">
      <div className="mini-h"><span>Waiting for you</span><span className="st st-waiting">3</span></div>
      {[["Email Peel Street Accountants", "Outreach"], ["Reply to Salford Quays Media", "Inbox"], ["Reminder for INV-1047", "Credit control"]].map(([t, a]) => (
        <div className="mini-row" key={t}><div><b>{t}</b><span>{a}</span></div><span className="mini-btn">Approve</span></div>
      ))}
    </div>
  );
}
function MiniPublish() {
  return (
    <div className="mini">
      <div className="mini-h"><span className="mono">uk-vat-check</span><span className="st st-done">Live</span></div>
      <p className="mini-big">£30.82</p>
      <p className="dt">earned this month · 80% of 1,284 calls at 3p</p>
      <div className="mini-bars">{[22, 30, 26, 41, 38, 52, 49, 61, 70, 66, 82, 96].map((v, i) => <i key={i} style={{ height: v + "%", animationDelay: i * 50 + "ms" }} />)}</div>
    </div>
  );
}
function MiniX402() {
  return (
    <div className="mini">
      <div className="mini-h"><span className="mono">POST /v1/tools/uk-check</span></div>
      <div className="mini-row"><span className="mono">402</span><span className="dt">PAYMENT-REQUIRED · 5p</span></div>
      <div className="mini-row"><span className="mono">→</span><span className="dt">PAYMENT-SIGNATURE · USDC on Base</span></div>
      <div className="mini-row"><span className="mono">200</span><span className="chip-ok">settled · signed</span></div>
      <p className="dt mono" style={{ marginTop: 10 }}>no account · no key</p>
    </div>
  );
}
const DOORS = [
  ["For businesses", "Hire agents for sales, the inbox, invoices and research. They work from your profile and ask before they send.", "/agents", MiniApprove],
  ["For developers", "Publish your API as a tool. Agents find it, call it and pay for it. You earn 80% of every call.", "/developers", MiniPublish],
  ["For agents", "A catalogue of tools any agent can discover and pay for per call with x402. Every answer signed.", "/for-agents", MiniX402],
];
function Doors() {
  return (
    <section className="band" style={{ paddingTop: 96 }}>
      <div className="wrap">
        <Reveal as="h2" className="display" style={{ marginBottom: 88 }}>Everything agentic, under one roof.</Reveal>
        <div className="pgrid">
          {DOORS.map(([t, d, to, Vis], i) => (
            <Reveal key={t} delay={i * 90}>
              <Link to={to} className="pcard"><div className="pcard-vis"><Vis /></div><h3>{t}</h3><p>{d}</p></Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- 3. For businesses: the agents' to-do list ---------- */
const RECS = [
  ["send", "var(--ink)", "Outreach drafted 3 first emails to dental practices in M3. Review them"],
  ["inbox", "var(--signal)", "Inbox marked a quote request for nightly cleaning as urgent"],
  ["pound", "var(--data)", "Credit control chased INV-1042. Quayside say they'll pay Friday"],
  ["stop", "var(--signal)", "Administrators appointed at Ellacombe Print. Hold new work"],
  ["search", "var(--ink)", "Research: three competitors in Salford charge £18 to £22 an hour"],
  ["bell", "var(--data)", "Weekly briefing: 14 runs, 6 emails sent, £2,240 overdue"],
];
function Stack() {
  const [k, setK] = useState(0);
  const [ref, seen] = useInView({ threshold: 0.3 });
  useEffect(() => {
    if (!seen || reduced()) return;
    const t = setInterval(() => setK((x) => x + 1), 3200);
    return () => clearInterval(t);
  }, [seen]);
  const n = RECS.length;
  return (
    <div className="stack" ref={ref}>
      <svg className="stack-curve" viewBox="0 0 900 640" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 600 C 260 600, 300 560, 380 420 S 600 120, 900 60" strokeDasharray="1400" strokeDashoffset={seen ? 0 : 1400} style={{ transition: "stroke-dashoffset 2.2s cubic-bezier(.2,.7,.2,1)", opacity: 0.55 }} />
      </svg>
      <ul aria-label="What agents did this week">
        {RECS.map(([g, c, t], i) => {
          const age = ((k - i) % n + n) % n;
          const vis = age <= 3;
          const y = age <= 3 ? (3 - age) * 112 : age === 4 ? -70 : 460;
          return (
            <li key={t} className="stack-card" style={{ transform: `translateY(${y}px)`, zIndex: 10 - age, opacity: vis ? 1 : 0, width: [96, 91, 86, 81][Math.min(age, 3)] + "%" }} aria-hidden={!vis}>
              <Tile name={g} color={c} /><span>{t}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
function Businesses() {
  return (
    <section className="band">
      <div className="wrap split">
        <Reveal>
          <p className="label">For businesses</p>
          <h2>Staff for the jobs that never get done</h2>
          <p className="body-l">Each agent takes one job off your list: finding customers, answering enquiries, chasing invoices, watching who you deal with. They work from your business profile, show every step, and ask before anything leaves your name.</p>
          <div className="actions"><Link to="/agents" className="btn btn-lg">See every agent</Link><Link to="/workspace" className="link">Try the demo workspace</Link></div>
        </Reveal>
        <Stack />
      </div>
    </section>
  );
}

/* ---------- 4. The agent line-up, with live mini interfaces ---------- */
function MiniLeads() {
  const rows = [["Peel Street Accountants", "Email drafted", "waiting"], ["Castlefield Dental Care", "Replied", "done"], ["Ancoats Architects", "Won", "done"], ["Salford Quays Media", "Call: no email", "paused"]];
  return (
    <div className="mini">
      <div className="mini-h"><span>Leads</span><span className="dt">8 this week</span></div>
      {rows.map(([c, s, k]) => <div className="mini-row" key={c}><b>{c}</b><span className={"st st-" + k}>{s}</span></div>)}
    </div>
  );
}
function MiniInbox() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, paddingTop: 24 }}>
      <div className="bubble bubble-in" style={{ background: "#fff", color: "var(--ink)" }}><b style={{ display: "block", fontSize: 13, color: "var(--signal)", marginBottom: 4 }}>Urgent · quote</b>Could you quote for a nightly clean, three floors at MediaCity?</div>
      <div className="bubble bubble-out"><span className="avatar">AH</span>Draft ready: two questions to price it, and a visit this week.</div>
      <div className="bubble bubble-in"><b style={{ display: "block", fontSize: 13, color: "#9FB6FF", marginBottom: 4 }}>Approved · sent from your address</b>Replies come straight back to you.</div>
    </div>
  );
}
function MiniCash() {
  const h = [96, 84, 80, 61, 52, 50, 46, 40, 32, 22, 18, 12];
  return (
    <div className="mini">
      <p className="dt">Overdue, falling</p>
      <p className="mini-big">£2,336</p>
      <div className="mini-bars">{h.map((v, i) => <i key={i} style={{ height: v + "%", animationDelay: i * 50 + "ms" }} />)}</div>
    </div>
  );
}
function MiniWatch() {
  const rows = [["Ellacombe Print", "Administrators appointed", "Critical"], ["Tarnbrook Logistics", "Accounts overdue", "Review"], ["Harlow Vale Studios", "No changes this week", null], ["Calder Joinery", "No changes this week", null]];
  return (
    <div className="mini">
      <div className="mini-h"><span>Customers and suppliers</span><span className="dt">64 watched</span></div>
      {rows.map(([c, f, s]) => <div className="mini-row" key={c}><div><b>{c}</b><span>{f}</span></div>{s ? <span className={"sev " + (s === "Critical" ? "sev-crit" : "sev-rev")}>{s}</span> : <span className="chip-ok">Clear</span>}</div>)}
    </div>
  );
}
function MiniResearch() {
  return (
    <div className="mini">
      <p className="dt">You asked</p>
      <p style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em", margin: "4px 0 12px" }}>What do office cleaners in Salford charge?</p>
      <p className="body" style={{ fontSize: 14 }}>Two of three publish prices: about £18 to £22 an hour, two-hour minimum.</p>
      {["salford-cleaning-prices", "sparkle-commercial", "quays-cleaning"].map((s, i) => <div className="mini-row" key={s}><span className="mono" style={{ fontSize: 12 }}>[{i + 1}] {s}.example</span></div>)}
    </div>
  );
}
function MiniBriefing() {
  return (
    <div className="mini">
      <p className="dt">Monday 07:00 · Weekly briefing</p>
      {[["Runs", "14"], ["Emails sent", "6"], ["Replies", "1"], ["Overdue", "£2,240"], ["Needs you", "3 drafts"]].map(([k, v]) => <div className="mini-row" key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
  );
}
const AGENTS = [
  ["Outreach", "Finds companies that fit, reads their website and the register, and drafts a personal first email.", "/agents/outreach", MiniLeads],
  ["Inbox", "Sorts every enquiry, drafts the reply and flags what's urgent. Forward your inbox and it starts.", "/agents/inbox", MiniInbox],
  ["Credit control", "Polite reminders on time, firmer ones when they're late, and a task when it's time to call.", "/agents/credit-control", MiniCash],
  ["Customer watch", "Every customer and supplier checked against Companies House and The Gazette, continuously.", "/agents/customer-watch", MiniWatch],
  ["Research", "Ask a question about a competitor, a company or a market. Get an answer with its sources.", "/agents/research", MiniResearch],
  ["Weekly briefing", "One short note each Monday: what your agents did and what needs you.", "/agents/briefing", MiniBriefing],
];
function LineUp() {
  return (
    <section className="band" style={{ paddingTop: 80 }}>
      <div className="wrap">
        <Reveal as="h2" className="display" style={{ marginBottom: 96 }}>Hire for every part of the business.</Reveal>
        <div className="pgrid">
          {AGENTS.map(([t, d, to, Vis], i) => (
            <Reveal key={t} delay={(i % 3) * 90}>
              <Link to={to} className="pcard"><div className="pcard-vis"><Vis /></div><h3>{t}</h3><p>{d}</p></Link>
            </Reveal>
          ))}
        </div>
        <p className="more" style={{ marginTop: 40 }}><Link to="/agents" className="link">All twelve agents, including bookings, reviews, social and bookkeeping</Link></p>
      </div>
    </section>
  );
}

/* ---------- 5. For developers: the MCP terminal ---------- */
function Developers() {
  return (
    <section className="band">
      <div className="wrap split">
        <Reveal>
          <p className="label">For developers</p>
          <h2>Give your agent the whole catalogue</h2>
          <p className="body-l">Add one MCP server and your agent can check companies, research the web and call every tool developers publish here. Or publish your own API and earn on every call.</p>
          <div className="actions"><Link to="/developers?s=key" className="btn btn-lg">Get a free API key</Link><Link to="/developers/dashboard" className="link">Publish a tool</Link></div>
        </Reveal>
        <Reveal delay={120}><Terminal title="~ — zsh" lines={TERM} /></Reveal>
      </div>
    </section>
  );
}

/* ---------- 6. Examples carousel in a browser frame ---------- */
function ApproveMock() {
  const items = [["Email Peel Street Accountants", "Outreach"], ["Reply to Salford Quays Media", "Inbox"], ["Reply to Castlefield Dental Care", "Inbox"], ["Reminder for INV-1047", "Credit control"]];
  return (
    <div className="inbox" style={{ background: "#fff" }}>
      <ul className="inbox-list">{items.map(([t, c], i) => <li key={t}><span className={"inbox-item" + (i === 0 ? " is-sel" : "")}><span className="ii-top"><b>{t}</b></span><span className="ii-co">{c}</span><span className="dt">{i + 1} hours ago</span></span></li>)}</ul>
      <div className="inbox-detail"><p className="dt">Outreach, see the run</p><h2 className="h-small">Email Peel Street Accountants</h2>
        <p className="why"><span className="dt">Why</span>New lead in M3: 15 staff, accountancy practice, public office email.</p>
        <dl className="mail"><div><dt>To</dt><dd className="mono">office@peelstreet.example</dd></div><div><dt>Subject</dt><dd>Office cleaning for Peel Street Accountants</dd></div></dl>
        <p className="mail-body pre">{"Hello,\n\nI run Brightwork Cleaning, a Manchester firm that looks after offices and clinics across the city centre…"}</p>
        <div className="actions actions-tight"><span className="btn">Approve and send</span><span className="btn btn-line">Reject</span></div>
      </div>
    </div>
  );
}
function RunMock() {
  const steps = [["business-profile", "{}"], ["find-companies", '{"count":5}'], ["company-research", '{"name":"Peel Street Accountants Ltd"}'], ["read-page", '{"url":"https://peelstreet.example"}'], ["save-lead", '{"company":"Peel Street Accountants Ltd"}'], ["propose-email", '{"to":"office@peelstreet.example"}']];
  return (
    <div style={{ background: "#fff", padding: 40, borderRadius: 24 }}>
      <p className="dt">Activity · Outreach · 09:43</p>
      <h2 className="h-small" style={{ margin: "6px 0 16px" }}>Found 2 companies that fit and drafted a first email</h2>
      <ol className="steps">{steps.map(([t, i], n) => <li key={t}><span className="step-n">{n + 1}</span><div className="step-b"><p><b className="mono">{t}</b></p><p className="mono step-in">{i}</p></div></li>)}</ol>
    </div>
  );
}
function CatalogueMock() {
  const rows = [["Check a UK company", "uk-check", "5p", "Agent House"], ["Company research", "company-research", "8p", "Agent House"], ["Read a web page", "read-page", "1p", "Agent House"], ["UK VAT number check", "uk-vat-check", "3p", "Developer"]];
  return (
    <div className="tool-list" style={{ padding: 32, background: "var(--surface)", borderRadius: 24 }}>
      {rows.map(([n, s, p, by]) => <div className="tool" key={s}><div className="tool-h"><span className="tool-n"><b>{n}</b><span className="mono muted">{s}</span></span><span className="tool-d">Signed answer, paid per call with x402 or a key.</span><span className="tool-p"><b>{p}</b><span className="dt">{by}</span></span></div></div>)}
    </div>
  );
}
const EXAMPLES = [
  { t: "Approvals", d: "Every email an agent wants to send, with why it chose it. Edit anything, then approve. It goes from your address.", cta: ["Open the demo", "/workspace/approvals"], url: "Workspace · Approvals", Stage: ApproveMock },
  { t: "Every step, recorded", d: "Open any run to see each tool the agent used, what it sent and what came back. Nothing is a black box.", cta: ["See a run", "/workspace/runs/run_1"], url: "Workspace · Activity", Stage: RunMock },
  { t: "The tool catalogue", d: "First-party and developer tools with a price on each. Agents discover them, pay per call and verify the answer.", cta: ["For agents", "/for-agents"], url: "agenthouse · /v1/tools", Stage: CatalogueMock },
];
function Examples() {
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(false);
  useEffect(() => {
    if (pause || reduced()) return;
    const t = setTimeout(() => setI((x) => (x + 1) % EXAMPLES.length), 8000);
    return () => clearTimeout(t);
  }, [i, pause]);
  const e = EXAMPLES[i];
  const S = e.Stage;
  return (
    <section className="band" style={{ paddingTop: 40 }}>
      <div className="wrap">
        <Reveal as="h2" className="display" style={{ marginBottom: 96 }}>See it working.</Reveal>
        <div className="ex" onMouseEnter={() => setPause(true)} onMouseLeave={() => setPause(false)}>
          <div className="api-fade" key={e.t}>
            <h3>{e.t}</h3>
            <p>{e.d}</p>
            <div className="actions"><Link to={e.cta[1]} className="btn btn-lg">{e.cta[0]}</Link></div>
            <div className="ex-nav">
              <button aria-label="Previous example" onClick={() => setI((i + EXAMPLES.length - 1) % EXAMPLES.length)}><Glyph name="left" size={18} /></button>
              <button aria-label="Next example" onClick={() => setI((i + 1) % EXAMPLES.length)}><Glyph name="right" size={18} /></button>
              <span>{String(i + 1).padStart(2, "0")} / {String(EXAMPLES.length).padStart(2, "0")}</span>
            </div>
          </div>
          <div className="browser">
            <div className="browser-in">
              <div className="browser-top">{e.url} · example data</div>
              <div className="browser-stage" aria-hidden="true"><div className="browser-scale api-fade" key={e.t}><S /></div></div>
              <Link to={e.cta[1]} className="preview-pill"><Glyph name="expand" size={20} />Preview</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- 7. Works with ---------- */
function WorksWith() {
  return <section style={{ padding: "40px 0 24px" }}><Marquee caption="Works with what you already use" items={["Gmail", "Outlook", "Slack", "Microsoft Teams", "Xero exports", "QuickBooks exports", "Companies House", "The Gazette", "Claude", "MCP", "x402", "USDC on Base", "Stripe"]} /></section>;
}

/* ---------- 8. Mission ---------- */
const CELLS = [["Lead saved", "Outreach"], ["Email drafted", "Outreach"], ["Quote triaged", "Inbox"], ["Reply drafted", "Inbox"], ["Invoice chased", "Credit control"], ["Company checked", "uk-check"], ["Page read", "read-page"], ["Task created", "Outreach"], ["Briefing sent", "Briefing"], ["Alert raised", "Watch"], ["Answer sourced", "Research"], ["Tool called", "x402"], ["Payment settled", "x402"], ["Tool published", "Developer"]];
function MissionGrid() {
  const [tick, setTick] = useState(0);
  useEffect(() => { if (reduced()) return; const t = setInterval(() => setTick((x) => x + 1), 1600); return () => clearInterval(t); }, []);
  return (
    <div className="mgrid" aria-hidden="true">
      {Array.from({ length: 42 }, (_, i) => {
        const v = (i * 5 + tick * 7) % 23;
        const [a, b] = CELLS[(i * 3 + Math.floor(tick / 4)) % CELLS.length];
        return <div key={i} className={v === 0 ? "hot" : v < 6 ? "on" : ""}>{a}<span>{b}</span></div>;
      })}
    </div>
  );
}
function Mission() {
  return (
    <section className="band" style={{ overflow: "hidden" }}>
      <div className="wrap mission">
        <Reveal>
          <h2>Our mission is to give every small business the team it can't yet hire.</h2>
          <p>Agent House is built in Manchester. Our agents show their work, ask before they act in your name, and never invent a fact, a figure or an email address. The tools they use are open to every other agent too.</p>
          <div className="actions"><Link to="/start" className="btn btn-lg">Start free</Link><Link to="/trust" className="link">How we keep agents honest</Link></div>
        </Reveal>
        <div className="mission-vis"><MissionGrid /></div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Page title="Agents that run your business">
      <Hero />
      <Doors />
      <Businesses />
      <LineUp />
      <Developers />
      <ApiShowcase title="Build on the same tools." />
      <Examples />
      <WorksWith />
      <Mission />
      <DarkBand glyph="agent" title="Try six agents free for 14 days" body="Tell us about your business in two minutes. Your agents start working today, and nothing is sent without your approval." cta={["Start free", "/start"]} note="No card needed." />
    </Page>
  );
}
