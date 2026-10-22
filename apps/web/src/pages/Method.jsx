import React, { useState } from "react";
import { Link } from "../router.jsx";
import { Page, PageHead, Section, SectionHead, SpecTable, NextPrev, CtaBand, MethodSteps } from "../ui.jsx";
import { MiniOrg } from "./Home.jsx";
import { ROLES, SKILLS, AUTONOMY, RHYTHMS } from "../../../../packages/core/badges.ts";
import { PRIMITIVES } from "../../../../packages/core/usecases.ts";

const PLAN = [
  ["Describe your business", 0, 0, "You", "Two minutes, typed or spoken: what you do, who you serve, where, and how you write"],
  ["Spin up the team", 0, 0, "You", "Start from the team for your kind of business, or one designed from your description. You see the cost first"],
  ["Forward your enquiries inbox", 0, 1, "You", "One forwarding rule so the inbox role sees new messages"],
  ["The orchestrator sets the first tasks", 1, 1, "Agents", "It reads your goals and the team, and hands each role its first piece of work"],
  ["Approve the first drafts", 1, 2, "You", "Edit, send or reject. Approve the first and follow-ups can go on their own if you choose"],
  ["Upload invoices and customers", 2, 3, "You", "A CSV or .xlsx from your accounts software, for credit control and the customer watch"],
  ["Weekly briefing", 7, 7, "Agents", "Monday morning: what the team did, what's blocked, and what needs you"],
];

function Gantt() {
  const [sel, setSel] = useState(0);
  const days = [0, 1, 2, 3, 4, 5, 6, 7];
  const cur = PLAN[sel];
  return (
    <figure className="vis">
      <div className="vis-head"><span className="vis-title">Days 0 to 7</span><span className="vis-sub">Select a row for detail</span></div>
      <div className="gantt" role="table" aria-label="Your first week by day">
        <div className="g-row g-head" role="row">
          <span className="g-name" role="columnheader">Step</span>
          {days.map((d) => <span key={d} className="g-day" role="columnheader">Day {d}</span>)}
        </div>
        {PLAN.map(([name, a, b, who], i) => (
          <button key={name} className={"g-row" + (i === sel ? " is-sel" : "")} role="row" onClick={() => setSel(i)} aria-pressed={i === sel}>
            <span className="g-name" role="cell">{name}<span className="dt">{who}</span></span>
            {days.map((d) => (
              <span key={d} className="g-cell" role="cell">
                {d >= a && d <= b && <i className={"g-bar" + (who === "You" ? " g-you" : "")} />}
              </span>
            ))}
          </button>
        ))}
      </div>
      <div className="tl-detail">
        <div><span className="dt">Step</span><span>{cur[0]}</span></div>
        <div><span className="dt">When</span><span>{cur[1] === cur[2] ? "Day " + cur[1] : `Days ${cur[1]} to ${cur[2]}`}</span></div>
        <div><span className="dt">Who</span><span>{cur[3]}</span></div>
        <div className="wide"><span className="dt">What happens</span><span>{cur[4]}</span></div>
      </div>
      <figcaption>Black bars are your agents at work; outlined bars are the short tasks that need you.</figcaption>
    </figure>
  );
}

function Lifecycle() {
  const steps = [
    ["A goal", "Yours, typed or spoken: \"five law firms talking by December\"."],
    ["Assigned", "The orchestrator turns it into tasks for the roles that fit."],
    ["Worked", "Each role runs with its own skills, at most eight turns a run."],
    ["Drafted", "An email, a lead, a reminder, an answer, or a task for you."],
    ["You decide", "Approve, edit or reject. Everything is recorded."],
  ];
  return (
    <figure className="vis">
      <div className="vis-head"><span className="vis-title">From a goal to work you approve</span></div>
      <svg viewBox="0 0 760 120" className="flow" role="img" aria-label="Five stages: a goal, assigned, worked, drafted, you decide">
        {steps.map(([t], i) => {
          const x = 8 + i * 150;
          return (
            <g key={t}>
              <rect x={x} y="24" width="128" height="56" rx="12" fill={i === 4 ? "var(--ink)" : "var(--paper)"} stroke="var(--ink)" />
              <text x={x + 12} y="57" className="flow-t" fill={i === 4 ? "var(--paper)" : "var(--ink)"}>{t}</text>
              {i < steps.length - 1 && <line x1={x + 128} x2={x + 150} y1="52" y2="52" stroke="var(--ink)" />}
              {i < steps.length - 1 && <polygon points={`${x + 150},52 ${x + 144},48 ${x + 144},56`} fill="var(--ink)" />}
            </g>
          );
        })}
        <line x1="222" x2="222" y1="80" y2="94" stroke="var(--graphite)" />
        <text x="222" y="110" textAnchor="middle" className="flow-s">Blocked work goes back to whoever assigned it</text>
      </svg>
      <ol className="flow-notes">
        {steps.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}
      </ol>
    </figure>
  );
}

const PICKABLE = ROLES.filter((r) => r.key !== "register");
function Badges() {
  const cols = [
    ["role", "Role", "One each. Sets its standing orders.", PICKABLE.map((r) => [r.label, r.about])],
    ["skill", "Skills", "Any number. Each skill is a set of tools.", SKILLS.map((s) => [s.label, s.about])],
    ["autonomy", "Autonomy", "One each. When its emails send without you.", AUTONOMY.map((a) => [a.label, a.about])],
    ["rhythm", "Rhythm", "One each. When it runs on its own.", RHYTHMS.map((r) => [r.label, ""])],
  ];
  return (
    <div className="badge-cols">
      {cols.map(([k, t, d, items]) => (
        <div key={k} className="badge-col">
          <h3>{t}</h3>
          <p className="dt">{d}</p>
          <ul>{items.map(([l, a]) => <li key={l} title={a}><i className={"ob ob-" + k}>{l}</i>{a && <span>{a}</span>}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

const STATUS = { live: ["Live", "st-done"], partly: ["Partly built", "st-running"], coming: ["Coming", "st-paused"] };

export default function Method() {
  return (
    <Page title="How it works">
      <PageHead crumbs={[["How it works"]]} label="How it works" title="Describe the business. Get a team that reports to you."
        lede="An orchestrator leads, roles do the work, and nothing goes out in your name until you say so. Here is the whole of it, from the first two minutes to the weekly briefing." />
      <Section tight><MethodSteps /></Section>

      <section id="team" className="band band-stone">
        <div className="wrap split">
          <div>
            <p className="label">The team</p>
            <h2>An orchestrator at the top, roles below, tasks under each</h2>
            <p className="body-l">The orchestrator holds your goals. It splits them into tasks, gives each to the role whose skills fit, checks they finish, and brings you anything only you can decide. It never sends an email or approves anything itself.</p>
            <p className="body-l">Roles can lead small teams of their own, up to two levels below the orchestrator. Work that gets stuck goes back to whoever assigned it.</p>
            <div className="actions"><Link to="/floor" className="btn btn-lg">See the org chart</Link></div>
          </div>
          <div className="mini otree-wrap"><MiniOrg big /></div>
        </div>
      </section>

      <Section id="badges">
        <SectionHead label="Badges" title="Shape the team by moving badges" lede="Every agent wears four kinds of badge. Drag one onto an agent to give it, move it to another, or swap two roles. Changes wait in a list until you apply them, and the plan's limits are checked as you go." />
        <Badges />
        <p className="source">Planning is only for the orchestrator and Lead roles. A role brings the skills it needs with it. Changing a ready-made agent's skills makes it a custom role that keeps its name.</p>
      </Section>

      <Section id="skills" stone>
        <SectionHead label="Any business" title="Twelve building blocks under every job" lede="Every job an agent does for a small business is built from the same twelve building blocks, so a plumber, a clinic and a recruiter all get the same tested parts. Here is what each one can do today." more={["Every use case, scored", "/use-cases"]} />
        <div className="prims">
          {PRIMITIVES.map((p) => <div key={p.key} className={"prim prim-" + p.status}><b>{p.label}</b><span>{p.note}</span><i className={"st " + STATUS[p.status][1]}>{STATUS[p.status][0]}</i></div>)}
        </div>
      </Section>

      <Section id="first-week">
        <SectionHead label="Your first week" title="What happens, and what needs you" lede="About twenty minutes of your time in the first week. After that, a few minutes a day on your desk, less as you let routine emails go on their own." />
        <Gantt />
      </Section>

      <Section id="runs" stone>
        <SectionHead label="Under the hood" title="From a goal to work you approve" lede="Each role is a model with standing orders, your profile, and a fixed set of tools. It can only do what its skills allow, and it shows every step." />
        <Lifecycle />
      </Section>

      <Section id="autonomy">
        <SectionHead label="Your say" title="How much each agent does on its own" lede="Every agent starts on Ask me. Move one up when you trust its work; the address rules hold at every level." />
        <SpecTable head={["Autonomy", "What sends without you", "Good for"]} rows={[
          ["Ask me", "Nothing. Every email waits on your desk", "New agents, first contact with anyone"],
          ["After the first", "Follow-ups to someone you've already approved an email to, and second reminders on an invoice", "Outreach follow-ups, credit control"],
          ["Auto", "Emails to the lead, customer or sender the record is about", "Routine replies and reminders you no longer read"],
          ["Never, at any level", "Email to an address that isn't already on the record, payments, deleting records, approving its own work", "Always yours"],
        ]} />
      </Section>

      <Section id="tools" stone>
        <SectionHead label="Tools" title="What the skills use" lede="The same catalogue developers and other agents use, with the same signed answers." more={["See the catalogue", "/for-agents?s=catalogue"]} />
        <SpecTable head={["Tool", "What it does", "Skill"]} rows={[
          ["find-companies", "Finds active companies by area, trade and age", "Prospecting"],
          ["company-research", "The register check plus the top web results about a company", "Prospecting, Research"],
          ["read-page", "Reads one public page and the contact addresses published on it", "Prospecting, Research"],
          ["uk-check", "Resolves, profiles and flags a UK company, signed", "Registers"],
          ["propose-email", "Drafts an email; sends only as your autonomy setting allows", "Email"],
          ["list-invoices", "What's overdue and what's been chased", "Cash"],
          ["assign-task, check-tasks", "Gives a role a task and follows it up", "Planning"],
          ["hand-off", "Passes a card to the next role, with a note", "Every role in a team"],
        ]} />
      </Section>
      <NextPrev prev={["Use cases", "/use-cases"]} next={["Trust", "/trust"]} />
      <CtaBand />
    </Page>
  );
}
