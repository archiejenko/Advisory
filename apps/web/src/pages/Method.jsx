import React, { useState } from "react";
import { Link } from "../router.jsx";
import { Page, PageHead, Section, SectionHead, SpecTable, NextPrev, CtaBand, MethodSteps } from "../ui.jsx";

const PLAN = [
  ["Sign up and fill in your profile", 0, 0, "You", "Two minutes: what you do, who you serve, where, and how you write"],
  ["Hire your first agents", 0, 0, "You", "Pick from the catalogue; each starts from a brief written from your profile"],
  ["Forward your enquiries inbox", 0, 1, "You", "One forwarding rule so the inbox agent sees new messages"],
  ["First runs", 1, 1, "Agents", "Scheduled agents run at their set time; you can run any of them now"],
  ["Approve the first drafts", 1, 2, "You", "Edit, send or reject. Approve the first and follow-ups can go on their own"],
  ["Upload invoices and customers", 2, 3, "You", "A CSV from your accounts software for credit control and the customer watch"],
  ["Weekly briefing", 7, 7, "Agents", "Monday morning: what your agents did and what needs you"],
];

function Gantt() {
  const [sel, setSel] = useState(0);
  const days = [0, 1, 2, 3, 4, 5, 6, 7];
  const cur = PLAN[sel];
  return (
    <figure className="vis">
      <div className="vis-head"><span className="vis-title">Days 0 to 7</span><span className="vis-sub">Select a row for detail</span></div>
      <div className="gantt" role="table" aria-label="Onboarding plan by day">
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
    ["Woken", "On its schedule, by a new message, or by you."],
    ["Reads", "Your profile and its brief, then the data it needs."],
    ["Uses tools", "Register, web and page tools from the catalogue."],
    ["Drafts", "An email, a lead, a task or an answer."],
    ["You decide", "Approve, edit or reject. Everything is recorded."],
  ];
  return (
    <figure className="vis">
      <div className="vis-head"><span className="vis-title">The life of an agent run</span></div>
      <svg viewBox="0 0 760 120" className="flow" role="img" aria-label="Five stages: woken, reads, uses tools, drafts, you decide">
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
        <line x1="372" x2="372" y1="80" y2="94" stroke="var(--graphite)" />
        <text x="372" y="110" textAnchor="middle" className="flow-s">At most eight turns a run</text>
      </svg>
      <ol className="flow-notes">
        {steps.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}
      </ol>
    </figure>
  );
}

export default function Method() {
  return (
    <Page title="How it works">
      <PageHead crumbs={[["How it works"]]} label="How it works" title="From sign-up to a working team in a day" lede="You describe your business once. Agents take it from there, using real tools, and bring you their work to approve." />
      <Section tight><MethodSteps /></Section>
      <Section id="first-week" stone>
        <SectionHead label="Your first week" title="What happens, and what needs you" lede="About twenty minutes of your time in the first week. After that, a few minutes a day approving drafts, if you choose to." />
        <Gantt />
      </Section>
      <Section id="runs">
        <SectionHead label="Under the hood" title="What an agent does when it runs" lede="Each agent is a model with standing orders, your profile, and a fixed set of tools. It can only do what its tools allow." />
        <Lifecycle />
      </Section>
      <Section id="tools" stone>
        <SectionHead label="Tools" title="What agents can use" lede="The same catalogue developers and other agents use, with the same signed answers." more={["See the catalogue", "/for-agents?s=catalogue"]} />
        <SpecTable head={["Tool", "What it does", "Source"]} rows={[
          ["find-companies", "Finds active companies by area, trade and age", "Companies House"],
          ["company-research", "The register check plus the top web results about a company", "Companies House, web search"],
          ["read-page", "Reads one public web page and the contact addresses published on it", "The page itself"],
          ["web-research", "Searches the web for a question", "Web search"],
          ["uk-check", "Resolves, profiles and flags a company", "Companies House, The Gazette, FCA register"],
          ["propose-email", "Drafts an email for your approval; never sends on its own unless you allow it", "Your workspace"],
        ]} />
      </Section>
      <NextPrev prev={["Agents", "/agents"]} next={["Trust", "/trust"]} />
      <CtaBand />
    </Page>
  );
}
