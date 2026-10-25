// Self-serve sign-up for businesses, and the unsubscribe page linked from every outreach email.
import React, { useState } from "react";
import { isPass } from "../pass.js";
import { Link, useRoute, navigate } from "../router.jsx";
import { LIVE, api, useTurnstile } from "../api.js";
import { Page, PageHead, Section } from "../ui.jsx";
import { Glyph } from "../kit.jsx";
import { TEMPLATES, PLANS } from "../../../../packages/core/templates.ts";
import { SECTOR_PACKS } from "../../../../packages/core/usecases.ts";

/** The starting team carries over to the Floor, which designs it from this description after sign-in. */
export const START_KEY = "ah:start-desc";

export function Start() {
  const { query } = useRoute();
  const pick = TEMPLATES.find((t) => t.key === query.agent && t.status === "live");
  const [f, setF] = useState({ business: "", name: "", email: "", what: "", customers: "", area: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [packKey, setPackKey] = useState("");
  const pack = SECTOR_PACKS.find((p) => p.key === packKey);
  const ts = useTurnstile();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const miss = [];
    if (f.business.trim().length < 2) miss.push("your business name");
    if (!/^\S+@\S+\.\S+$/.test(f.email)) miss.push("a valid email");
    if (f.what.trim().length < 5) miss.push("a line about what you do");
    if (miss.length) return setErr("Add " + miss.join(", ") + " to continue.");
    if (!ts.ready) return setErr("Complete the check that you're not a robot.");
    setErr("");
    try { localStorage.setItem(START_KEY, [f.what.trim(), f.customers.trim() && "Customers: " + f.customers.trim(), f.area.trim() && "Area: " + f.area.trim(), pack && "Goal: " + pack.goal].filter(Boolean).join(". ")); } catch {}
    if (!LIVE && isPass()) return navigate("/workspace");
    if (!LIVE) return setDone("Prototype: no workspace was created.");
    setBusy(true);
    try {
      const r = await api("POST", "/api/public/signup", { business: f.business.trim(), email: f.email.trim(), ...(f.name.trim() ? { name: f.name.trim() } : {}), what: f.what.trim(), ...(f.customers.trim() ? { customers: f.customers.trim() } : {}), ...(f.area.trim() ? { area: f.area.trim() } : {}), ...(ts.token ? { turnstile: ts.token } : {}) });
      setDone(r.message);
    } catch (x) { setErr(x.message); ts.reset(); } finally { setBusy(false); }
  };
  return (
    <Page title="Start free">
      <PageHead crumbs={[["Start free"]]} label="Free for 14 days" title={pick ? `Put ${pick.name.toLowerCase()} to work` : "Put your team to work"} lede={`Tell us about your business. We'll set up your workspace and email you a link to sign in. Every app in the OS, up to 100 agents and ${PLANS.trial.actions.toLocaleString("en-GB")} actions, no card needed.`} />
      <Section tight>
        <div className="start">
          {done ? (
            <div className="form" aria-live="polite">
              <span className="tile tile-agent"><Glyph name="send" /></span>
              <h2 className="h-small mt-s">Check your email</h2>
              <p className="body mt-s">{done} The link works once. {pick ? `Once you're in, hire ${pick.name.toLowerCase()} from Agents.` : "Once you're in, open the Floor and we'll design your team from what you told us."}</p>
              <p className="more"><Link to="/workspace" className="link">Look around the demo while you wait</Link></p>
            </div>
          ) : (
            <form className="form" onSubmit={submit} noValidate>
              <h2 className="h-small">About your business</h2>
              <fieldset className="field pack-pick">
                <legend>Your kind of business <span className="muted">(optional)</span></legend>
                <div className="pack-chips">
                  {SECTOR_PACKS.map((p) => <button type="button" key={p.key} className={"seg-btn seg-s" + (p.key === packKey ? " is-on" : "")} aria-pressed={p.key === packKey} onClick={() => setPackKey(p.key === packKey ? "" : p.key)}>{p.name}</button>)}
                </div>
                <p className="hint">{pack ? pack.who : "Any business works. Pick one to see the team we'd start you with."}</p>
              </fieldset>
              <div className="grid-2 g-tight">
                <div className="field"><label htmlFor="s-biz">Business name</label><input id="s-biz" autoComplete="organization" value={f.business} onChange={set("business")} /></div>
                <div className="field"><label htmlFor="s-name">Your name</label><input id="s-name" autoComplete="name" value={f.name} onChange={set("name")} /></div>
              </div>
              <div className="field"><label htmlFor="s-email">Work email</label><input id="s-email" type="email" autoComplete="email" value={f.email} onChange={set("email")} /></div>
              <div className="field"><label htmlFor="s-what">What you do</label><textarea id="s-what" rows={2} value={f.what} onChange={set("what")} placeholder={pack ? `What you do, in a sentence. ${pack.who} all work.` : "Commercial and office cleaning on daily or weekly contracts"} /><p className="hint">One sentence. Your agents use it to introduce you.</p></div>
              <div className="grid-2 g-tight">
                <div className="field"><label htmlFor="s-cust">Who your customers are <span className="muted">(optional)</span></label><input id="s-cust" value={f.customers} onChange={set("customers")} placeholder="Offices and clinics, 10 to 80 staff" /></div>
                <div className="field"><label htmlFor="s-area">Where you work <span className="muted">(optional)</span></label><input id="s-area" value={f.area} onChange={set("area")} placeholder="Manchester and Salford" /></div>
              </div>
              {ts.needed && <div className="field" ref={ts.el} />}
              {err && <p className="form-err" role="alert">{err}</p>}
              <button className="btn btn-block" disabled={busy}>{busy ? "Setting up…" : "Create my workspace"}</button>
              <p className="source">Already have a workspace? <Link to="/sign-in" className="link link-s">Sign in</Link>. By starting you agree that agents act only with your approval until you change that.</p>
            </form>
          )}
          <aside className="start-side">
            {pack && (
              <div className="pack-team" aria-live="polite">
                <p className="label">Your starting team</p>
                <p className="dt">Goal: {pack.goal}</p>
                <ul>
                  <li><b>Orchestrator</b><span>Turns the goal into tasks</span><i className="st st-done">Live</i></li>
                  {pack.roles.map((r) => <li key={r.name}><b>{r.name}</b><span>{r.does}</span><i className={"st " + (r.status === "live" ? "st-done" : "st-paused")}>{r.status === "live" ? "Live" : "Coming"}</i></li>)}
                </ul>
              </div>
            )}
            <p className="label">What happens next</p>
            <ol className="steps-v">
              <li><span className="m-n">01</span><div><b>Sign in from your email</b><p>No password. Your workspace is ready with your profile filled in.</p></div></li>
              <li><span className="m-n">02</span><div><b>Spin up your team</b><p>On the Floor, from your description or a ready-made team. You see the cost before it starts.</p></div></li>
              <li><span className="m-n">03</span><div><b>Approve its first work</b><p>Drafts wait on your desk. Edit, send or reject; replies come to you.</p></div></li>
              <li><span className="m-n">04</span><div><b>Choose a plan, or don't</b><p>After 14 days, plans start at £{PLANS.starter.price} a month. Nothing is charged automatically.</p></div></li>
            </ol>
          </aside>
        </div>
      </Section>
    </Page>
  );
}

export function Unsubscribe() {
  const { query } = useRoute();
  const [email, setEmail] = useState(query.e || "");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter the email address the message was sent to.");
    if (!LIVE) return setDone(true);
    setBusy(true); setErr("");
    // The link in an email carries a token that unsubscribes at once; typed in by hand, we email a link to confirm.
    try { const r = await api("POST", "/api/public/unsubscribe", { email: email.trim(), ...(query.t && email.trim().toLowerCase() === (query.e || "").toLowerCase() ? { token: query.t } : {}) }); setDone(r.unsubscribed === false ? "confirm" : true); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Page title="Unsubscribe">
      <PageHead crumbs={[["Unsubscribe"]]} label="Email preferences" title="Stop emails from Agent House agents" lede="Businesses use Agent House agents to send introductions. Unsubscribe here and no agent on Agent House will email this address again, for any business." />
      <Section tight>
        <div className="grid">
          <form className="form col-6" onSubmit={submit} noValidate>
            {done === "confirm" ? (
              <div aria-live="polite"><h2 className="h-small">Check your email</h2><p className="body mt-s">We've sent {email} a link. Open it to confirm, and no agent on Agent House will email that address again.</p></div>
            ) : done ? (
              <div aria-live="polite"><h2 className="h-small">You're unsubscribed</h2><p className="body mt-s">{email} won't receive outreach from any Agent House agent again. You don't need to do anything else.</p></div>
            ) : (
              <>
                <h2 className="h-small">Unsubscribe this address</h2>
                <div className="field"><label htmlFor="u-email">Email address</label><input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                {err && <p className="form-err" role="alert">{err}</p>}
                <button className="btn btn-block" disabled={busy}>{busy ? "Unsubscribing…" : "Unsubscribe"}</button>
                <p className="source">Replying STOP to any message works too.</p>
              </>
            )}
          </form>
        </div>
      </Section>
    </Page>
  );
}
