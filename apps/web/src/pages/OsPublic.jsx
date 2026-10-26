// /os: a read-only explainer of the Business OS. The four hubs and their apps, what each does, which agent runs it and
// who on the team uses it, and the money loop from lead to paid. The same catalogue the demo workspace runs on.
import React, { useEffect } from "react";
import { Link } from "../router.jsx";
import { Icon } from "../workspace/core.jsx";
import { APPS, HUBS } from "../workspace/demo/catalogue";
import { getState } from "../workspace/demo/store";

const LOOP = [
  ["Lead", "Maya finds companies that fit", "Target"], ["Quote", "Maya prices it from your rates", "FileText"], ["Job", "Owen books it and the crew", "SprayCan"],
  ["Invoice", "Fern raises it when the work's done", "ReceiptText"], ["Chase", "Rosa reminds, politely then firmly", "HandCoins"], ["Paid", "Fern matches the payment", "CircleCheck"],
];

export function OsPage() {
  const agents = getState().agents;
  const who = (id) => agents.find((a) => a.id === id);
  useEffect(() => { document.title = "The Business OS | Agent House"; }, []);
  return (
    <div className="wk" style={{ minHeight: "auto" }}>
      <div className="w-content" style={{ paddingTop: 56 }}>
        <p className="w-chip w-chip-agent" style={{ marginBottom: 16 }}>The Business OS</p>
        <h1 className="w-greet" style={{ maxWidth: "18ch" }}>Your agents do the work. You decide, ask and see.</h1>
        <p className="w-outcome">Four hubs hold everything a small business runs on. An agent runs each part and brings you only the decisions. Here's what's inside, using a Manchester cleaning company as the example.</p>
        <div className="w-row" style={{ marginTop: 24 }}>
          <Link to="/workspace" className="w-btn w-btn-primary w-btn-lg">Open the demo</Link>
          <Link to="/workspace/start" className="w-btn w-btn-lg">Start yours</Link>
        </div>

        <section className="w-section" aria-labelledby="os-loop">
          <div className="w-section-h"><h2 id="os-loop">The money loop</h2><span className="w-sub">Every step is a record linked to the last, so nothing falls between the cracks</span></div>
          <ol className="w-flow" aria-label="Lead, quote, job, invoice, chase, paid">
            {LOOP.map(([t, sub, icon], i) => (
              <React.Fragment key={t}>
                <li className="w-flow-step"><span className="w-row" style={{ gap: 8 }}><Icon name={icon} size={18} /><b>{t}</b></span><small>{sub}</small></li>
                {i < LOOP.length - 1 && <li className="w-flow-arrow" aria-hidden="true"><Icon name="ArrowRight" size={18} /></li>}
              </React.Fragment>
            ))}
          </ol>
        </section>

        {HUBS.map((h) => {
          const apps = APPS.filter((a) => a.hub === h.id && a.status !== "soon");
          const soon = APPS.filter((a) => a.hub === h.id && a.status === "soon");
          return (
            <section key={h.id} className="w-section" aria-labelledby={"os-" + h.id}>
              <div className="w-section-h"><Icon name={h.icon} size={22} /><h2 id={"os-" + h.id}>{h.name}</h2><span className="w-sub">{h.purpose}</span></div>
              <div className="w-grid w-grid-3">
                {apps.map((a) => {
                  const ag = a.agentId && who(a.agentId);
                  return (
                    <article key={a.key} className="w-card">
                      <div className="w-row" style={{ gap: 8 }}><Icon name={a.icon} size={18} /><h3 style={{ fontSize: 17 }}>{a.name}</h3></div>
                      <p style={{ marginTop: 8, color: "var(--text-secondary)" }}>{a.blurb}</p>
                      <dl className="w-dl" style={{ marginTop: 12, fontSize: 14 }}>
                        <dt>Run by</dt><dd>{ag ? <span className="w-agent"><span className="w-agent-dot"><Icon name="Bot" size={14} /></span>{ag.name}<span className="w-agent-role"> · {ag.roleName}</span></span> : "People only"}</dd>
                        <dt>Used by</dt><dd>{a.users}</dd>
                      </dl>
                    </article>
                  );
                })}
              </div>
              {soon.length > 0 && <p className="w-sub" style={{ marginTop: 12 }}>Also available soon: {soon.map((a) => a.name).join(", ")}. Until then, keep them in the tools you already use.</p>}
            </section>
          );
        })}

        <section className="w-section w-card" style={{ textAlign: "center", padding: 40 }}>
          <h2 style={{ fontSize: 24 }}>See it running for a real-looking business</h2>
          <p className="w-sub" style={{ margin: "8px 0 20px" }}>Brightwork Cleaning: eight people, six agents, ten decisions waiting. Nothing is sent.</p>
          <Link to="/workspace" className="w-btn w-btn-primary w-btn-lg">Open the demo</Link>
        </section>
      </div>
    </div>
  );
}
