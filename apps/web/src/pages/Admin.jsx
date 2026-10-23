// Operator console: create pilot workspaces, approve health checks, load the company index, run jobs.
// Uses the ADMIN_TOKEN as a bearer token; it's kept in this browser tab only.
import React, { useEffect, useState } from "react";
import { Page, PageHead, Section } from "../ui.jsx";
import { ApiError, dateTimeOf, LIVE } from "../api.js";
import { Link, navigate } from "../router.jsx";
import { isPass, setPass } from "../pass.js";

const KEY = "ah-admin-token";
const load = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
const keep = (t) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch {} };

async function admin(token, method, path, body, { raw = false, type } = {}) {
  const headers = { Authorization: "Bearer " + token };
  let payload;
  if (body !== undefined) { headers["Content-Type"] = type || "application/json"; payload = type ? body : JSON.stringify(body); }
  const res = await fetch("/api/admin" + path, { method, headers, body: payload });
  if (!res.ok) { let j = {}; try { j = await res.json(); } catch {} throw new ApiError(res.status, j.error?.code, j.error?.message || `Failed (${res.status})`); }
  return raw ? res : res.json();
}

const TASKS = [["gazette", "Poll The Gazette"], ["reconcile", "Reconcile watched companies"], ["digests", "Send due digests"], ["monthly", "Build monthly prospect lists and meter usage"], ["retention", "Run retention"]];

function LiveAdmin() {
  const [token, setToken] = useState(load);
  const [draft, setDraft] = useState("");
  const [orgs, setOrgs] = useState(null);
  const [hcs, setHcs] = useState(null);
  const [tools, setTools] = useState(null);
  const [notes, setNotes] = useState({});
  const [preview, setPreview] = useState(null);
  const [org, setOrg] = useState({ name: "", owner_email: "", owner_name: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr(e.message); if (e.status === 401) { keep(""); setToken(""); } } finally { setBusy(false); } };
  const refresh = () => run(async () => {
    const [o, h, t] = await Promise.all([admin(token, "GET", "/orgs"), admin(token, "GET", "/health-checks"), admin(token, "GET", "/tools")]);
    setOrgs(o.orgs); setHcs(h.health_checks); setTools(t.tools);
  });
  useEffect(() => { if (token) refresh(); }, [token]);

  if (!token) {
    return (
      <Page title="Operator">
        <PageHead label="Operator" title="Agent House operations" lede="For the Agent House team. Paste the operator token to continue." />
        <Section tight>
          <form className="admin-token" onSubmit={(e) => { e.preventDefault(); keep(draft.trim()); setToken(draft.trim()); }}>
            <div className="field"><label htmlFor="adm-t">Operator token</label><input id="adm-t" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
            <button className="btn" type="submit" disabled={!draft.trim()}>Continue</button>
          </form>
          {err && <p className="form-err mt-s" role="alert">{err}</p>}
        </Section>
      </Page>
    );
  }

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      if (!org.name.trim() || !/^\S+@\S+\.\S+$/.test(org.owner_email)) throw new Error("Add the business name and the owner's email.");
      await admin(token, "POST", "/orgs", { name: org.name.trim(), owner_email: org.owner_email.trim(), ...(org.owner_name.trim() ? { owner_name: org.owner_name.trim() } : {}) });
      setMsg(`Workspace created for ${org.name}. The owner has been emailed a sign-in link.`);
      setOrg({ name: "", owner_email: "", owner_name: "" }); await refresh();
    });
  };
  const showPreview = (h) => run(async () => { const res = await admin(token, "GET", `/health-checks/${h.id}/preview`, undefined, { raw: true }); setPreview({ id: h.id, html: await res.text(), company: h.company }); });
  const approve = (h) => run(async () => { const r = await admin(token, "POST", `/health-checks/${h.id}/approve`); setMsg(`Approved and sent to ${h.email}. Report link: ${r.link}`); setPreview(null); await refresh(); });
  const decide = (t, d) => run(async () => { await admin(token, "POST", `/tools/${t.slug}/${d}`, { ...(notes[t.slug] ? { note: notes[t.slug] } : {}) }); setMsg(`${t.slug} ${d === "approve" ? "is live" : "was rejected"}. ${t.owner_email} has been told.`); await refresh(); });
  const task = (t, label) => run(async () => { const r = await admin(token, "POST", "/run/" + t); setMsg(`${label}: ${JSON.stringify(r.result)}`); });
  const loadIndex = (file) => run(async () => { const r = await admin(token, "POST", "/company-index", await file.text(), { type: "text/csv" }); setMsg(`Company index: ${r.loaded.toLocaleString("en-GB")} rows loaded for ${r.month}.`); });

  return (
    <Page title="Operator">
      <PageHead label="Operator" title="Agent House operations" lede="Health checks and developer tools wait here for review. Pilot workspaces are created here." />
      <Section tight>
        {msg && <p className="notice" role="status">{msg}</p>}
        {err && <p className="notice notice-signal" role="alert">{err}</p>}

        <h2 className="h-sub">Health checks</h2>
        <table className="ledger ws-table">
          <thead><tr><th>Company</th><th className="hide-sm">Contact</th><th>Status</th><th className="hide-sm">Result</th><th className="num">Actions</th></tr></thead>
          <tbody>
            {hcs && hcs.length === 0 && <tr><td colSpan={5} className="empty">No health checks yet.</td></tr>}
            {(hcs || []).map((h) => {
              const s = h.summary ? JSON.parse(h.summary) : null;
              return (
                <tr key={h.id}>
                  <td><b>{h.company}</b><br /><span className="dt">{dateTimeOf(h.created_at)}</span></td>
                  <td className="hide-sm">{h.name}<br /><span className="muted">{h.email}</span></td>
                  <td className={h.status === "awaiting_approval" ? "signal" : ""}>{h.status.replace(/_/g, " ")}</td>
                  <td className="hide-sm">{s ? `${s.sent} sent, ${s.matched} matched, ${s.flagged} flagged` : ""}</td>
                  <td className="num">
                    <div className="row-actions">
                      {s && <button className="btn btn-line btn-sm" disabled={busy} onClick={() => showPreview(h)}>Preview</button>}
                      {h.status === "awaiting_approval" && <button className="btn btn-sm" disabled={busy} onClick={() => approve(h)}>Approve and send</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {preview && (
          <div className="mt-l">
            <div className="toolbar"><b>Report preview: {preview.company}</b><button className="link link-s" onClick={() => setPreview(null)}>Close preview</button></div>
            <iframe className="preview-frame" title={"Report preview for " + preview.company} sandbox="" srcDoc={preview.html} />
          </div>
        )}

        <h2 className="h-sub mt-l">Developer tools</h2>
        <table className="ledger ws-table">
          <thead><tr><th>Tool</th><th className="hide-sm">Endpoint</th><th className="num">Price</th><th>Status</th><th className="num">Actions</th></tr></thead>
          <tbody>
            {tools && tools.length === 0 && <tr><td colSpan={5} className="empty">No developer tools yet.</td></tr>}
            {(tools || []).map((t) => (
              <tr key={t.slug}>
                <td><b>{t.name}</b> <span className="mono muted">{t.slug}</span><br /><span className="dt">{t.description}</span><br /><span className="dt">{t.owner_email}, {dateTimeOf(t.created_at)}</span></td>
                <td className="hide-sm mono" style={{ overflowWrap: "anywhere" }}>{t.endpoint}</td>
                <td className="num">{t.price_pence}p</td>
                <td>{t.status}{t.review_note ? <><br /><span className="dt">{t.review_note}</span></> : ""}</td>
                <td className="num">
                  {t.status === "review" && (
                    <div className="row-actions" style={{ flexWrap: "wrap" }}>
                      <input className="input-s" aria-label={"Note for " + t.slug} placeholder="Note to the publisher" value={notes[t.slug] || ""} onChange={(e) => setNotes({ ...notes, [t.slug]: e.target.value })} style={{ height: 40, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 10, minWidth: 180 }} />
                      <button className="btn btn-sm" disabled={busy} onClick={() => decide(t, "approve")}>Approve</button>
                      <button className="btn btn-line btn-sm" disabled={busy} onClick={() => decide(t, "reject")}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="h-sub mt-l">Workspaces</h2>
        <table className="ledger">
          <thead><tr><th>Business</th><th className="hide-sm">Owner</th><th>Plan</th><th className="num">Customers watched</th></tr></thead>
          <tbody>
            {orgs && orgs.length === 0 && <tr><td colSpan={4} className="empty">No workspaces yet.</td></tr>}
            {(orgs || []).map((o) => <tr key={o.id}><td><b>{o.name}</b><br /><span className="dt mono">{o.id}</span></td><td className="hide-sm">{o.owner_email}</td><td>{o.plan || "none"}</td><td className="num">{o.clients}</td></tr>)}
          </tbody>
        </table>
        <form className="inline-form" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,2fr) minmax(0,1.5fr) auto" }} onSubmit={create} noValidate>
          <div className="field"><label htmlFor="o-name">Business name</label><input id="o-name" className="input-s" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="o-email">Owner email</label><input id="o-email" className="input-s" type="email" value={org.owner_email} onChange={(e) => setOrg({ ...org, owner_email: e.target.value })} /></div>
          <div className="field"><label htmlFor="o-own">Owner name</label><input id="o-own" className="input-s" value={org.owner_name} onChange={(e) => setOrg({ ...org, owner_name: e.target.value })} /></div>
          <button className="btn btn-sm" type="submit" disabled={busy}>Create pilot workspace</button>
        </form>

        <h2 className="h-sub mt-l">Data and jobs</h2>
        <div className="inline-form inline-form-1">
          <div className="field">
            <span className="flabel">Load the Companies House monthly snapshot (CSV, or a slice of it)</span>
            <label className="file" htmlFor="ix-file"><span>Choose BasicCompanyData CSV</span><span className="file-btn">Browse</span>
              <input id="ix-file" type="file" accept=".csv" onChange={(e) => e.target.files[0] && loadIndex(e.target.files[0])} />
            </label>
          </div>
        </div>
        <div className="row-actions mt-s" style={{ justifyContent: "flex-start" }}>
          {TASKS.map(([t, label]) => <button key={t} className="btn btn-line btn-sm" disabled={busy} onClick={() => task(t, label)}>{label}</button>)}
        </div>
        <p className="more"><button className="link link-s" onClick={refresh} disabled={busy}>Refresh</button> <button className="link link-s" style={{ marginLeft: 16 }} onClick={() => { keep(""); setToken(""); }}>Forget token</button></p>
      </Section>
    </Page>
  );
}


/* ---------- The operator pass (demo build only) ---------- */
const FUNCTIONS = [
  ["Run the business", [["Today", "/workspace", "What needs you, approve drafts in one go"], ["Approvals", "/workspace/approvals", "Read, edit and send what agents drafted"], ["How we work", "/workspace/rules", "House rules every agent follows"], ["Agents", "/workspace/agents", "Every role, including the ones still being built"], ["Hire an agent", "/workspace/agents/new?t=bookings", "Bookings, unlocked by the pass"], ["Agents and activity", "/workspace/overview", "Runs, steps and what each agent did"]]],
  ["Teams", [["The Floor", "/floor", "Spin up a team, including the Markets desk"], ["Org chart and badges", "/floor", "Open a team, then the Org tab"]]],
  ["Work", [["Leads", "/workspace/leads", ""], ["Inbox", "/workspace/inbox", ""], ["Invoices", "/workspace/invoices", ""], ["Tasks", "/workspace/tasks", ""]]],
  ["Customers", [["Alerts", "/workspace/alerts", "Register changes, Critical first"], ["Customers", "/workspace/clients", "Add or remove companies"], ["Company checks", "/workspace/check", "A sourced brief on any customer"], ["Lead lists", "/workspace/prospects", ""]]],
  ["Account", [["Usage and plan", "/workspace/usage", "Switch between every plan"], ["Settings", "/workspace/settings", "Profile, channels and the team"]]],
  ["The public site", [["Home", "/", ""], ["Use cases", "/use-cases", ""], ["How it works", "/how-it-works", ""], ["Pricing", "/pricing", ""], ["Trust", "/trust", ""], ["Free customer check", "/health-check", ""], ["Developers", "/developers", ""], ["For agents", "/for-agents", ""], ["Start a workspace", "/start", "Goes straight to the workspace with the pass"]]],
];

function DemoAdmin() {
  const [on, setOn] = useState(isPass);
  useEffect(() => { const f = () => setOn(isPass()); window.addEventListener("ah:pass", f); return () => window.removeEventListener("ah:pass", f); }, []);
  const toggle = (v) => { setPass(v); setOn(v); };
  return (
    <Page title="Operator pass">
      <PageHead label="Operator" title={on ? "Everything is unlocked" : "Operator pass"}
        lede={on
          ? "This copy of Agent House now lets you into everything: roles still being built, the Markets desk, every plan, billing, channels and the team, with no agent or action limits. Nothing is sent anywhere, and changes last until you reload."
          : "This copy of Agent House is a demo, so some parts are held back: roles still being built, the Markets desk, plans, billing, channels and inviting people. The pass unlocks them in this browser, so you can walk through every function."} />
      <Section tight>
        <div className="actions">
          {on ? (
            <><button className="btn" onClick={() => navigate("/workspace")}>Open the workspace</button><button className="btn btn-line" onClick={() => toggle(false)}>Lock again</button></>
          ) : (
            <button className="btn btn-lg" onClick={() => toggle(true)}>Unlock everything</button>
          )}
        </div>
        <p className="source">The pass lives in this browser only and changes nothing on the hosted site, which keeps its operator token and real sign-in. File uploads, sign-in links, the developer dashboard and real emails need the hosted site.</p>
      </Section>
      {on && (
        <Section>
          <div className="pass-grid">
            {FUNCTIONS.map(([g, items]) => (
              <div key={g} className="pass-group">
                <h2 className="h-sub">{g}</h2>
                <ul>{items.map(([t, to, d]) => <li key={t}><Link to={to} className="pass-link"><b>{t}</b>{d && <span>{d}</span>}</Link></li>)}</ul>
              </div>
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}

export default function Admin() { return LIVE ? <LiveAdmin /> : <DemoAdmin />; }
