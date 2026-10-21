// Account pages: usage and plan, and settings (business profile, channels, team, activity log).
import React, { useEffect, useState } from "react";
import { Link, useRoute } from "../router.jsx";
import { useWs, useCan } from "../layout.jsx";
import { api, useApi, useAction, dateTimeOf, pounds } from "../api.js";
import { PLANS } from "../../../../packages/core/templates.ts";
import { Shell, Notice, Loading, Failed } from "./Live.jsx";

const SUB = { none: "No plan yet", pilot: "Pilot, founding rate", active: "Active", trialing: "Free trial", past_due: "Payment overdue", canceled: "Cancelled", incomplete: "Awaiting payment" };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const lastMonths = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7); });
const monthName = (m) => new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/* ---------- Usage and plan ---------- */
export function WsUsage() {
  const { me } = useWs();
  const can = useCan();
  const { query } = useRoute();
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading, reload } = useApi("/api/ws/usage?month=" + month);
  const act = useAction();
  const billing = (path, body) => act.run(async () => { const r = await api("POST", path, body); window.location.href = r.url; });
  const sub = me.subscription?.status || "none";
  const pct = data ? Math.min(100, Math.round((data.actions / Math.max(1, data.plan_actions)) * 100)) : 0;
  return (
    <Shell title="Usage and plan" crumbs={[["Usage and plan"]]}>
      {query.billing === "done" && <Notice>Thanks. Your plan is being activated; it shows here within a minute.</Notice>}
      {query.billing === "cancelled" && <Notice>Checkout was cancelled. Nothing was charged.</Notice>}
      <div className="toolbar">
        <p className="body">An action is one tool call by an agent: a search, a page read, a lead saved, an email drafted. Register watching and company checks don't count.</p>
        <div className="field field-inline">
          <label htmlFor="us-month">Month</label>
          <select id="us-month" value={month} onChange={(e) => setMonth(e.target.value)}>{lastMonths(12).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>
        </div>
      </div>
      {error && <Failed error={error} retry={reload} />}
      {loading && !data ? <Loading what="Loading usage" /> : data && (
        <>
          <div className="stat-row">
            <div><span className="dt">Actions used</span><b>{data.actions.toLocaleString("en-GB")}</b><span className="meter" aria-hidden="true"><i style={{ width: pct + "%" }} className={pct >= 90 ? "is-hot" : ""} /></span><span className="dt">of {data.plan_actions.toLocaleString("en-GB")} on {data.plan_name}</span></div>
            <div><span className="dt">Emails sent</span><b>{data.emails_sent}</b></div>
            <div><span className="dt">Agents hired</span><b>{data.by_agent.length} <span className="of">of {data.plan_agents}</span></b></div>
            <div><span className="dt">Actions left this month</span><b>{Math.max(0, data.plan_actions - data.actions).toLocaleString("en-GB")}</b>{data.actions >= data.plan_actions && <span className="dt">Agents start again on the 1st</span>}</div>
          </div>
          <h2 className="h-sub mt-l">By agent, {monthName(month)}</h2>
          <table className="ledger ws-table">
            <thead><tr><th>Agent</th><th className="num">Runs</th><th className="num">Actions</th></tr></thead>
            <tbody>
              {data.by_agent.length === 0 && <tr><td colSpan={3} className="empty">No agents hired yet.</td></tr>}
              {data.by_agent.map((a, i) => <tr key={i}><td>{a.name}</td><td className="num">{a.runs}</td><td className="num">{a.actions}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
      <h2 className="h-sub mt-l">Plan</h2>
      <p className="body">{me.org.plan === "trial" || sub === "trialing" ? <>You're on the <b>14-day free trial</b>, with everything in Growth.</> : <>You're on <b>{(PLANS[me.org.plan] || PLANS.trial).name}</b>{sub !== "active" && SUB[sub] ? ` (${SUB[sub].toLowerCase()})` : ""}.</>} Plans differ in how many agents work at once and how many actions they get each month. When the month's actions are used, agents pause until the 1st; nothing is ever charged on top.</p>
      <div className="plans">
        {["starter", "growth", "scale"].map((k) => {
          const p = PLANS[k], current = me.org.plan === k;
          return (
            <article key={k} className={"plan" + (k === "growth" ? " is-pick" : "") + (current ? " is-current" : "")}>
              <p className="plan-n">{p.name}{k === "growth" && <span className="st st-done">Most chosen</span>}</p>
              <p className="plan-p"><b>£{p.price}</b><span>a month</span></p>
              <p className="dt">{p.blurb}</p>
              <ul className="ticks"><li>{p.agents} agents working at once</li><li>{p.actions.toLocaleString("en-GB")} actions a month</li><li>Every agent in the catalogue</li></ul>
              {can("owner") && (current
                ? <button className="btn btn-line btn-sm btn-block" disabled>Your plan</button>
                : <button className={"btn btn-sm btn-block" + (k === "growth" ? "" : " btn-line")} disabled={act.busy || me.demo} onClick={() => billing("/api/ws/billing/checkout", { plan: k })}>Choose {p.name}</button>)}
            </article>
          );
        })}
      </div>
      {me.demo && <p className="dt">Plans are chosen in your own workspace. <Link to="/start" className="link link-s">Start a free trial</Link></p>}
      {act.error && <Notice signal>{act.error}</Notice>}
      {can("owner") && ["active", "past_due"].includes(sub) && <button className="btn btn-line mt-s" disabled={act.busy} onClick={() => billing("/api/ws/billing/portal")}>Manage billing and invoices</button>}
      {!can("owner") && <p className="dt">Only the workspace owner can change the plan.</p>}
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

export function WsSettings() {
  const { me, refreshMe, signOut } = useWs();
  const can = useCan();
  return (
    <Shell title="Settings" crumbs={[["Settings"]]}>
      <nav className="subnav" aria-label="Settings sections">
        {[["profile", "Business profile"], ["channels", "Channels"], ["team", "Team"], ...(can("owner") ? [["log", "Activity log"]] : []), ["account", "Account"]].map(([id, t]) => <a key={id} href={"#/workspace/settings?s=" + id}>{t}</a>)}
      </nav>
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
