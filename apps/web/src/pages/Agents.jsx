// The public agent catalogue and one page per agent, both built from packages/core/templates.ts,
// the same list the API hires from.
import React from "react";
import { Link } from "../router.jsx";
import { Page, PageHead, Section, SectionHead, SpecTable, QA, NextPrev, CtaBand, Brief, Severity } from "../ui.jsx";
import { Reveal, Glyph, Tile } from "../kit.jsx";
import { useWs } from "../layout.jsx";
import { TEMPLATES, RHYTHM_LABEL, PLANS } from "../../../../packages/core/templates.ts";
import { SAMPLE_CHECKS, PROSPECTS } from "../data.js";
import { NotFound } from "./Service.jsx";

export const CATS = [["Grow", "Win more work"], ["Run", "Keep the day running"], ["Get paid", "Get paid on time"], ["Protect", "Avoid bad debts"], ["Know", "Know what's going on"]];
const SENDS = new Set(["outreach", "inbox", "credit-control"]);
const ALIAS = { "client-book-watch": "customer-watch", "new-client-check": "customer-check", "prospect-finder": "lead-finder" };

function useHire() {
  const { me } = useWs() || {};
  return (key) => (me ? "/workspace/agents/new?t=" + key : "/start?agent=" + key);
}

/* ---------- Index ---------- */
export function AgentsIndex() {
  const hire = useHire();
  return (
    <Page title="Agents">
      <PageHead crumbs={[["Agents"]]} label="For businesses" title="Agents for every part of a small business" lede="Each agent does one job well. They work from your business profile, use tools from the Agent House catalogue, show every step, and ask before anything goes out in your name."
        actions={<><Link to="/start" className="btn btn-lg">Start free</Link><Link to="/workspace" className="btn btn-lg btn-line">Try the demo</Link></>} />
      <Section tight>
        {CATS.map(([cat, line]) => (
          <div key={cat} className="cat-group">
            <h2 className="cat-h cat-h-l">{cat}<span>{line}</span></h2>
            <div className="cat-grid cat-grid-l">
              {TEMPLATES.filter((t) => t.category === cat).map((t) => (
                <article key={t.key} className={"cat-card" + (t.status === "next" ? " is-next" : "")}>
                  <span className="ac-top"><span className={"tile tile-agent" + (t.status === "live" ? "" : " is-off")}><Glyph name={t.glyph} /></span>{t.status === "next" ? <span className="st st-paused">Coming soon</span> : <span className="dt">{RHYTHM_LABEL[t.rhythm]}</span>}</span>
                  <h3 className="ac-name"><Link to={"/agents/" + t.key} className="card-link">{t.name}</Link></h3>
                  <p className="cat-d">{t.short}</p>
                  {t.status === "next" && <p className="dt">Needs {t.needs}</p>}
                  <div className="cat-act">
                    {t.status === "live" && <Link to={hire(t.key)} className="btn btn-sm btn-line">Hire</Link>}
                    <Link to={"/agents/" + t.key} className="link link-s">How it works</Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </Section>
      <Section stone>
        <SectionHead label="How they work" title="Four rules every agent follows" lede="The same rules hold whichever agent you hire, and whichever tools it uses." />
        <ol className="rules">
          {[["workspace", "It knows your business", "Every agent reads your business profile first: what you do, who you serve, where, and how you write."],
            ["tools", "It uses real tools", "Register checks, web research and page reading from the Agent House catalogue. It never invents a fact, a figure or an email address."],
            ["send", "It asks before it sends", "Emails wait in Approvals until you say yes. You can let follow-ups go on their own once you trust it."],
            ["method", "It shows its work", "Every run is recorded step by step: each tool it called, what it sent, what came back."]].map(([g, t, d], i) => (
            <Reveal as="li" key={t} delay={i * 80}><Tile name={g} /><b>{t}</b><p>{d}</p></Reveal>
          ))}
        </ol>
      </Section>
      <CtaBand />
    </Page>
  );
}

/* ---------- Visuals, one per agent ---------- */
function EmailCard({ from, why, to, subject, body }) {
  return (
    <div className="panel email-card">
      <p className="dt">{from}</p>
      <p className="why"><span className="dt">Why</span>{why}</p>
      <dl className="mail"><div><dt>To</dt><dd className="mono">{to}</dd></div><div><dt>Subject</dt><dd>{subject}</dd></div></dl>
      <p className="mail-body pre">{body}</p>
      <div className="actions actions-tight"><span className="btn btn-sm">Approve and send</span><span className="btn btn-sm btn-line">Edit</span><span className="link link-s">Reject</span></div>
    </div>
  );
}
function AlertCard() {
  return (
    <div className="alert-card">
      <div className="ac-row ac-top"><b className="ac-title">Administrators appointed</b><Severity s="Critical" /></div>
      <p className="ac-co">Ellacombe Print Ltd <span className="mono muted">08812234</span></p>
      <div className="ac-facts">
        <dl>
          <div><dt>Status</dt><dd>Active, in administration</dd><span className="src">Companies House</span></div>
          <div><dt>Notice</dt><dd>Appointment of administrators</dd><span className="src">The Gazette</span></div>
          <div><dt>Next invoice</dt><dd>1 Nov 2026, £1,450</dd><span className="src">Your list</span></div>
        </dl>
      </div>
      <div className="ac-next"><p>Hold new work and talk to them before the 1 November invoice.</p></div>
      <div className="ac-meta"><p>Matched on company number. Checked 20 Oct 2026, 07:01.</p></div>
    </div>
  );
}
const VISUAL = {
  outreach: () => <EmailCard from="Outreach · drafted 5 hours ago" why="Accountancy practice in M3 with 15 staff. Their site mentions a new client meeting suite." to="office@peelstreet.example" subject="Office cleaning for Peel Street Accountants" body={"Hello,\n\nI run Brightwork Cleaning, a Manchester firm that looks after offices and clinics across the city centre.\n\nI noticed you've added a meeting suite for clients. Spaces like that are where a daily tidy makes the biggest difference. We clean before 8am or after 6pm, so your team never works around us.\n\nWould a short visit next week to give you a fixed monthly price be useful?\n\nDana Price, Brightwork Cleaning"} />,
  inbox: () => <EmailCard from="Inbox · reply drafted 38 min ago" why="Quote request, marked urgent. Asks the two questions you need to price it." to="facilities@salfordmedia.example" subject="Re: Quote for nightly cleaning, 3 floors" body={"Hello,\n\nThanks for getting in touch. Nightly cleaning across three floors is exactly what we do.\n\nTo give you an accurate fixed price, could you tell me roughly how many kitchens and washrooms there are, and whether you need weekend cover?\n\nDana Price, Brightwork Cleaning"} />,
  "credit-control": () => (
    <div className="ladder">
      {[["Due date", "Invoice INV-1047, £1,280.00", "Nothing sent"], ["1 day late", "A friendly note: it may already be on its way", "Waits for your approval"], ["8 days late", "A firmer reminder with the amount and date", "Goes on its own if you approved the first"], ["15 days late", "A task for you: time to call", "Agents never threaten or add charges"]].map(([d, t, s], i) => (
        <div key={d} className={"ladder-i" + (i === 3 ? " is-hot" : "")}><span className="dt">{d}</span><b>{t}</b><span className="dt">{s}</span></div>
      ))}
    </div>
  ),
  "customer-watch": AlertCard,
  "customer-check": () => <Brief sample={SAMPLE_CHECKS.tarnbrook} />,
  "lead-finder": () => (
    <table className="ledger ws-table">
      <thead><tr><th>Company</th><th className="hide-sm">Number</th><th>District</th><th className="num">Since</th></tr></thead>
      <tbody>{PROSPECTS.slice(0, 7).map(([n, no, d, , y]) => <tr key={no}><td>{n}</td><td className="mono hide-sm">{no}</td><td>{d}</td><td className="num">{y}</td></tr>)}</tbody>
    </table>
  ),
  research: () => (
    <div className="panel">
      <p className="q-line"><span className="dt">You asked</span>Which office cleaning firms compete with us in Salford, and what do they charge?</p>
      <p className="body">Three firms advertise office cleaning in Salford. Two publish prices: about £18 to £22 an hour for regular contracts, with a two-hour minimum a visit. The third quotes only after a site visit.</p>
      <h3 className="flabel mt-s">Sources</h3>
      <ol className="sources">{["example.com/salford-cleaning-prices", "example.com/sparkle-commercial", "example.com/quays-cleaning"].map((s) => <li key={s}><span className="link link-s">{s}</span></li>)}</ol>
    </div>
  ),
  briefing: () => (
    <div className="panel">
      <p className="dt">Monday 07:00 · to dana@brightwork.example</p>
      <h3 className="h-small mt-s">Weekly briefing</h3>
      <dl className="facts-tab">{[["Runs", "14"], ["Emails sent", "6, from your address"], ["Replies", "Castlefield Dental wants a walk-round"], ["Overdue", "£2,240 across 3 invoices"], ["Needs you", "3 drafts waiting in Approvals"]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  ),
};

/* ---------- One agent ---------- */
export function AgentPage({ slug }) {
  const hire = useHire();
  const key = ALIAS[slug] || slug;
  const i = TEMPLATES.findIndex((t) => t.key === key);
  if (i < 0) return <NotFound />;
  const t = TEMPLATES[i];
  const V = VISUAL[t.key];
  const prev = TEMPLATES[(i + TEMPLATES.length - 1) % TEMPLATES.length], next = TEMPLATES[(i + 1) % TEMPLATES.length];
  const live = t.status === "live";
  const spec = [
    ["Runs", RHYTHM_LABEL[t.rhythm]],
    ["You provide", t.needs],
    ...(SENDS.has(t.key) ? [["Before it sends", "Asks you first, by default. You can let follow-ups go on their own."]] : []),
    ...(t.engine === "llm" && t.tools.length ? [["Tools it can use", t.tools.join(", ")]] : []),
    ["Price", live ? `Included in every plan, from £${PLANS.starter.price} a month` : "Not yet available"],
  ];
  const faq = [
    ...(SENDS.has(t.key) ? [["Will it send anything without asking?", "Not unless you tell it to. By default every email waits in Approvals. You can edit it, approve it or reject it, and replies come straight back to you, not to us."]] : []),
    ["Where does its information come from?", t.engine === "llm" ? "Your business profile, the data you give it (leads, invoices, messages) and the tools it calls: Companies House, The Gazette, web search and the pages it reads. It's told never to invent facts or email addresses, and every step is recorded." : "Companies House, The Gazette and the FCA register, read directly and cited on every fact. It never guesses which company you meant; uncertain matches come back to you."],
    ["What does it cost?", `Every agent is included in every plan. Plans differ in how many agents work at once and how many actions they take a month. Starter is £${PLANS.starter.price} a month for two agents.`],
    ["Can I change what it does?", t.engine === "llm" ? "Yes. Each agent has a brief in plain English that you can edit, plus when it runs, where it reports, and a monthly limit." : "You choose which companies it covers and where its alerts go: Slack, Teams or email."],
  ];
  return (
    <Page title={t.name}>
      <PageHead crumbs={[["Agents", "/agents"], [t.name]]} label={t.category + (live ? "" : " · coming soon")} title={t.name} lede={t.description}
        actions={live ? <><Link to={hire(t.key)} className="btn btn-lg">Hire {t.name.toLowerCase()}</Link><Link to="/workspace" className="btn btn-lg btn-line">See it in the demo</Link></> : <Link to="/book-a-call" className="btn btn-lg">Tell us you want it</Link>} />
      <Section tight>
        <div className="agent-hero">
          <div>
            <p className="label">What it does</p>
            <ol className="does">{t.does.map((d, n) => <Reveal as="li" key={d} delay={n * 60}><span className="step-n">{n + 1}</span><span>{d}</span></Reveal>)}</ol>
            <SpecTable rows={spec} />
          </div>
          <div className="agent-vis">{V ? <V /> : <div className="panel next-panel"><Tile name={t.glyph} /><h3 className="h-small mt-s">Coming soon</h3><p className="body mt-s">{t.name} needs a connection to {t.needs}. We're building it now. Tell us you'd use it and we'll let you know the day it's ready.</p></div>}</div>
        </div>
      </Section>
      <Section stone>
        <SectionHead label="Questions" title={`About ${t.name.toLowerCase()}`} />
        <QA items={faq} />
      </Section>
      <NextPrev prev={[prev.name, "/agents/" + prev.key]} next={[next.name, "/agents/" + next.key]} />
      <CtaBand />
    </Page>
  );
}
