// /workspace/start: first run. Describe the business, connect tools (mocked), review the team and how much each
// agent may do, learn about watch mode, then land on a day-one Home.
import React, { useEffect, useState } from "react";
import { navigate } from "../../router.jsx";
import { Icon, clearToasts, useStore } from "../core.jsx";
import { Avatar, Button, SegmentedControl, StatusChip } from "../ui.jsx";
import { startDayOne } from "../demo/store";
import { useVoice, voiceSupported } from "../../voice.js";

/*
 * Connectors are mocked in the demo. In a real workspace each "Connect" opens the provider's OAuth consent screen
 * (Google or Microsoft for email and calendar, Xero or QuickBooks for accounts, an Open Banking provider for the
 * bank feed) and the API stores the token; the agents then read and write through that connection.
 */
const CONNECTORS = [
  { key: "email", name: "Email", icon: "Mail", options: ["Gmail", "Outlook"], what: "Theo reads enquiries and drafts replies from your address." },
  { key: "accounts", name: "Accounts", icon: "BookOpen", options: ["Xero", "QuickBooks"], what: "Fern and Rosa see invoices, bills and who owes you." },
  { key: "calendar", name: "Calendar", icon: "Calendar", options: ["Google Calendar", "Outlook"], what: "Owen books site visits around your diary." },
  { key: "bank", name: "Bank", icon: "Landmark", options: ["Open Banking"], what: "Fern matches payments and keeps your cash forecast current." },
];
const LEVELS = [["watch", "Watch"], ["ask", "Ask first"], ["limits", "Act within limits"]];
const WHY = {
  agt_sales: [null, "Finds companies that fit, writes the first email and follows up quotes."],
  agt_cs: [null, "Reads every enquiry, by email or phone, and drafts the reply."],
  agt_credit: [null, "Chases every invoice until it's paid: polite first, firmer later."],
  agt_ops: [null, "Keeps jobs, the rota and supplies straight."],
  agt_fin: [null, "Raises invoices, records bills and keeps an eye on the cash."],
  agt_brief: [null, "Writes your weekly briefing and keeps everyone in the loop."],
};

export function Start() {
  const s = useStore();
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState("");
  const [owner, setOwner] = useState("");
  const [desc, setDesc] = useState("");
  const [conn, setConn] = useState({});
  const [busy, setBusy] = useState(null);
  const [auto, setAuto] = useState(() => Object.fromEntries(s.agents.map((a) => [a.id, a.id === "agt_brief" ? "limits" : "ask"])));
  const [err, setErr] = useState("");
  const voice = useVoice({ serverVoice: false, onText: (t) => setDesc((d) => (d ? d + " " : "") + t), onError: setErr });
  useEffect(() => { document.title = "Start your workspace | Agent House"; window.scrollTo(0, 0); }, [step]);
  const steps = ["Your business", "Connect tools", "Your team", "Watch mode"];

  const next0 = (e) => { e.preventDefault(); if (desc.trim().length < 10) { setErr("Tell us a sentence or two: what you do, who you sell to, and what eats your time."); return; } setErr(""); setStep(1); };
  const connect = (key, tool) => { setBusy(key); setTimeout(() => { setConn((c) => ({ ...c, [key]: tool })); setBusy(null); }, 900); };
  const finish = () => {
    clearToasts();
    startDayOne({ business, owner, description: desc, tools: Object.keys(conn).filter((k) => conn[k] && conn[k] !== "skip"), autonomy: auto });
    navigate("/workspace?welcome=1");
  };

  return (
    <div className="w-start">
      <ol className="w-steps" aria-label="Steps">
        {steps.map((t, i) => <li key={t} className={i === step ? "is-on" : i < step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}><b>{i < step ? <Icon name="Check" size={14} /> : i + 1}</b>{t}</li>)}
      </ol>

      {step === 0 && (
        <form onSubmit={next0} className="w-stack" noValidate>
          <h1 className="w-greet">Describe your business. We'll staff it with agents.</h1>
          <p className="w-outcome">Say what you do, who you sell to and what eats your time. You'll see the agents before anything starts.</p>
          <div className="w-grid w-grid-2" style={{ marginTop: 16 }}>
            <div className="w-field"><label htmlFor="st-b">Business name</label><input id="st-b" className="w-input" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="For example, Northside Plumbing" autoComplete="organization" /></div>
            <div className="w-field"><label htmlFor="st-o">Your name</label><input id="st-o" className="w-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="For example, Sam Patel" autoComplete="name" /></div>
          </div>
          <div className="w-field">
            <label htmlFor="st-d">What you do</label>
            <textarea id="st-d" className="w-input" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="We're a 6-person accountancy in Stockport. We need more small-business clients, and we chase late payers by hand." aria-describedby={err ? "st-err" : undefined} />
          </div>
          {err && <p id="st-err" role="alert" style={{ color: "var(--status-risk)" }}>{err}</p>}
          <div className="w-row">
            {voiceSupported() && <Button icon="Mic" variant={voice.state === "listening" ? "primary" : undefined} onClick={voice.toggle}>{voice.state === "listening" ? "Listening… tap to stop" : "Say it instead"}</Button>}
            <span className="w-sp" style={{ flex: 1 }} />
            <Button type="submit" variant="primary" size="lg" icon="ArrowRight">Design my team</Button>
          </div>
        </form>
      )}

      {step === 1 && (
        <div className="w-stack">
          <h1 className="w-greet">Connect your tools</h1>
          <p className="w-outcome">Your agents work inside the tools you already use. You can skip any of these and connect later in Setup.</p>
          <div style={{ marginTop: 16 }}>
            {CONNECTORS.map((c) => (
              <div key={c.key} className="w-conn">
                <span className="w-leak-i attn" style={{ background: "var(--status-agent-bg)", color: "var(--status-agent)" }}><Icon name={c.icon} size={18} /></span>
                <div><b>{c.name}</b><p className="w-sub">{c.what}</p></div>
                {conn[c.key] && conn[c.key] !== "skip" ? <StatusChip tone="done">Connected to {conn[c.key]}</StatusChip>
                  : conn[c.key] === "skip" ? <Button size="sm" variant="ghost" onClick={() => setConn({ ...conn, [c.key]: undefined })}>Skipped · undo</Button>
                  : busy === c.key ? <span className="w-sub">Connecting…</span>
                  : <div className="w-row" style={{ gap: 6 }}>{c.options.map((o) => <Button key={o} size="sm" onClick={() => connect(c.key, o)}>{o}</Button>)}<Button size="sm" variant="ghost" onClick={() => setConn({ ...conn, [c.key]: "skip" })}>Skip for now</Button></div>}
              </div>
            ))}
          </div>
          <div className="w-row"><Button variant="ghost" icon="ChevronLeft" onClick={() => setStep(0)}>Back</Button><span style={{ flex: 1 }} /><Button variant="primary" size="lg" icon="ArrowRight" onClick={() => setStep(2)}>Next: your team</Button></div>
        </div>
      )}

      {step === 2 && (
        <div className="w-stack">
          <h1 className="w-greet">Your team</h1>
          <p className="w-outcome">Six agents, each with a job. Choose how much each may do on its own. You can change this at any time on the agent's page.</p>
          <div className="w-stack" style={{ marginTop: 16 }}>
            {s.agents.map((a) => (
              <div key={a.id} className="w-conn" style={{ flexWrap: "wrap" }}>
                <Avatar actor={{ kind: "agent", id: a.id }} size="lg" />
                <div style={{ minWidth: 200 }}><b>{a.name} · {a.roleName}</b><p className="w-sub">{WHY[a.id][1]}</p></div>
                <SegmentedControl label={`How much ${a.name} may do`} value={auto[a.id]} onChange={(v) => setAuto({ ...auto, [a.id]: v })} options={LEVELS} />
              </div>
            ))}
          </div>
          <p className="w-sub">Watch: shows you what it would do. Ask first: drafts, and waits for your OK. Act within limits: does routine things under £500 on its own and tells you after.</p>
          <div className="w-row"><Button variant="ghost" icon="ChevronLeft" onClick={() => setStep(1)}>Back</Button><span style={{ flex: 1 }} /><Button variant="primary" size="lg" icon="ArrowRight" onClick={() => setStep(3)}>Next</Button></div>
        </div>
      )}

      {step === 3 && (
        <div className="w-stack">
          <h1 className="w-greet">For 48 hours, your team will show you what it <em>would</em> have done.</h1>
          <p className="w-outcome">Nothing is sent, paid or booked in watch mode. Every draft lands on Home. Approve the ones you like and reject the rest, and the team learns how you work. After 48 hours, each agent switches to the level you chose.</p>
          <ul className="w-stack" style={{ marginTop: 16 }}>
            {[["Eye", "You see every draft before anything happens."], ["Undo2", "Every action can be undone for 30 seconds afterwards."], ["Pause", "Pause agents is always in the top bar."]].map(([i, t]) => <li key={t} className="w-row"><Icon name={i} size={18} />{t}</li>)}
          </ul>
          <div className="w-row"><Button variant="ghost" icon="ChevronLeft" onClick={() => setStep(2)}>Back</Button><span style={{ flex: 1 }} /><Button variant="primary" size="lg" icon="Check" onClick={finish}>Open my workspace</Button></div>
          <p className="w-sub">This is a demo: your workspace lives in this browser only. Reset demo in the avatar menu brings back Brightwork Cleaning.</p>
        </div>
      )}
    </div>
  );
}
