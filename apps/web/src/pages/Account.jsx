// Account pages: usage and plan, and settings (business profile, channels, team, activity log).
import React, { useEffect, useState } from "react";
import { isPass } from "../pass.js";
import { Link, useRoute } from "../router.jsx";
import { useWs, useCan } from "../layout.jsx";
import { api, useApi, useAction, dateTimeOf, pounds } from "../api.js";
import { PLANS } from "../../../../packages/core/templates.ts";
import { Shell, Notice, Loading, Failed, changed } from "./Live.jsx";
import { ModeName } from "../credits.jsx";

const SUB = { none: "No plan yet", pilot: "Pilot, founding rate", active: "Active", trialing: "Free trial", past_due: "Payment overdue", canceled: "Cancelled", incomplete: "Awaiting payment" };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const lastMonths = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7); });
const monthName = (m) => new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/* ---------- Usage and plan ---------- */
const ENTRY = { run: "Run", system: "AI Team (system)", plan_grant: "Monthly credits", plan_expiry: "Unused plan credits lapsed", upgrade_grant: "Upgrade", topup: "Top-up", trial_grant: "Free trial", adjustment: "Adjustment" };
const resetName = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const n = (x) => (Math.round(x) || 0).toLocaleString("en-GB");

export function WsUsage() {
  const { me } = useWs();
  const can = useCan();
  const { query } = useRoute();
  const [month, setMonth] = useState(thisMonth());
  const [kind, setKind] = useState("all");
  const { data, error, loading, reload } = useApi("/api/ws/usage?month=" + month);
  const act = useAction();
  // Checkout and the portal are Stripe pages; the demo answers with a link back here, so reload to show the change.
  const billing = (path, body) => act.run(async () => { const r = await api("POST", path, body); if (r.url) window.location.href = r.url; if (!r.url || r.url.startsWith("#")) await reload(); return r; });
  const sub = me.subscription?.status || "none";
  const cr = data?.credits;
  // How much is left of what the month started with (its plan credits plus any top-up credits).
  const left = cr ? Math.min(100, Math.round((cr.balance.total / Math.max(cr.plan_credits + cr.balance.topup, cr.balance.total, 1)) * 100)) : 0;
  // The demo answers top-ups and settings from memory, so its owner can try them.
  const owner = can("owner");
  const paidPlan = ["starter", "growth", "scale"].includes(me.org.plan) && ["active", "past_due"].includes(sub);
  const [threshold, setThreshold] = useState("");
  useEffect(() => { if (cr) setThreshold(String(cr.confirm_over)); }, [cr?.confirm_over]);
  const entries = (cr?.entries || []).filter((e) => kind === "all" || (kind === "runs" ? e.kind === "run" || e.kind === "system" : e.kind !== "run" && e.kind !== "system"));
  const changePlan = (k) => {
    if (!paidPlan) return billing("/api/ws/billing/checkout", { plan: k });
    return act.run(async () => { await api("POST", "/api/ws/billing/plan", { plan: k }); changed(); await reload(); });
  };
  return (
    <Shell title="Usage and plan" crumbs={[["Usage and plan"]]}>
      {query.billing === "done" && <Notice>Thanks. Your plan is being activated; it shows here within a minute.</Notice>}
      {query.billing === "cancelled" && <Notice>Checkout was cancelled. Nothing was charged.</Notice>}
      {query.topup === "done" && <Notice>Thanks. Your 1,000 credits arrive as soon as the payment clears, usually within a minute.</Notice>}
      {query.topup === "cancelled" && <Notice>The top-up was cancelled. Nothing was charged.</Notice>}
      <div className="toolbar">
        <p className="body">Your AI Team uses credits for the work it does: 1 credit is 1p of AI. Quick jobs cost a credit or two; deep research and strategy cost more. You choose the mode for each agent and task.</p>
        <div className="field field-inline">
          <label htmlFor="us-month">Month</label>
          <select id="us-month" value={month} onChange={(e) => setMonth(e.target.value)}>{lastMonths(12).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>
        </div>
      </div>
      {error && <Failed error={error} retry={reload} />}
      {loading && !data ? <Loading what="Loading usage" /> : cr && (
        <>
          {cr.current && cr.paused && <Notice signal>Your AI Team has used this month's credits, so it's paused until {resetName(cr.reset_on)}. {owner ? "Top up to carry on now. Nothing is charged without your say-so." : "Ask the owner to top up."}</Notice>}
          {cr.pending_plan && <Notice>Your plan moves to {PLANS[cr.pending_plan]?.name} on {resetName(cr.reset_on)}. Until then you keep everything in {PLANS[me.org.plan]?.name}.</Notice>}
          <div className="stat-row">
            <div><span className="dt">Credits left</span><b>{n(cr.balance.total)}</b>{cr.current && <span className="meter" aria-hidden="true"><i style={{ width: left + "%" }} className={left <= 10 ? "is-hot" : ""} /></span>}<span className="dt">{n(cr.balance.plan)} from your plan{cr.balance.topup ? `, ${n(cr.balance.topup)} topped up` : ""}</span></div>
            <div><span className="dt">Used in {monthName(month).split(" ")[0]}</span><b>{n(cr.used)}</b><span className="dt">of {n(cr.plan_credits)} a month on {data.plan_name}</span></div>
            <div><span className="dt">Plan credits reset</span><b className="b-s">{resetName(cr.reset_on)}</b><span className="dt">Top-up credits roll over</span></div>
            <div>
              <span className="dt">Top up</span><b className="b-s">{n(cr.topup.credits)} for £{(cr.topup.pence / 100).toFixed(0)}</b>
              {owner ? <button className="btn btn-sm mt-s" disabled={act.busy || !cr.topup.available} onClick={() => billing("/api/ws/billing/topup")}>Top up</button> : <span className="dt">The owner can top up</span>}
            </div>
          </div>
          {cr.suggestions.length > 0 && (
            <section className="mt-l">
              <h2 className="h-sub">Ways to spend less</h2>
              {cr.suggestions.map((s) => <Notice key={s.agent_id}>{s.text} <Link to={"/workspace/agents/" + s.agent_id} className="link link-s">Change its mode</Link></Notice>)}
            </section>
          )}
          <div className="grid-2 mt-l">
            <section>
              <h2 className="h-sub">By agent, {monthName(month)}</h2>
              <table className="ledger ws-table">
                <thead><tr><th>Agent</th><th>Mode</th><th className="num">Runs</th><th className="num">Credits</th></tr></thead>
                <tbody>
                  {cr.by_agent.length === 0 && <tr><td colSpan={4} className="empty">No agents hired yet.</td></tr>}
                  {cr.by_agent.map((a) => (
                    <tr key={a.id}>
                      <td><Link to={"/workspace/agents/" + a.id} className="link">{a.name}</Link>{a.budget_paused && <span className="st st-waiting">Budget reached</span>}</td>
                      <td><ModeName mode={a.mode} /></td>
                      <td className="num">{a.runs}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>{n(a.credits)}{a.budget ? <span className="dt"> of {n(a.budget)}</span> : ""}</td>
                    </tr>
                  ))}
                  {cr.system.calls > 0 && <tr><td>AI Team (system)<span className="dt"> the command bar, swarm drafts, house rules</span></td><td /><td className="num">{cr.system.calls}</td><td className="num">{n(cr.system.credits)}</td></tr>}
                </tbody>
              </table>
            </section>
            <section>
              <h2 className="h-sub">By mode</h2>
              <table className="ledger ws-table">
                <thead><tr><th>Mode</th><th className="num">Runs</th><th className="num">Credits</th></tr></thead>
                <tbody>{cr.by_mode.map((m) => <tr key={m.mode}><td><ModeName mode={m.mode} /></td><td className="num">{m.runs}</td><td className="num">{n(m.credits)}</td></tr>)}</tbody>
              </table>
            </section>
          </div>
          <div className="panel-h mt-l">
            <h2 className="h-sub">Ledger</h2>
            <div className="actions actions-tight">
              <select aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">Everything</option><option value="runs">Runs</option><option value="credits">Credits added and reset</option></select>
              <a className="link link-s" href={"/api/ws/usage/credits.csv?month=" + month}>Download CSV</a>
            </div>
          </div>
          <table className="ledger ws-table">
            <thead><tr><th>When</th><th>What</th><th className="hide-sm">Mode</th><th className="num hide-sm">Tokens in / out</th><th className="num">Credits</th></tr></thead>
            <tbody>
              {entries.length === 0 && <tr><td colSpan={5} className="empty">Nothing this month yet.</td></tr>}
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="dt">{dateTimeOf(e.at)}</td>
                  <td>{e.kind === "run" ? (e.run_id ? <Link to={"/workspace/runs/" + e.run_id} className="link">{e.agent || "Run"}</Link> : e.agent || "Run") : ENTRY[e.kind]}{e.kind === "system" && e.note ? <span className="dt"> {e.note}</span> : ""}</td>
                  <td className="hide-sm">{e.mode ? <ModeName mode={e.mode} /> : ""}</td>
                  <td className="num hide-sm dt">{e.kind === "run" || e.kind === "system" ? `${n(e.tokens_in + e.cache_read + e.cache_write)} / ${n(e.tokens_out)}` : ""}</td>
                  <td className="num">{e.credits > 0 ? "+" : ""}{n(e.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {owner && cr.current && (
            <form className="field field-inline mt-l" onSubmit={(e) => { e.preventDefault(); act.run(async () => { await api("PATCH", "/api/ws/credits/settings", { confirm_over: Number(threshold) }); await reload(); }); }}>
              <label htmlFor="us-confirm">Ask me before a run likely to use more than</label>
              <input id="us-confirm" type="number" min={1} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ maxWidth: 110 }} />
              <span className="dt">credits</span>
              <button className="btn btn-sm btn-line" disabled={act.busy || String(cr.confirm_over) === threshold}>Save</button>
            </form>
          )}
        </>
      )}
      <h2 className="h-sub mt-l">Plan</h2>
      <p className="body">{me.org.plan === "trial" || sub === "trialing" ? <>You're on the <b>14-day free trial</b>, with the whole OS and {PLANS.trial.credits} credits to try every mode.</> : <>You're on <b>{(PLANS[me.org.plan] || PLANS.trial).name}</b>{sub !== "active" && SUB[sub] ? ` (${SUB[sub].toLowerCase()})` : ""}.</>} Every plan has every app, unlimited people and up to 100 AI Team members; plans differ in how many credits the AI Team gets each month. Moving up takes effect now, with this month's extra credits; moving down takes effect on the 1st.</p>
      <div className="plans">
        {["starter", "growth", "scale"].map((k) => {
          const p = PLANS[k], current = me.org.plan === k, pending = cr?.pending_plan === k;
          return (
            <article key={k} className={"plan" + (k === "growth" ? " is-pick" : "") + (current ? " is-current" : "")}>
              <p className="plan-n">{p.name}{k === "growth" && <span className="st st-done">Most chosen</span>}</p>
              <p className="plan-p"><b>£{p.price}</b><span>a month</span></p>
              <p className="dt">{p.blurb}</p>
              <ul className="ticks"><li>Every app</li><li>{p.credits.toLocaleString("en-GB")} credits a month</li><li>Unlimited people</li></ul>
              {can("owner") && (current
                ? <button className="btn btn-line btn-sm btn-block" disabled>Your plan</button>
                : <button className={"btn btn-sm btn-block" + (k === "growth" ? "" : " btn-line")} disabled={act.busy || pending || (me.demo && !isPass())} onClick={() => changePlan(k)}>{pending ? "From the 1st" : paidPlan ? (p.credits > (PLANS[me.org.plan]?.credits || 0) ? `Move up to ${p.name}` : `Move to ${p.name} on the 1st`) : `Choose ${p.name}`}</button>)}
            </article>
          );
        })}
      </div>
      <p className="source">Prices before VAT. Top up anytime at £35 per 1,000 credits, or the AI Team pauses until the 1st — nothing is charged without your say-so.</p>
      {me.demo && !isPass() && <p className="dt">Plans are chosen in your own workspace. <Link to="/start" className="link link-s">Start a free trial</Link></p>}
      {act.error && <Notice signal>{act.error}</Notice>}
      {can("owner") && ["active", "past_due"].includes(sub) && <button className="btn btn-line mt-s" disabled={act.busy} onClick={() => billing("/api/ws/billing/portal")}>Manage billing and invoices</button>}
      {!can("owner") && <p className="dt">Only the workspace owner can change the plan or top up.</p>}
    </Shell>
  );
}

/* ---------- Settings ---------- */
const PROFILE_FIELDS = [
  ["what", "What you do", "Commercial and office cleaning on daily or weekly contracts", "One sentence an agent can use to introduce you."],
  ["customers", "Who your customers are", "Offices, dental practices and small clinics with 10 to 80 staff", "Outreach uses this to choose companies; the more specific, the better."],
  ["area", "Where you work", "Manchester and Salford", "Towns, cities or postcode areas."],
  ["tone", "How you write", "Warm and plain-spoken, no jargon", "Agents write in this voice."],
  ["sign_off", "Sign-off", "Dana Price, Brightwork Cleaning", "Goes at the end of every email."],
  ["website", "Website", "brightwork.co.uk", ""],
];
const CHANNEL_HELP = {
  teams: "In Teams, open the channel, choose Workflows, and pick “Post to a channel when a webhook request is received”. Paste the URL it gives you.",
  slack: "In Slack, create an incoming webhook for the channel (Apps, Incoming Webhooks) and paste its hooks.slack.com URL.",
  email: "One address per channel. Use a shared inbox if several people need it.",
};
const KIND_NAME = { teams: "Microsoft Teams", slack: "Slack", email: "Email" };
const ROLE_HELP = { owner: "Everything, including billing, channels and team", manager: "Hire agents, approve emails, change settings", viewer: "Read only" };

/** Notifications on this device: approvals waiting over an hour, critical alerts, stopped runs and the daily summary. */
function Notifications() {
  const can = typeof window !== "undefined" && "Notification" in window;
  const [state, setState] = useState(can ? Notification.permission : "unsupported");
  const [quiet, setQuiet] = useState(() => { try { return JSON.parse(localStorage.getItem("ah:quiet") || '{"from":"20:00","to":"07:00"}'); } catch { return { from: "20:00", to: "07:00" }; } });
  const saveQuiet = (q) => { setQuiet(q); try { localStorage.setItem("ah:quiet", JSON.stringify(q)); } catch {} };
  const ask = async () => { try { setState(await Notification.requestPermission()); } catch {} };
  const test = () => window.__ahNotify?.("Test: 1 draft is waiting for your OK", "/workspace/approvals");
  return (
    <section id="notify" className="set-sec">
      <h2 className="h-sub">Notifications on this device</h2>
      <p className="body">Only what needs you: approvals waiting over an hour, critical alerts, work that stopped with a problem, and a daily summary for apps that run on their own. Each one opens the right screen. Add Agent House to your home screen to get them on your phone.</p>
      <p className="body mt-s">{state === "granted" ? "Notifications are on." : state === "denied" ? "Notifications are blocked in this browser's settings." : state === "unsupported" ? "This browser doesn't support notifications." : "Notifications are off."}</p>
      <div className="actions actions-tight">
        {state === "default" && <button className="btn btn-sm" onClick={ask}>Turn on notifications</button>}
        <button className="btn btn-sm btn-line" onClick={test}>Send a test</button>
      </div>
      <p className="body mt-s">Quiet hours, when only critical alerts come through if you allow them: <label>from <input type="time" value={quiet.from} onChange={(e) => saveQuiet({ ...quiet, from: e.target.value })} /></label> <label>to <input type="time" value={quiet.to} onChange={(e) => saveQuiet({ ...quiet, to: e.target.value })} /></label></p>
    </section>
  );
}

export function WsSettings() {
  const { me, refreshMe, signOut } = useWs();
  const can = useCan();
  return (
    <Shell title="Settings" crumbs={[["Settings"]]}>
      <nav className="subnav" aria-label="Settings sections">
        <a href="#/workspace/build">Your OS</a>
        {[["profile", "Business profile"], ["notify", "Notifications"], ["channels", "Channels"], ["team", "Team"], ...(can("owner") ? [["log", "Activity log"]] : []), ["account", "Account"]].map(([id, t]) => <a key={id} href={"#/workspace/settings?s=" + id}>{t}</a>)}
      </nav>
      <section className="set-sec set-os">
        <h2 className="h-sub">Your OS</h2>
        <p className="body">Which apps you run here, which you outsource or keep in your current tools, their features, and how much the AI Team does on its own in each.</p>
        <p><a href="#/workspace/build" className="btn btn-sm">Open Your OS</a></p>
      </section>
      <Notifications />
      <Profile me={me} can={can} refreshMe={refreshMe} />
      <Channels can={can} />
      <Team me={me} can={can} />
      <section id="account" className="set-sec">
        <h2 className="h-sub">Your account</h2>
        <dl className="facts-tab">
          <div><dt>Signed in as</dt><dd>{me.user.email}</dd></div>
          <div><dt>Workspace</dt><dd>{me.org.name}</dd></div>
          {me.org.inbox_address && <div><dt>Inbox address</dt><dd className="mono">{me.org.inbox_address}</dd></div>}
        </dl>
        {!me.demo && <button className="btn btn-line" onClick={signOut}>Sign out</button>}
      </section>
    </Shell>
  );
}

function Profile({ me, can, refreshMe }) {
  const [f, setF] = useState(() => ({ name: me.org.name, ...Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, me.org.profile?.[k] || ""])) }));
  const [note, setNote] = useState("");
  const act = useAction();
  const save = (e) => {
    e.preventDefault();
    if (!f.name.trim()) return act.setError("Your business needs a name.");
    act.run(async () => {
      const { name, ...profile } = f;
      await api("PATCH", "/api/ws/org", { name: name.trim(), profile: Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, v.trim()])) });
      if (!me.demo) await refreshMe();
      setNote("Saved. Agents use the new profile from their next run. Existing briefs don't change; edit them on each agent's page.");
    });
  };
  return (
    <section id="profile" className="set-sec">
      <h2 className="h-sub">Business profile</h2>
      <p className="body">Every agent reads this before it works. Keep it short and specific.</p>
      <form className="form profile-form" onSubmit={save} noValidate>
        <fieldset className="plain" disabled={!can("owner") || act.busy}>
          <div className="field"><label htmlFor="p-name">Business name</label><input id="p-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          {PROFILE_FIELDS.map(([k, l, ph, hint]) => (
            <div key={k} className="field">
              <label htmlFor={"p-" + k}>{l}</label>
              {k === "what" || k === "customers" ? <textarea id={"p-" + k} rows={2} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={500} /> : <input id={"p-" + k} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
              {hint && <p className="hint">{hint}</p>}
            </div>
          ))}
        </fieldset>
        <Notice>{note}</Notice>
        {act.error && <Notice signal>{act.error}</Notice>}
        {can("owner") ? <button className="btn btn-sm" disabled={act.busy}>Save profile</button> : <p className="dt">Only the workspace owner can change the profile.</p>}
      </form>
    </section>
  );
}

function Channels({ can }) {
  const channels = useApi("/api/ws/channels");
  const [nc, setNc] = useState({ kind: "slack", label: "", target: "" });
  const [removing, setRemoving] = useState("");
  const [note, setNote] = useState("");
  const act = useAction();
  const chs = channels.data?.channels || [];
  const add = (e) => {
    e.preventDefault();
    if (!nc.label.trim()) return act.setError("Give the channel a name you'll recognise, for example “#team”.");
    if (!nc.target.trim()) return act.setError(nc.kind === "email" ? "Enter the email address." : "Paste the webhook URL.");
    act.run(async () => {
      await api("POST", "/api/ws/channels", { kind: nc.kind, label: nc.label.trim(), target: nc.target.trim() });
      setNc({ kind: nc.kind, label: "", target: "" }); await channels.reload();
      setNote("Channel added. Send a test message to check it.");
    });
  };
  const test = (c) => act.run(async () => { const r = await api("POST", `/api/ws/channels/${c.id}/test`); await channels.reload(); setNote(r.status === "dry_run" ? `Test for ${c.label} recorded. Live sending is off here.` : `Test message sent to ${c.label}.`); });
  const remove = (c) => act.run(async () => { await api("DELETE", "/api/ws/channels/" + c.id); setRemoving(""); await channels.reload(); setNote(`${c.label} removed. Agents that used it now email the owner.`); });
  return (
    <section id="channels" className="set-sec">
      <h2 className="h-sub">Channels</h2>
      <p className="body">Where agents tell you about their work: drafts waiting for approval, urgent messages, critical alerts. Choose a channel on each agent's page.</p>
      <table className="ledger ws-table">
        <thead><tr><th>Name</th><th>Type</th><th className="hide-sm">Last test</th><th className="num">Actions</th></tr></thead>
        <tbody>
          {chs.length === 0 && <tr><td colSpan={4} className="empty">{channels.loading ? "Loading…" : "No channels yet. Until you add one, agents email the workspace owner."}</td></tr>}
          {chs.map((c) => (
            <tr key={c.id}>
              <td><b>{c.label}</b></td>
              <td>{KIND_NAME[c.kind]}</td>
              <td className="hide-sm muted">{c.verified_at ? dateTimeOf(c.verified_at) : "Not tested"}</td>
              <td className="num">
                <div className="row-actions">
                  {can("manager") && <button className="btn btn-line btn-sm" disabled={act.busy} onClick={() => test(c)}>Send test</button>}
                  {can("owner") && (removing === c.id
                    ? <button className="btn btn-line btn-sm" disabled={act.busy} onClick={() => remove(c)}>Confirm remove</button>
                    : <button className="link link-s" onClick={() => setRemoving(c.id)}>Remove</button>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Notice>{note}</Notice>
      {act.error && <Notice signal>{act.error}</Notice>}
      {can("owner") && (
        <form className="inline-form" onSubmit={add} noValidate>
          <div className="field">
            <label htmlFor="nc-kind">Type</label>
            <select id="nc-kind" value={nc.kind} onChange={(e) => setNc({ ...nc, kind: e.target.value })}>
              <option value="slack">Slack</option><option value="teams">Teams</option><option value="email">Email</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="nc-label">Name</label>
            <input id="nc-label" className="input-s" value={nc.label} onChange={(e) => setNc({ ...nc, label: e.target.value })} placeholder="#team" />
          </div>
          <div className="field">
            <label htmlFor="nc-target">{nc.kind === "email" ? "Email address" : "Webhook URL"}</label>
            <input id="nc-target" className="input-s" type={nc.kind === "email" ? "email" : "url"} value={nc.target} onChange={(e) => setNc({ ...nc, target: e.target.value })} placeholder={nc.kind === "email" ? "office@yourbusiness.co.uk" : "https://"} />
          </div>
          <button className="btn btn-sm" type="submit" disabled={act.busy}>Add channel</button>
          <p className="hint" style={{ gridColumn: "1 / -1" }}>{CHANNEL_HELP[nc.kind]} Webhook URLs are stored encrypted.</p>
        </form>
      )}
    </section>
  );
}

function Team({ me, can }) {
  const users = useApi("/api/ws/users");
  const audit = useApi(can("owner") ? "/api/ws/audit" : null);
  const [inv, setInv] = useState({ email: "", role: "manager" });
  const [note, setNote] = useState("");
  const act = useAction();
  const invite = (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(inv.email)) return act.setError("Enter a valid email address.");
    act.run(async () => { await api("POST", "/api/ws/users", inv); setNote(`Invitation sent to ${inv.email}.`); setInv({ email: "", role: inv.role }); users.reload(); audit.reload(); });
  };
  const setRole = (u, role) => act.run(async () => { await api("PATCH", "/api/ws/users/" + u.id, { role }); setNote(`${u.email} is now ${role === "owner" ? "an owner" : "a " + role}.`); users.reload(); });
  return (
    <>
      <section id="team" className="set-sec">
        <h2 className="h-sub">Team</h2>
        <table className="ledger ws-table">
          <thead><tr><th>Email</th><th>Role</th><th className="hide-sm">Can</th></tr></thead>
          <tbody>
            {(users.data?.users || []).map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.id === me.user.id ? <span className="muted"> (you)</span> : ""}</td>
                <td>
                  {can("owner") && u.id !== me.user.id ? (
                    <select aria-label={"Role for " + u.email} value={u.role} disabled={act.busy} onChange={(e) => setRole(u, e.target.value)}>
                      <option value="owner">Owner</option><option value="manager">Manager</option><option value="viewer">Viewer</option>
                    </select>
                  ) : u.role[0].toUpperCase() + u.role.slice(1)}
                </td>
                <td className="hide-sm muted">{ROLE_HELP[u.role]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {can("owner") && (
          <form className="inline-form inline-form-2" onSubmit={invite} noValidate>
            <div className="field">
              <label htmlFor="inv-email">Invite by email</label>
              <input id="inv-email" className="input-s" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} placeholder="name@yourbusiness.co.uk" />
            </div>
            <div className="field">
              <label htmlFor="inv-role">Role</label>
              <select id="inv-role" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>
                <option value="manager">Manager</option><option value="viewer">Viewer</option><option value="owner">Owner</option>
              </select>
            </div>
            <button className="btn btn-sm" type="submit" disabled={act.busy}>Send invitation</button>
          </form>
        )}
        <Notice>{note}</Notice>
        {act.error && <Notice signal>{act.error}</Notice>}
      </section>
      {can("owner") && (
        <section id="log" className="set-sec">
          <h2 className="h-sub">Activity log</h2>
          <table className="ledger">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th className="hide-sm">Item</th></tr></thead>
            <tbody>
              {(audit.data?.entries || []).length === 0 && <tr><td colSpan={4} className="empty">{audit.loading ? "Loading…" : "Nothing recorded yet."}</td></tr>}
              {(audit.data?.entries || []).slice(0, 50).map((e, i) => (
                <tr key={i}><td className="dt">{dateTimeOf(e.at)}</td><td>{e.actor === me.user.id ? "You" : e.actor === "operator" ? "Agent House" : e.actor === "system" ? "System" : /@/.test(e.actor) ? e.actor : "Team member"}</td><td>{e.action.replace(/_/g, " ")}</td><td className="hide-sm mono muted">{e.target || ""}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="source">Kept for 12 months.</p>
        </section>
      )}
    </>
  );
}
