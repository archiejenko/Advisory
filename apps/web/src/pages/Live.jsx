// The signed-in workspace. Same layout and visual language as the demo, backed by /api/ws.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, navigate, useRoute } from "../router.jsx";
import { Page, PageHead, Section, Severity, Bars, Brief, briefFromApi, DistrictGrid } from "../ui.jsx";
import { useWs, useCan, WsCtx } from "../layout.jsx";
import { DEMO_ME } from "../demo.js";
import { LIVE, api, setDemo, useApi, useAction, download, dateOf, dateTimeOf, pounds } from "../api.js";
import { SIC_GROUPS, DISTRICTS } from "../data.js";

// The workspace sidebar, grouped. Counts come from /api/ws/overview.
const SIDE = [
  [null, [["Overview", "/workspace"], ["The Floor", "/floor"], ["Approvals", "/workspace/approvals", "waiting"], ["Agents", "/workspace/agents"], ["Activity", "/workspace/activity"]]],
  ["Work", [["Leads", "/workspace/leads"], ["Inbox", "/workspace/inbox", "inbox_new"], ["Invoices", "/workspace/invoices"], ["Tasks", "/workspace/tasks", "open_tasks"]]],
  ["Customers", [["Alerts", "/workspace/alerts", "open_alerts"], ["Customers", "/workspace/clients"], ["Company checks", "/workspace/check"], ["Lead lists", "/workspace/prospects"]]],
  ["Account", [["Usage and plan", "/workspace/usage"], ["Settings", "/workspace/settings"]]],
];
export const changed = () => { window.dispatchEvent(new Event("ah:alerts")); };
const AGENT_NAME = { watch: "Customer and supplier watch", check: "New customer check", prospect: "Lead finder" };
const KIND_LABEL = {
  company: "Company record changed", filing: "Filing received", insolvency: "Insolvency case updated", charges: "Charge registered or changed",
  officers: "Officers changed", psc: "People with significant control changed", gazette: "Gazette notice published",
};
const alertsChanged = changed;

export function Notice({ children, signal }) {
  return children ? <p className={"notice" + (signal ? " notice-signal" : "")} role={signal ? "alert" : "status"}>{children}</p> : null;
}
export function Loading({ what = "Loading" }) { return <p className="loading" aria-live="polite">{what}…</p>; }
export function Failed({ error, retry }) {
  return <Notice signal>{error.message} {retry && <button className="link link-s" onClick={retry}>Try again</button>}</Notice>;
}

export function Shell({ title, crumbs, children, actions, wide }) {
  const { me, signOut } = useWs();
  const counts = useApi("/api/ws/overview");
  useEffect(() => {
    const on = () => counts.reload();
    window.addEventListener("ah:alerts", on);
    const t = setInterval(on, 60000);
    return () => { window.removeEventListener("ah:alerts", on); clearInterval(t); };
  }, [counts.reload]);
  const n = counts.data || {};
  return (
    <Page title={"Workspace: " + title}>
      {me.demo && (
        <div className="ws-banner"><div className="wrap">Demo workspace for Brightwork Cleaning, an example business. Approve emails, hire agents and run them: nothing is sent, and changes last until you reload. <Link to="/start" style={{ color: "inherit", fontWeight: 600 }}>Start your own free trial</Link>.</div></div>
      )}
      <div className="wrap ws">
        <aside className="ws-side" aria-label="Workspace">
          <p className="ws-org">{me.org.name}</p>
          <nav>
            {SIDE.map(([group, items]) => (
              <div key={group || "main"} className="ws-group">
                {group && <p className="ws-group-h">{group}</p>}
                {items.map(([t, to, key]) => (
                  <Link key={to} to={to} exact={to === "/workspace"} className="ws-nav">
                    {t}{key && n[key] > 0 && <span className={"ws-count" + (key === "waiting" ? " ws-count-hot" : "")}>{n[key]}</span>}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="ws-side-foot">
            <p className="dt">{me.user.email}, {me.role}</p>
            {me.demo ? <Link to="/start" className="link link-s">Start a free trial</Link> : <button className="signout" onClick={signOut}>Sign out</button>}
          </div>
        </aside>
        <div className={"ws-main" + (wide ? " ws-main-wide" : "")}>
          <nav className="crumbs ws-crumbs" aria-label="Breadcrumb">
            <ol><li><Link to="/workspace">Workspace</Link></li>{crumbs.map(([t, to]) => <li key={t}>{to ? <Link to={to}>{t}</Link> : <span aria-current="page">{t}</span>}</li>)}</ol>
          </nav>
          <div className="ws-titlebar"><h1 className="ws-h">{title}</h1>{actions && <div className="ws-actions">{actions}</div>}</div>
          {children}
        </div>
      </div>
    </Page>
  );
}

/** Chooses the live page when signed in, the demo when not, and waits while the session is checked. */
export function Gate({ live: Live, ...props }) {
  const ctx = useWs();
  if (ctx.me === undefined) { setDemo(false); return <Page title="Workspace"><div className="wrap ws"><Loading what="Opening your workspace" /></div></Page>; }
  if (ctx.me) { setDemo(false); return <Live {...props} />; }
  // Signed out: the same pages, answered by the demo data.
  setDemo(true);
  return <WsCtx.Provider value={{ ...ctx, me: DEMO_ME }}><Live {...props} /></WsCtx.Provider>;
}

function SignInNeeded() {
  return (
    <Page title="Sign in">
      <PageHead crumbs={[["Workspace"]]} label="Workspace" title="Sign in to use this page" lede="This part of the workspace works on your own business. Sign in with the email address your workspace was set up for." />
      <Section tight>
        <div className="actions"><Link to="/sign-in" className="btn">Sign in</Link><Link to="/workspace/alerts" className="link">Try the demo workspace</Link></div>
      </Section>
    </Page>
  );
}

/* ---------- Sign in ---------- */
export function SignIn() {
  const { query } = useRoute();
  const { refreshMe } = useWs();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const act = useAction();
  const tried = useRef(false);
  useEffect(() => {
    if (!query.token || tried.current) return;
    tried.current = true;
    act.run(async () => {
      await api("POST", "/api/auth/session", { token: query.token });
      await refreshMe();
      navigate("/workspace");
    });
  }, [query.token]);
  const submit = (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return act.setError("Enter the email address your workspace uses.");
    act.run(async () => { await api("POST", "/api/auth/magic-link", { email }); setSent(true); });
  };
  return (
    <Page title="Sign in">
      <PageHead crumbs={[["Sign in"]]} label="Workspace" title="Sign in" lede="We email you a link that signs you in. There's no password to remember." />
      <Section tight>
        <div className="grid">
          <div className="col-6">
            {!LIVE && <Notice>Sign-in works on the hosted site. This copy of the page is a demo.</Notice>}
            {query.token && !act.error ? <Loading what="Signing you in" /> : sent ? (
              <div aria-live="polite" className="form">
                <h2 className="h-small">Check your email</h2>
                <p className="body mt-s">If {email} has a workspace, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
                <p className="more"><button className="link" onClick={() => setSent(false)}>Use a different address</button></p>
              </div>
            ) : (
              <form className="form form-narrow" onSubmit={submit} noValidate>
                <h2 className="h-small">{query.token ? "That link didn't work" : "Email me a sign-in link"}</h2>
                {query.token && <Notice signal>{act.error} Ask for a new link below.</Notice>}
                <div className="field">
                  <label htmlFor="si-email">Work email</label>
                  <input id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {!query.token && act.error && <p className="form-err" role="alert">{act.error}</p>}
                <button className="btn btn-block" type="submit" disabled={act.busy || !LIVE}>{act.busy ? "Sending…" : "Send the link"}</button>
                <p className="source">No workspace yet? <Link to="/start" className="link link-s">Start free</Link>.</p>
              </form>
            )}
          </div>
        </div>
      </Section>
    </Page>
  );
}

/* ---------- Alerts ---------- */
export function LiveAlerts() {
  const { query } = useRoute();
  const can = useCan();
  const [view, setView] = useState("open");
  const { data, error, loading, reload } = useApi("/api/ws/alerts?state=" + view);
  const channels = useApi(can("manager") ? "/api/ws/channels" : null);
  const list = data?.alerts || [];
  const inList = list.find((a) => a.id === query.a);
  const single = useApi(query.a && data && !inList ? "/api/ws/alerts/" + query.a : null);
  const sel = inList || single.data || (!query.a ? list[0] : null);
  const [shareTo, setShareTo] = useState("");
  const [note, setNote] = useState("");
  const act = useAction();
  useEffect(() => setNote(""), [query.a]);

  const setState = (state) => act.run(async () => {
    await api("PATCH", "/api/ws/alerts/" + sel.id, { state });
    if (!query.a) navigate("/workspace/alerts?a=" + sel.id);
    await Promise.all([reload(), single.reload()]);
    alertsChanged();
    setNote(state === "reviewed" ? "Marked reviewed. It stays here until you move to another alert." : "Moved back to open.");
  });
  const share = () => act.run(async () => {
    const ch = channels.data.channels.find((c) => c.id === shareTo);
    await api("POST", `/api/ws/alerts/${sel.id}/share`, { channel_id: shareTo });
    setNote(`Sent to ${ch.label}.`);
  });
  const counts = data?.counts || { open: 0, reviewed: 0, all: 0 };
  const chs = channels.data?.channels || [];

  return (
    <Shell title="Alerts" crumbs={[["Alerts"]]}>
      <div className="filter" role="group" aria-label="Show alerts">
        {[["open", "Open"], ["reviewed", "Reviewed"], ["all", "All"]].map(([v, t]) => (
          <button key={v} aria-pressed={view === v} className={view === v ? "is-on" : ""} onClick={() => { setView(v); navigate("/workspace/alerts"); }}>
            {t} <span className="muted">{counts[v]}</span>
          </button>
        ))}
      </div>
      {error && <Failed error={error} retry={reload} />}
      {loading && !data ? <Loading what="Loading alerts" /> : (
        <div className="inbox">
          <ul className="inbox-list" aria-label="Alerts">
            {list.length === 0 && (
              <li className="empty">
                {counts.all === 0 ? <>No alerts yet. The watch reads the registers continuously; anything that affects payment appears here and in your channels.</> : <>No {view} alerts. Switch to All to see every alert.</>}
              </li>
            )}
            {list.map((a) => (
              <li key={a.id}>
                <Link to={"/workspace/alerts?a=" + a.id} className={"inbox-item" + (sel && a.id === sel.id ? " is-sel" : "")}>
                  <span className="ii-top"><b>{a.title}</b><Severity s={a.state === "reviewed" ? "Reviewed" : a.severity} /></span>
                  <span className="ii-co">{a.client || a.number}</span>
                  <span className="dt">{dateTimeOf(a.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <article className="inbox-detail" aria-live="polite">
            {!sel ? <p className="empty">{counts.all === 0 ? "When an alert arrives, its facts and sources show here." : "Choose an alert to see its detail."}</p> : (
              <>
                <p className="dt">{AGENT_NAME[sel.agent] || sel.agent}, alert {sel.id}</p>
                <h2 className="h-small">{sel.title}</h2>
                <p className="ii-co"><Link to={"/workspace/clients/" + sel.number} className="link">{sel.client || sel.number}</Link> <span className="mono muted">{sel.number}</span></p>
                <p className="body mt-s">{sel.summary}</p>
                <dl className="facts-tab">
                  {sel.facts.map(([k, v, s]) => <div key={k}><dt>{k}</dt><dd>{v}</dd><span className="src">{s}</span></div>)}
                </dl>
                {sel.next_step && <div className="next-step"><span className="dt">Suggested next step</span><p>{sel.next_step}</p></div>}
                <p className="dt mt-s">{sel.severity} alert, raised {dateTimeOf(sel.created_at)}.{sel.state === "reviewed" && sel.reviewed_by ? ` Reviewed by ${sel.reviewed_by}, ${dateTimeOf(sel.reviewed_at)}.` : ""}</p>
                <Notice>{note}</Notice>
                {act.error && <Notice signal>{act.error}</Notice>}
                <div className="actions actions-tight">
                  {can("manager") && (sel.state === "reviewed"
                    ? <button className="btn btn-line mt-0" disabled={act.busy} onClick={() => setState("open")}>Move back to open</button>
                    : <button className="btn" disabled={act.busy} onClick={() => setState("reviewed")}>Mark reviewed</button>)}
                  <Link to={"/workspace/clients/" + sel.number} className="link">Open company record</Link>
                </div>
                {can("manager") && (
                  <div className="inline-form inline-form-1 mt-l">
                    <div className="field">
                      <label htmlFor="share-to">Share this alert</label>
                      <select id="share-to" value={shareTo} onChange={(e) => setShareTo(e.target.value)} disabled={!chs.length}>
                        <option value="">{chs.length ? "Choose a channel" : "Add a channel in Agents first"}</option>
                        {chs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                    <button className="btn btn-line btn-sm" disabled={!shareTo || act.busy} onClick={share}>Share</button>
                  </div>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </Shell>
  );
}

/* ---------- Clients ---------- */
function useDebounced(v, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function LiveClients() {
  const can = useCan();
  const [q, setQ] = useState("");
  const [show, setShow] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(0);
  const dq = useDebounced(q);
  const path = `/api/ws/clients?q=${encodeURIComponent(dq)}&status=${show}&sort=${sort}&page=${page}&per=20`;
  const { data, error, loading, reload } = useApi(path);
  const [num, setNum] = useState("");
  const [note, setNote] = useState("");
  const act = useAction();
  const add = (e) => {
    e.preventDefault();
    const n = num.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(n)) return act.setError("Company numbers are 8 characters, for example 08812234. Search the register first if you only have a name: use Company checks.");
    act.run(async () => { const r = await api("POST", "/api/ws/clients", { number: n }); setNum(""); setNote(`${r.name} added. Its register record is being read now.`); reload(); });
  };
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <Shell title="Customers" crumbs={[["Customers"]]}>
      {data && total === 0 && !dq && show === "all" ? (
        <div className="ws-intro">
          <p className="body">No customers or suppliers watched yet. Upload a list and every company is matched to Companies House and watched from then on: you hear about administration, overdue accounts or a winding-up petition before the next invoice goes out.</p>
          <div className="actions"><Link to="/workspace/import" className="btn">Import customers and suppliers</Link></div>
        </div>
      ) : (
        <div className="toolbar">
          <div className="field field-inline">
            <label htmlFor="cq">Search by name or company number</label>
            <input id="cq" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="For example, Tarnbrook or 11420987" />
          </div>
          <div className="filter" role="group" aria-label="Show">
            {[["all", "All"], ["flagged", "Flagged"], ["clear", "No changes"]].map(([v, t]) => <button key={v} aria-pressed={show === v} className={show === v ? "is-on" : ""} onClick={() => { setShow(v); setPage(0); }}>{t}</button>)}
          </div>
        </div>
      )}
      {error && <Failed error={error} retry={reload} />}
      {loading && !data ? <Loading what="Loading customers" /> : data && (total > 0 || dq || show !== "all") && (
        <>
          <table className="ledger ws-table">
            <thead>
              <tr>
                <th><button className={"sort" + (sort === "name" ? " is-on" : "")} onClick={() => setSort("name")}>Company</button></th>
                <th><button className={"sort" + (sort === "number" ? " is-on" : "")} onClick={() => setSort("number")}>Company no.</button></th>
                <th className="hide-sm"><button className={"sort" + (sort === "latest" ? " is-on" : "")} onClick={() => setSort("latest")}>Latest finding</button></th>
                <th className="num">Watch</th>
              </tr>
            </thead>
            <tbody>
              {data.clients.length === 0 && <tr><td colSpan={4} className="empty">No companies match{dq ? ` "${dq}"` : ""}. Check the spelling or search by company number.</td></tr>}
              {data.clients.map((c) => (
                <tr key={c.number} className="click-row" onClick={() => navigate("/workspace/clients/" + c.number)}>
                  <td><Link to={"/workspace/clients/" + c.number} className="row-link" onClick={(e) => e.stopPropagation()}>{c.name}</Link></td>
                  <td className="mono">{c.number}</td>
                  <td className={"hide-sm" + (c.flagged ? " signal" : " muted")}>{c.latest_finding}</td>
                  <td className="num">{c.watching ? "On" : "Paused"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <span className="dt">{total} {total === 1 ? "company" : "companies"}, page {Math.min(page + 1, pages)} of {pages}</span>
            <div>
              <button className="btn btn-line btn-sm mt-0" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn btn-line btn-sm mt-0" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
      {can("manager") && (
        <form className="inline-form inline-form-1 mt-l" onSubmit={add} noValidate>
          <div className="field">
            <label htmlFor="add-no">Add one company by company number</label>
            <input id="add-no" className="input-s mono" value={num} onChange={(e) => setNum(e.target.value)} placeholder="08812234" maxLength={8} />
            <p className="hint">For a whole list, use <Link to="/workspace/import" className="link link-s">Import</Link>.</p>
          </div>
          <button className="btn btn-line btn-sm" type="submit" disabled={act.busy}>{act.busy ? "Adding…" : "Add and watch"}</button>
        </form>
      )}
      <Notice>{note}</Notice>
      {act.error && <Notice signal>{act.error}</Notice>}
    </Shell>
  );
}

export function LiveClient({ no }) {
  const { me } = useWs();
  const can = useCan();
  const { data, error, loading, reload } = useApi("/api/ws/clients/" + encodeURIComponent(no));
  const [edit, setEdit] = useState(null);
  const [brief, setBrief] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [note, setNote] = useState("");
  const act = useAction();
  if (error?.status === 404) {
    return (
      <Shell title="Client not found" crumbs={[["Customers", "/workspace/clients"], ["Not found"]]}>
        <p className="body">No company with number <span className="mono">{no}</span> is in this workspace.</p>
        <p className="more"><Link to="/workspace/clients" className="link">Back to all customers</Link></p>
      </Shell>
    );
  }
  if (!data) return <Shell title={no} crumbs={[["Customers", "/workspace/clients"], [no]]}>{error ? <Failed error={error} retry={reload} /> : <Loading what="Loading the client record" />}</Shell>;
  const { client: c, record: r, history, alerts } = data;
  const F = r?.fields || {};
  const officers = (F.officers?.value || []).length;
  const office = F.registered_office?.value || {};
  const open = alerts.filter((a) => a.state === "open");

  const toggleWatch = () => act.run(async () => { await api("PATCH", "/api/ws/clients/" + no, { watching: !c.watching }); setNote(c.watching ? "Watching paused for this client." : "Watching resumed."); reload(); });
  const runBrief = () => act.run(async () => { const res = await api("POST", "/api/ws/briefs", { input: no }); setBrief(briefFromApi(res.brief, me.org.name)); });
  const save = (e) => {
    e.preventDefault();
    const num = (v) => (v === "" ? null : Number(v));
    if (edit.next_invoice && !/^\d{4}-\d{2}-\d{2}$/.test(edit.next_invoice)) return act.setError("Enter the next invoice date as YYYY-MM-DD.");
    act.run(async () => {
      await api("PATCH", "/api/ws/clients/" + no, { users: num(edit.users), monthly_fee: num(edit.monthly_fee), next_invoice: edit.next_invoice || null });
      setEdit(null); setNote("Saved."); reload();
    });
  };
  const remove = () => act.run(async () => { await api("DELETE", "/api/ws/clients/" + no); navigate("/workspace/clients"); });

  return (
    <Shell title={c.name} crumbs={[["Customers", "/workspace/clients"], [c.name]]}>
      <div className="client-head">
        <span className="mono">{c.number}</span>
        <Severity s={open.length ? open[0].severity : "No open alerts"} />
        <span className="dt">{c.watching ? "Watched continuously." : "Watching paused."}</span>
      </div>
      <div className="grid-2">
        <div>
          <h2 className="h-sub">Register record</h2>
          {!r ? (
            <p className="body">Reading the register for this company. This usually takes under a minute after a company is added. <button className="link link-s" onClick={reload}>Refresh</button></p>
          ) : (
            <dl className="facts-tab">
              <div><dt>Status</dt><dd className={r.raw_status !== "active" ? "signal" : ""}>{r.status}</dd><span className="src">Companies House</span></div>
              <div><dt>Incorporated</dt><dd>{F.incorporated?.value ? dateOf(F.incorporated.value) : "Not recorded"}</dd><span className="src">Companies House</span></div>
              <div><dt>Industry</dt><dd>{(F.sic_codes?.value || []).length ? "SIC " + F.sic_codes.value.join(", ") : "Not recorded"}</dd><span className="src">Companies House</span></div>
              <div><dt>Accounts</dt><dd className={F.accounts_overdue?.value ? "signal" : ""}>{F.accounts_overdue?.value ? "Overdue" : F.accounts_next_due?.value ? "Next due " + dateOf(F.accounts_next_due.value) : "Not recorded"}</dd><span className="src">Companies House</span></div>
              <div><dt>Officers</dt><dd>{officers} {officers === 1 ? "director" : "directors"}</dd><span className="src">Companies House</span></div>
              <div><dt>Registered office</dt><dd>{[office.locality, office.postcode].filter(Boolean).join(", ") || "Not recorded"}</dd><span className="src">Companies House</span></div>
              <div><dt>Insolvency notices</dt><dd className={(F.insolvency_notices?.value || []).length ? "signal" : ""}>{(F.insolvency_notices?.value || []).length || "None in the last 12 months"}</dd><span className="src">The Gazette</span></div>
            </dl>
          )}
          <h2 className="h-sub mt-l">Your relationship</h2>
          {edit ? (
            <form onSubmit={save} noValidate>
              <dl className="facts-tab facts-edit">
                <div><dt><label htmlFor="e-users">Users supported</label></dt><dd><input id="e-users" inputMode="numeric" value={edit.users} onChange={(e) => setEdit({ ...edit, users: e.target.value.replace(/\D/g, "") })} /></dd></div>
                <div><dt><label htmlFor="e-fee">Monthly fee (£)</label></dt><dd><input id="e-fee" inputMode="decimal" value={edit.monthly_fee} onChange={(e) => setEdit({ ...edit, monthly_fee: e.target.value.replace(/[^\d.]/g, "") })} /></dd></div>
                <div><dt><label htmlFor="e-inv">Next invoice</label></dt><dd><input id="e-inv" placeholder="YYYY-MM-DD" value={edit.next_invoice} onChange={(e) => setEdit({ ...edit, next_invoice: e.target.value })} /></dd></div>
              </dl>
              <div className="row-actions" style={{ justifyContent: "flex-start", marginTop: 16 }}>
                <button className="btn btn-sm" type="submit" disabled={act.busy}>Save</button>
                <button className="btn btn-line btn-sm" type="button" onClick={() => setEdit(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <dl className="facts-tab">
                <div><dt>Customer since</dt><dd>{c.since || "Not recorded"}</dd><span className="src">Your list</span></div>
                <div><dt>Staff or seats</dt><dd>{c.users ?? "Not recorded"}</dd><span className="src">Your list</span></div>
                <div><dt>Monthly fee</dt><dd>{c.monthly_fee != null ? "£" + Number(c.monthly_fee).toLocaleString("en-GB") : "Not recorded"}</dd><span className="src">Your list</span></div>
                <div><dt>Next invoice</dt><dd>{c.next_invoice ? dateOf(c.next_invoice) : "Not recorded"}</dd><span className="src">Your list</span></div>
              </dl>
              {can("manager") && <p className="more"><button className="link link-s" onClick={() => setEdit({ users: c.users ?? "", monthly_fee: c.monthly_fee ?? "", next_invoice: c.next_invoice ?? "" })}>Edit</button></p>}
            </>
          )}
        </div>
        <div>
          <h2 className="h-sub">Register history</h2>
          {history.length === 0 ? <p className="body muted">No register changes since this company was added.</p> : (
            <ol className="history">
              {history.map((e, i) => (
                <li key={i}>
                  <span className={"tl-sq tl-sq-" + (e.alert ? (e.alert.severity === "Critical" ? "critical" : "review") : "none")} aria-hidden="true" />
                  <span className="dt">{dateOf(e.date)}</span>
                  <b className={e.alert?.severity === "Critical" ? "signal" : ""}>{e.alert ? e.alert.title : KIND_LABEL[e.kind] || e.kind}</b>
                  <span className="dt">{e.source}{e.alert ? ", alert sent" : ""}</span>
                </li>
              ))}
            </ol>
          )}
          {alerts.length > 0 && (
            <>
              <h2 className="h-sub mt-l">Alerts</h2>
              <ul className="rule-list">{alerts.map((a) => <li key={a.id}><Link to={"/workspace/alerts?a=" + a.id} className="link">{a.title}</Link> <span className="muted">{dateOf(a.created_at)}{a.state === "reviewed" ? ", reviewed" : ""}</span></li>)}</ul>
            </>
          )}
        </div>
      </div>
      <Notice>{note}</Notice>
      {act.error && <Notice signal>{act.error}</Notice>}
      <div className="actions actions-tight">
        {can("manager") && <button className="btn" disabled={act.busy} onClick={brief ? () => setBrief(null) : runBrief}>{brief ? "Hide brief" : act.busy ? "Checking the registers…" : "Generate a brief"}</button>}
        {can("manager") && <button className="btn btn-line mt-0" disabled={act.busy} onClick={toggleWatch}>{c.watching ? "Pause watching" : "Resume watching"}</button>}
        {can("manager") && (confirmRemove
          ? <><button className="btn btn-line mt-0" disabled={act.busy} onClick={remove}>Remove {c.name}</button><button className="link link-s" onClick={() => setConfirmRemove(false)}>Keep it</button></>
          : <button className="link link-s" onClick={() => setConfirmRemove(true)}>Stop watching and remove</button>)}
      </div>
      {brief && <div className="mt-l"><Brief sample={brief} /></div>}
    </Shell>
  );
}

/* ---------- New-client check ---------- */
export function LiveCheck() {
  const { me } = useWs();
  const can = useCan();
  const { query } = useRoute();
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const list = useApi("/api/ws/briefs");
  const saved = useApi(query.b ? "/api/ws/briefs/" + query.b : null);
  const act = useAction();
  const check = (text) => act.run(async () => {
    const res = await api("POST", "/api/ws/briefs", { input: text });
    setResult(briefFromApi(res.brief, me.org.name));
    list.reload();
    if (query.b) navigate("/workspace/check");
  });
  const submit = (e) => {
    e.preventDefault();
    if (input.trim().length < 2) return act.setError("Type a company name, number, website or a line from an invoice.");
    check(input.trim());
  };
  const shown = query.b && saved.data ? briefFromApi(saved.data.brief, me.org.name) : result;
  return (
    <Shell title="Company checks" crumbs={[["Company checks"]]}>
      <p className="body ws-intro">Type what you have: a name, a company number, a website, or a line from an invoice or email signature. The brief is matched, checked against every register and kept here. You can also email the name to your check address.</p>
      {can("manager") ? (
        <form className="inline-form inline-form-1" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="ck-in">Company to check</label>
            <input id="ck-in" value={input} onChange={(e) => setInput(e.target.value)} placeholder="For example, Harlow Vale Studios, Manchester M4" />
          </div>
          <button className="btn btn-sm" type="submit" disabled={act.busy}>{act.busy ? "Checking…" : "Check"}</button>
        </form>
      ) : <Notice>Viewers can read briefs. Ask a manager or owner to run a new check.</Notice>}
      {act.error && <Notice signal>{act.error}</Notice>}
      {shown && <div className="mt-l"><Brief sample={shown} busy={act.busy} onPick={can("manager") ? (n) => { setInput(n); check(n); } : undefined} /></div>}
      <h2 className="h-sub mt-l">Recent briefs</h2>
      {list.loading && !list.data ? <Loading /> : (
        <table className="ledger">
          <thead><tr><th>Asked for</th><th>Company no.</th><th className="num">When</th></tr></thead>
          <tbody>
            {(list.data?.briefs || []).length === 0 && <tr><td colSpan={3} className="empty">No briefs yet.</td></tr>}
            {(list.data?.briefs || []).map((b) => (
              <tr key={b.id} className="click-row" onClick={() => navigate("/workspace/check?b=" + b.id)}>
                <td><Link to={"/workspace/check?b=" + b.id} className="row-link" onClick={(e) => e.stopPropagation()}>{b.input}</Link></td>
                <td className="mono">{b.number || "Not matched"}</td>
                <td className="num dt">{dateTimeOf(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

/* ---------- Import ---------- */
export function LiveImport() {
  const can = useCan();
  const { query } = useRoute();
  const id = query.id;
  const [file, setFile] = useState(null);
  const act = useAction();
  const imp = useApi(id ? "/api/ws/imports/" + id : null);
  const [choices, setChoices] = useState({});
  const [done, setDone] = useState("");
  const busyStatus = imp.data && ["queued", "matching"].includes(imp.data.status);
  useEffect(() => {
    if (!busyStatus) return;
    const t = setInterval(() => imp.reload(), 1500);
    return () => clearInterval(t);
  }, [busyStatus, imp.reload]);
  const upload = (e) => {
    e.preventDefault();
    if (!file) return act.setError("Choose a CSV or Excel file first.");
    act.run(async () => {
      const fd = new FormData(); fd.append("file", file);
      const r = await api("POST", "/api/ws/imports", fd);
      setChoices({}); setDone("");
      navigate("/workspace/import?id=" + r.id);
    });
  };
  const confirm = () => act.run(async () => {
    const list = Object.entries(choices).map(([row, number]) => ({ row: Number(row), number: number || null }));
    const r = await api("POST", `/api/ws/imports/${id}/confirm`, { choices: list });
    setChoices({});
    setDone(`${r.added} ${r.added === 1 ? "company" : "companies"} added.`);
    imp.reload();
  });
  const d = imp.data;
  const toConfirm = (d?.rows || []).filter((r) => r.confidence === "confirm");
  const unmatched = (d?.rows || []).filter((r) => r.confidence === "none");
  return (
    <Shell title="Import customers" crumbs={[["Customers", "/workspace/clients"], ["Import"]]}>
      {!can("manager") ? <Notice>Viewers can't import. Ask a manager or owner.</Notice> : (
        <>
          <p className="body ws-intro">Upload a customer or supplier list from your accounts software or a spreadsheet. One column of company names is enough; company numbers, postcodes, monthly value and next invoice date help. Each row is matched to the register. Anything uncertain waits for you to confirm.</p>
          <form className="inline-form inline-form-1" onSubmit={upload} noValidate>
            <div className="field">
              <span className="flabel">Customer or supplier list</span>
              <label className={"file" + (file ? " has-file" : "")} htmlFor="imp-file">
                <span>{file ? file.name : "Choose a CSV or Excel file"}</span>
                <span className="file-btn">{file ? "Change" : "Browse"}</span>
                <input id="imp-file" type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files[0] || null)} />
              </label>
            </div>
            <button className="btn btn-sm" type="submit" disabled={act.busy}>{act.busy ? "Uploading…" : "Upload and match"}</button>
          </form>
        </>
      )}
      {act.error && <Notice signal>{act.error}</Notice>}
      {id && imp.error && <Failed error={imp.error} retry={imp.reload} />}
      {d && (
        <>
          <div className="stat-row mt-l">
            <div><span className="dt">Rows</span><b>{d.total ?? "…"}</b></div>
            <div><span className="dt">Matched</span><b>{d.matched ?? 0}</b></div>
            <div><span className="dt">For you to confirm</span><b>{d.to_confirm ?? 0}</b></div>
            <div><span className="dt">Not on the register</span><b>{d.unmatched ?? 0}</b></div>
          </div>
          {busyStatus && <Loading what={d.status === "queued" ? "Reading the file" : "Matching against the register"} />}
          <Notice>{done}</Notice>
          {d.status === "done" && !busyStatus && <Notice>Import complete. Matched companies are now watched. <Link to="/workspace/clients" className="link link-s">See your customers</Link></Notice>}
          {toConfirm.length > 0 && !busyStatus && (
            <>
              <h2 className="h-sub mt-l">Confirm these matches</h2>
              <p className="body ws-intro">More than one company could be meant. Choose the right one, or leave it out. Nothing is watched until you confirm.</p>
              {toConfirm.map((r) => (
                <fieldset key={r.row} className="cand">
                  <legend className="cand-in">Row {r.row}: {r.input}</legend>
                  <ul className="checks">
                    {r.candidates.map((c) => (
                      <li key={c.number}>
                        <label className="check">
                          <input type="radio" name={"row-" + r.row} checked={choices[r.row] === c.number} onChange={() => setChoices({ ...choices, [r.row]: c.number })} />
                          <span className="box" aria-hidden="true" />
                          <span>{c.name} <span className="mono muted">{c.number}</span> <span className="muted">{[c.status, c.postcode].filter(Boolean).join(", ")}</span></span>
                        </label>
                      </li>
                    ))}
                    <li>
                      <label className="check">
                        <input type="radio" name={"row-" + r.row} checked={choices[r.row] === ""} onChange={() => setChoices({ ...choices, [r.row]: "" })} />
                        <span className="box" aria-hidden="true" />
                        <span>None of these. Leave it out.</span>
                      </label>
                    </li>
                  </ul>
                </fieldset>
              ))}
              <div className="actions actions-tight">
                <button className="btn" disabled={!Object.keys(choices).length || act.busy} onClick={confirm}>Confirm {Object.keys(choices).length || ""} {Object.keys(choices).length === 1 ? "choice" : "choices"}</button>
              </div>
            </>
          )}
          {unmatched.length > 0 && !busyStatus && (
            <>
              <h2 className="h-sub mt-l">Not found on the register</h2>
              <p className="body ws-intro">Usually sole traders or partnerships, which aren't on Companies House. Add a company number to the file and upload again if one of these is a limited company.</p>
              <ul className="rule-list">{unmatched.map((r) => <li key={r.row}>Row {r.row}: {r.input}</li>)}</ul>
            </>
          )}
        </>
      )}
    </Shell>
  );
}

/* ---------- Prospects ---------- */
const thisMonth = () => new Date().toISOString().slice(0, 7);
function lastMonths(n) {
  const out = []; const d = new Date();
  for (let i = 0; i < n; i++) { out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7)); }
  return out;
}
const monthName = (m) => new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function LiveProspects() {
  const { me, refreshMe } = useWs();
  const can = useCan();
  const o = me.org;
  const [sel, setSel] = useState(() => new Set(o.prospect_districts || []));
  const [other, setOther] = useState(() => (o.prospect_districts || []).filter((d) => !DISTRICTS.includes(d)).join(", "));
  const [sic, setSic] = useState(() => new Set(o.prospect_sic || []));
  const [age, setAge] = useState(String(o.prospect_min_age ?? 3));
  const [month, setMonth] = useState(thisMonth());
  const [note, setNote] = useState("");
  const act = useAction();
  const districts = useMemo(() => {
    const extra = other.toUpperCase().split(/[\s,]+/).filter((d) => /^[A-Z]{1,2}\d{1,2}[A-Z]?$/.test(d));
    return [...new Set([...[...sel].filter((d) => DISTRICTS.includes(d)), ...extra])];
  }, [sel, other]);
  const q = useDebounced(`districts=${districts.join(",")}&sic=${[...sic].join(",")}&age=${age}`, 400);
  const preview = useApi(districts.length && sic.size ? "/api/ws/prospects/preview?" + q : null);
  const agents = useApi("/api/ws/agents");
  const on = agents.data?.agents.find((a) => a.key === "prospect")?.on;
  const toggleSic = (c) => { const s = new Set(sic); s.has(c) ? s.delete(c) : s.add(c); setSic(s); };
  const save = () => act.run(async () => {
    await api("PATCH", "/api/ws/org", { prospect_districts: districts, prospect_sic: [...sic], prospect_min_age: Number(age) });
    await refreshMe();
    setNote("Saved. Next month's list uses these settings.");
  });
  const get = () => act.run(async () => {
    try { await download(`/api/ws/prospects/file?month=${month}`, `prospects-${month}.csv`); }
    catch (e) { if (e.status === 404) throw new Error(`No list has been built for ${monthName(month)}. Lists are built on the first working day of each month while the lead finder is running.`); throw e; }
  });
  return (
    <Shell title="Lead lists" crumbs={[["Lead lists"]]}>
      {agents.data && !on && <Notice>The lead finder isn't running, so no monthly list is built. {can("manager") ? <Link to="/workspace/agents/new?t=lead-finder" className="link link-s">Hire the lead finder</Link> : "Ask a manager to hire it."}</Notice>}
      <div className="grid-2">
        <div className="vis">
          <div className="vis-head"><span className="vis-title">Districts</span><span className="vis-sub">{districts.length} chosen</span></div>
          <DistrictGrid sel={sel} setSel={setSel} />
          <div className="field mt-s">
            <label htmlFor="pr-other">Other postcode districts</label>
            <input id="pr-other" className="input-s" value={other} onChange={(e) => setOther(e.target.value)} placeholder="For example, SK4, BL1, OL1" />
          </div>
        </div>
        <div>
          <div className="vis">
            <div className="vis-head"><span className="vis-title">Industries</span></div>
            <ul className="checks">
              {SIC_GROUPS.map(([c, n]) => (
                <li key={c}><label className="check"><input type="checkbox" checked={sic.has(c)} onChange={() => toggleSic(c)} /><span className="box" aria-hidden="true" /><span>{n} <span className="muted">SIC {c}</span></span></label></li>
              ))}
            </ul>
          </div>
          <div className="vis mt-l">
            <div className="vis-head"><span className="vis-title">Minimum company age</span></div>
            <div className="filter" role="radiogroup" aria-label="Minimum company age">
              {["1", "3", "5", "10"].map((a) => <button key={a} role="radio" aria-checked={age === a} className={age === a ? "is-on" : ""} onClick={() => setAge(a)}>{a} {a === "1" ? "year" : "years"}</button>)}
            </div>
          </div>
          {can("owner") && <button className="btn mt-l" disabled={act.busy || !districts.length || !sic.size} onClick={save}>Save these settings</button>}
        </div>
      </div>
      <Notice>{note}</Notice>
      {act.error && <Notice signal>{act.error}</Notice>}
      <div className="vis mt-l">
        <div className="vis-head">
          <span className="vis-title">Preview from the register</span>
          <span className="vis-sub">{preview.data ? `${preview.data.rows.length}${preview.data.rows.length === 50 ? "+" : ""} matching, index of ${preview.data.index_size.toLocaleString("en-GB")} companies${preview.data.index_month ? ", loaded " + monthName(preview.data.index_month) : ""}` : ""}</span>
        </div>
        {!districts.length || !sic.size ? <p className="empty">Choose at least one district and one industry.</p> : preview.error ? <Failed error={preview.error} retry={preview.reload} /> : !preview.data ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Company</th><th>Company no.</th><th>District</th><th className="hide-sm">SIC</th><th className="num">Incorporated</th></tr></thead>
            <tbody>
              {preview.data.rows.length === 0 && <tr><td colSpan={5} className="empty">{preview.data.index_size ? "No active companies match. Add districts or industries to widen the list." : "The company index hasn't been loaded yet. It's refreshed from the Companies House monthly snapshot."}</td></tr>}
              {preview.data.rows.map((p) => <tr key={p.number}><td>{p.name}</td><td className="mono">{p.number}</td><td>{p.district}</td><td className="hide-sm">{p.sic}</td><td className="num">{p.incorporated ? p.incorporated.slice(0, 4) : ""}</td></tr>)}
            </tbody>
          </table>
        )}
      </div>
      <div className="inline-form inline-form-1 mt-l">
        <div className="field">
          <label htmlFor="pr-month">Download a monthly list</label>
          <select id="pr-month" value={month} onChange={(e) => setMonth(e.target.value)}>{lastMonths(6).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>
        </div>
        <button className="btn btn-line btn-sm" disabled={act.busy} onClick={get}>Download CSV</button>
      </div>
    </Shell>
  );
}

/* ---------- Agents and channels ---------- */
