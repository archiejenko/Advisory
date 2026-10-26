import React, { useEffect, useState } from "react";
import { Link } from "../router.jsx";
import { Page, reduced, QA } from "../ui.jsx";
import { Minds, PRICING_SUB, PRICING_FOOT, PRICING_FAQ } from "../credits.jsx";
import { Reveal, Tile, Glyph, useInView } from "../kit.jsx";
import { FACETS, CATEGORIES } from "../../../../packages/core/os.ts";
import { PACKS, BUILDER_APPS } from "../../../../packages/core/osconfig.ts";
import { PLANS } from "../../../../packages/core/templates.ts";

// The landing page in eight sections. One promise: build the OS your business runs on, then let your AI Team run it.
// Words kept off this page above pricing: agent(s), swarm, orchestrator, MCP, x402, primitives.
const BUILD = "/workspace/build";
const role = (n) => (n || "").replace(/\s+agent$/i, "");
const loop = (len, ms, seen = true) => {
  const [n, setN] = useState(reduced() ? len : 0);
  useEffect(() => {
    if (!seen || reduced()) { if (reduced()) setN(len); return; }
    const t = setInterval(() => setN((x) => (x >= len + 3 ? 0 : x + 1)), ms);
    return () => clearInterval(t);
  }, [seen]);
  return n;
};

/* ---------- 1. Hero ---------- */
const HERO_TILES = [
  ["ledger", "Accounts"], ["pound", "Invoicing"], ["send", "CRM"], ["inbox", "Helpdesk"],
  ["split", "Projects"], ["clock", "Rota"], ["person", "People"], ["board", "Stock"],
];
const HERO_ACTS = [["pound", "Chased INV-1047", "Credit control · paid Friday"], ["inbox", "Drafted a reply to Salford Media", "Waiting for your OK"], ["clock", "Rota for week 44 ready", "9 shifts, all covered"]];
function HeroOs() {
  const n = loop(HERO_TILES.length + HERO_ACTS.length, 700);
  const placed = Math.min(n, HERO_TILES.length), acts = Math.max(0, Math.min(HERO_ACTS.length, n - HERO_TILES.length));
  return (
    <div className="hx-os" aria-hidden="true">
      <div className="hx-os-bar"><span className="hx-core" /><b>Brightwork OS</b><span className="hx-os-dot">{acts ? `${acts} done today` : "Building…"}</span></div>
      <div className="hx-os-grid">
        {HERO_TILES.map(([g, t], i) => (
          <div key={t} className={"hx-tile" + (i < placed ? " is-in" : "")}><Glyph name={g} size={18} /><span>{t}</span></div>
        ))}
      </div>
      <div className="hx-os-acts">
        {HERO_ACTS.slice(0, acts).map(([g, t, s]) => (
          <div className="hx-act" key={t}><Tile name={g} color="var(--data)" /><div><b>{t}</b><span>{s}</span></div></div>
        ))}
      </div>
    </div>
  );
}
function Hero() {
  return (
    <section className="hx hx-v2" aria-labelledby="hx-h">
      <div className="wrap hx2">
        <div className="hx2-copy">
          <p className="hx-pill">For UK businesses of 1 to 100 people</p>
          <h1 id="hx-h">The all-in-one business operating system, powered by an agentic future.</h1>
          <p className="hx-sub">Drag together the apps your business runs on, from sales and invoicing to projects and the rota, all on one database. Your AI Team does the manual work. Approve it from your phone, or let it run on its own.</p>
          <div className="actions">
            <Link to={BUILD} className="btn btn-lg btn-light">Build your OS<span className="btn-note">free for 14 days</span></Link>
            <Link to="/workspace" className="link">Watch it work</Link>
          </div>
        </div>
        <HeroOs />
      </div>
      <div className="wrap"><ul className="hx-proof">
        <li>One price for the whole business, from £{PLANS.starter.price} a month</li>
        <li>Nothing goes out without your OK until you say so</li>
        <li>Your data, one database, yours to export</li>
      </ul></div>
    </section>
  );
}

/* ---------- 2. Build it your way ---------- */
const LIB = [["Finance", ["Ledger", "Invoicing", "VAT", "Expenses"]], ["Sales", ["CRM", "Quotes", "Shop till"]], ["People and payroll", ["People", "Payroll", "Rota"]], ["Supply chain", ["Inventory", "Purchasing"]]];
const MINE = [
  ["ledger", "Accounting", "Ledger, bank reconciliation, VAT", "here", "Run it here"],
  ["pay", "Payroll", "Outsourced to my bureau", "outsourced", "Outsourced"],
  ["board", "Inventory", "Not used", "off", "Off"],
];
function BuilderMock() {
  const [ref, seen] = useInView({ threshold: 0.3 });
  const n = loop(MINE.length, 1100, seen);
  return (
    <div className="lb" ref={ref} aria-hidden="true">
      <div className="lb-lib">
        <p className="lb-h">Library</p>
        <span className="lb-search">Search 133 apps</span>
        {LIB.map(([c, apps]) => (
          <div key={c} className="lb-cat"><b>{c}</b>{apps.map((a) => <span key={a} className="lb-chip">{a}</span>)}</div>
        ))}
      </div>
      <div className="lb-mine">
        <p className="lb-h">Your OS</p>
        {MINE.map(([g, t, d, m, label], i) => (
          <div key={t} className={"lb-app lb-" + m + (i < n ? " is-in" : "")}>
            <Tile name={g} color={m === "here" ? "var(--data)" : undefined} />
            <div><b>{t}</b><span>{d}</span></div>
            <i className="lb-mode">{label}</i>
          </div>
        ))}
        <p className="lb-foot"><span>14 apps</span><span>1 outsourced</span><span>Team plan</span></p>
      </div>
    </div>
  );
}
const TOOLS_NOW = ["CRM", "Helpdesk", "Accounts", "Team chat", "Task board", "Rota", "Spreadsheets", "Quotes"];
function Build() {
  return (
    <section className="band lp-build" id="build" aria-labelledby="lp-build-h">
      <div className="wrap split">
        <Reveal>
          <p className="label">Build it your way</p>
          <h2 id="lp-build-h">Build the OS your business actually runs on.</h2>
          <p className="body-l">Choose from every area of the business. Go deep where you rely on it, keep it light where you outsource, and leave out what you don't need. Drag it together in minutes.</p>
          <p className="lp-note">Every app you add shares one database, so every app and every member of your AI Team sees the whole business.</p>
          <div className="lp-strike" aria-label="The eight tools you pay for now, in one place">
            {TOOLS_NOW.map((t) => <s key={t}>{t}</s>)}
            <span>The eight tools you pay for now, in one place.</span>
          </div>
        </Reveal>
        <Reveal delay={100}><BuilderMock /></Reveal>
      </div>
    </section>
  );
}

/* ---------- 3. Your AI Team runs it ---------- */
function MiniPaid() {
  const h = [96, 84, 80, 61, 52, 50, 46, 40, 32, 22, 18, 12];
  return (
    <div className="mini">
      <div className="mini-h"><span>Overdue, falling</span><span className="st st-done">3 paid this week</span></div>
      <p className="mini-big">£2,336</p>
      <div className="mini-bars">{h.map((v, i) => <i key={i} style={{ height: v + "%", animationDelay: i * 50 + "ms" }} />)}</div>
    </div>
  );
}
function MiniEnquiry() {
  return (
    <div className="mini">
      <div className="mini-h"><span>Helpdesk</span><span className="st st-waiting">Urgent</span></div>
      <p className="lp-q">Could you quote for a nightly clean, three floors at MediaCity?</p>
      <p className="lp-a"><b>Draft reply</b>Two questions to price it, and a visit this week. In your voice, from your address.</p>
    </div>
  );
}
function MiniLeads() {
  const rows = [["Peel Street Accountants", "Email drafted", "waiting"], ["Castlefield Dental Care", "Replied", "done"], ["Ancoats Architects", "Won", "done"]];
  return (
    <div className="mini">
      <div className="mini-h"><span>New customers</span><span className="dt">8 this week</span></div>
      {rows.map(([c, s, k]) => <div className="mini-row" key={c}><b>{c}</b><span className={"st st-" + k}>{s}</span></div>)}
    </div>
  );
}
function MiniWatch() {
  const rows = [["Ellacombe Print", "Administrators appointed", "Critical"], ["Tarnbrook Logistics", "Accounts overdue", "Review"], ["Calder Joinery", "No changes", null]];
  return (
    <div className="mini">
      <div className="mini-h"><span>Customers and suppliers</span><span className="dt">64 watched</span></div>
      {rows.map(([c, f, s]) => <div className="mini-row" key={c}><div><b>{c}</b><span>{f}</span></div>{s ? <span className={"sev " + (s === "Critical" ? "sev-crit" : "sev-rev")}>{s}</span> : <span className="chip-ok">Clear</span>}</div>)}
    </div>
  );
}
const JOBS = [
  ["Gets you paid", "Chases every unpaid invoice until it's paid.", MiniPaid],
  ["Answers every enquiry", "Sorts the inbox and drafts the reply in your voice.", MiniEnquiry],
  ["Finds new customers", "Researches companies that fit and writes the first email.", MiniLeads],
  ["Watches who you deal with", "Warns you before a customer or supplier goes under.", MiniWatch],
];
const DIAL = [
  ["suggest", "Suggest", "You do it, it helps", "Notes, checklists and answers. Nothing drafted, nothing sent."],
  ["approve", "Approve", "It drafts, you tap yes", "Every email and change waits on your desk and your phone."],
  ["auto", "Run on its own", "It acts, you get a daily summary", "Inside the guardrails: it never moves money, deletes, or writes to a new address."],
];
function Dial() {
  const [v, setV] = useState("approve");
  const d = DIAL.find((x) => x[0] === v);
  return (
    <div className="lp-dial">
      <p className="lb-h">Set per area · Credit control</p>
      <div className="lp-dial-track" role="radiogroup" aria-label="How much the AI Team does on its own">
        {DIAL.map(([k, t, s]) => (
          <button key={k} role="radio" aria-checked={v === k} className={"lp-stop" + (v === k ? " is-on" : "")} onClick={() => setV(k)}><b>{t}</b><span>{s}</span></button>
        ))}
      </div>
      <p className="lp-dial-d">{d[3]}</p>
    </div>
  );
}
function Phone() {
  return (
    <div className="lp-phone" aria-hidden="true">
      <div className="lp-phone-in">
        <div className="lp-ph-top"><span className="hx-core" /><div><b>2 need you</b><span>Everything else is running</span></div></div>
        <span className="lp-brief"><Glyph name="bell" size={14} />Brief me</span>
        {[["Reminder for INV-1047", "Credit control"], ["Reply to Salford Media", "Helpdesk"]].map(([t, a]) => (
          <div className="lp-ph-card" key={t}><div><b>{t}</b><span>{a}</span></div><span className="mini-btn">Approve</span></div>
        ))}
        <div className="lp-ph-talk">Hold to talk</div>
      </div>
    </div>
  );
}
function Team() {
  return (
    <section className="band band-stone lp-team" aria-labelledby="lp-team-h">
      <div className="wrap">
        <Reveal className="lp-head">
          <p className="label">Your AI Team</p>
          <h2 id="lp-team-h">Then your AI Team runs it.</h2>
          <p className="body-l">Other all-in-one software stores your work. Your AI Team does it, across every app you added.</p>
        </Reveal>
        <div className="lp-jobs">
          {JOBS.map(([t, d, Vis], i) => (
            <Reveal key={t} delay={(i % 4) * 70} className="lp-job"><div className="lp-job-vis"><Vis /></div><h3>{t}</h3><p>{d}</p></Reveal>
          ))}
        </div>
        <div className="lp-control">
          <Dial />
          <div className="lp-control-r"><Phone /><p>Run the business from your phone, or hand it over completely.</p></div>
        </div>
      </div>
    </section>
  );
}

/* ---------- 4. Every area, one place ---------- */
const BARS = { full: 3, partial: 2, basic: 1 };
const DEPTH_WORD = { full: "Full", partial: "Partly built", basic: "Records and AI Team" };
function Meter({ d }) {
  return <i className="lp-meter" title={DEPTH_WORD[d]} aria-label={DEPTH_WORD[d]}>{[1, 2, 3].map((n) => <u key={n} className={n <= BARS[d] ? "on" : ""} />)}</i>;
}
function Areas() {
  return (
    <section className="band" id="areas" aria-labelledby="lp-areas-h">
      <div className="wrap">
        <Reveal className="lp-head lp-head-row">
          <div><p className="label">Every area, one place</p><h2 id="lp-areas-h">{BUILDER_APPS.length} apps in ten areas.</h2></div>
          <p className="lp-legend"><span><Meter d="full" />Full</span><span><Meter d="partial" />Partly built</span><span><Meter d="basic" />Records and AI Team</span></p>
        </Reveal>
        <div className="lp-cats">
          {CATEGORIES.map((c) => {
            const apps = BUILDER_APPS.filter((f) => c.areas.includes(f.area)).sort((a, b) => BARS[b.depth] - BARS[a.depth]);
            return (
              <div key={c.key} className="lp-cat">
                <p className="lp-cat-h"><Tile name={c.glyph} /><b>{c.name}</b></p>
                <ul>{apps.slice(0, 6).map((f) => <li key={f.key}><span>{f.app}</span><Meter d={f.depth} /></li>)}</ul>
                {apps.length > 6 && <Link to={"/os?a=" + c.areas[0]} className="lp-more">+{apps.length - 6} more</Link>}
              </div>
            );
          })}
        </div>
        <p className="more"><Link to="/os" className="link">See every app and how far each one is built</Link></p>
      </div>
    </section>
  );
}

/* ---------- 5. Made for your industry ---------- */
const INDUSTRIES = PACKS.filter((p) => p.key !== "blank");
const SHORT = { trades: "Trades", clinics: "Clinics", agencies: "Agencies", accountants: "Accountants", retail: "Retail", hospitality: "Hospitality", "it-services": "IT services" };
function Industries() {
  const [k, setK] = useState("trades");
  const p = INDUSTRIES.find((x) => x.key === k);
  const on = p.here.map((x) => FACETS.find((f) => f.key === x)).filter(Boolean);
  const out = (p.outsourced || []).map((x) => FACETS.find((f) => f.key === x)).filter(Boolean);
  const team = [...new Set(on.map((f) => role(f.agent)).filter((r) => r && !/assistant|host|router/i.test(r)))].slice(0, 8);
  return (
    <section className="band band-stone" aria-labelledby="lp-ind-h">
      <div className="wrap">
        <Reveal className="lp-head lp-head-row">
          <div><p className="label">Made for your industry</p><h2 id="lp-ind-h">Start from your industry, then change anything.</h2></div>
        </Reveal>
        <div className="lp-tabs" role="tablist" aria-label="Industries">
          {INDUSTRIES.map((x) => <button key={x.key} role="tab" aria-selected={k === x.key} className={k === x.key ? "is-on" : ""} onClick={() => setK(x.key)}>{SHORT[x.key]}</button>)}
        </div>
        <div className="lp-pack" role="tabpanel" key={k}>
          <div><p className="lb-h">{p.name} · switched on</p><div className="lp-chips">{on.map((f) => <span key={f.key}>{f.app}</span>)}</div></div>
          <div className="lp-pack-side">
            <div><p className="lb-h">Outsourced or left out</p><div className="lp-chips lp-chips-off">{out.length ? out.map((f) => <span key={f.key}>{f.app}</span>) : <span>Nothing: run it all here</span>}<span>Everything else: off</span></div></div>
            <div><p className="lb-h">Its AI Team</p><div className="lp-chips lp-chips-team">{team.map((t) => <span key={t}>{t}</span>)}</div></div>
            <Link to={BUILD} className="btn">Start from {SHORT[k]}</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- 6. You stay in control ---------- */
const CONTROL = [
  ["check", "Nothing sends until you allow it", "Approve every email, or let one area run on its own when you're ready."],
  ["standards", "House rules", "Rules you write once that every member of the AI Team follows."],
  ["search", "Every step recorded", "Open anything it did to see each step, and why."],
  ["ledger", "Your data, one database", "Export every app to CSV or Excel at any time."],
];
function Control() {
  return (
    <section className="band lp-ctl" aria-label="You stay in control">
      <div className="wrap">
        <ul className="lp-ctl-list">
          {CONTROL.map(([g, t, d]) => <li key={t}><Tile name={g} /><b>{t}</b><span>{d}</span></li>)}
        </ul>
      </div>
    </section>
  );
}

/* ---------- 7. Pricing and questions ---------- */
const FAQ = [
  ["Do I have to move everything at once?", "No. Start with the area that hurts most and add the rest when you're ready."],
  ["What if the AI Team gets something wrong?", "It drafts before it acts until you change that, and every action can be traced and undone where the law allows."],
  ["I outsource my payroll. Can I still use it?", "Yes. Mark payroll as outsourced and your AI Team prepares what your bureau needs each month, as a draft for you to send."],
  ["Where is my data?", "In one database for your business, never used to train AI models, and exportable at any time."],
  ["Can my accountant use it?", "Yes, with an adviser login."],
  ["Does it file my VAT or run payroll with HMRC?", "Not yet. It prepares the VAT return and the payroll for a person to check and submit. We'll say clearly when filing is built."],
];
function Pricing() {
  return (
    <section className="band" id="pricing" aria-labelledby="lp-price-h">
      <div className="wrap">
        <Reveal className="lp-head lp-head-row">
          <div><p className="label">Pricing</p><h2 id="lp-price-h">One price for the whole business.</h2></div>
          <p className="body-l lp-price-l">{PRICING_SUB}</p>
        </Reveal>
        <div className="plans lp-plans">
          {["starter", "growth", "scale"].map((k) => {
            const p = PLANS[k];
            return (
              <article key={k} className={"plan" + (k === "growth" ? " is-pick" : "")}>
                <p className="plan-n">{p.name}{k === "growth" && <span className="st st-done">Most chosen</span>}</p>
                <p className="plan-p"><b>£{p.price}</b><span>a month</span></p>
                <p className="dt">{p.blurb}</p>
                <ul className="ticks"><li>Every app</li><li>{p.credits.toLocaleString("en-GB")} credits a month</li><li>Unlimited people</li></ul>
                <Link to={BUILD} className={"btn btn-sm btn-block" + (k === "growth" ? "" : " btn-line")}>Build your OS free</Link>
              </article>
            );
          })}
        </div>
        <p className="source">{PRICING_FOOT}</p>
        <Minds head={<Reveal className="lp-head mt-l"><div><p className="label">Modes</p><h2>Choose the right mind for the job.</h2></div><p className="body-l lp-price-l">Every task can run in any mode. We suggest one for each job, and you can always choose another.</p></Reveal>} />
        <h3 className="lp-faq-h">Questions</h3>
        <QA items={[...PRICING_FAQ, ...FAQ]} />
      </div>
    </section>
  );
}

/* ---------- 8. Close ---------- */
function Close() {
  return (
    <>
      <section className="lp-close">
        <div className="wrap">
          <h2>Build your OS.</h2>
          <p>Pick your industry, drag in the apps you run on, and set how much your AI Team does. Free for 14 days.</p>
          <div className="actions"><Link to={BUILD} className="btn btn-lg btn-light">Build your OS</Link><Link to="/book-a-call" className="link">Book a 20-minute call</Link></div>
        </div>
      </section>
      <section className="lp-dev">
        <div className="wrap"><p><b>Building agents or tools?</b> Developers and AI agents use the same apps through our API.</p><span><Link to="/developers" className="link">For developers</Link><Link to="/for-agents" className="link">For agents</Link></span></div>
      </section>
    </>
  );
}

export default function Home() {
  return (
    <Page title="The all-in-one business operating system">
      <Hero />
      <Build />
      <Team />
      <Areas />
      <Industries />
      <Control />
      <Pricing />
      <Close />
    </Page>
  );
}

/* The org chart mini-UI, shown on How it works. */
const TREE = [
  { n: "Prospector", r: "Prospector", b: [["Prospecting", "skill"], ["Weekdays", "rhythm"]], t: ["Find law firms in M2", "doing"] },
  { n: "Outreach", r: "Writer", b: [["Email", "skill"], ["Ask me", "autonomy"]], t: ["Email Ashworth Hale", "you"] },
  { n: "Credit control", r: "Credit controller", b: [["Cash", "skill"], ["After the first", "autonomy"]], t: ["Chase INV-1047", "done"] },
];
const TASK = { doing: "Doing", you: "Needs you", done: "Done" };
export function MiniOrg({ big }) {
  return (
    <div className={"otree" + (big ? " otree-big" : "")} aria-hidden="true">
      <div className="otree-root">
        <b>Orchestrator</b>
        <span className="otree-badges"><i className="ob ob-role">Orchestrator</i><i className="ob ob-skill">Planning</i></span>
        <span className="otree-goal">Goal: five law firms talking by December</span>
      </div>
      <div className="otree-kids">
        {TREE.map((a) => (
          <div className="otree-kid" key={a.n}>
            <div className="otree-card">
              <b>{a.n}</b><span className="dt">{a.r}</span>
              <span className="otree-badges">{a.b.map(([l, k]) => <i key={l} className={"ob ob-" + k}>{l}</i>)}</span>
            </div>
            <div className={"otree-task ot-" + a.t[1]}><i />{a.t[0]}<span>{TASK[a.t[1]]}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
