// Team: people and agents on one roster, team chat (channels where agents answer and post action cards), and the
// AI Team (the Floor), kept as it was and shown inside the workspace.
import React, { useEffect, useRef, useState } from "react";
import { Link, navigate, useRoute } from "../../router.jsx";
import { Icon, hrefFor, useStore } from "../core.jsx";
import { AgentBadge, Avatar, Button, EmptyState, MetricTile, StatusChip } from "../ui.jsx";
import { HubFrame, useTab } from "./Hub.jsx";
import { useCredits } from "../credits.js";
import { sendChat } from "../demo/store";
import * as q from "../demo/selectors";
import { mins, pct, relative } from "../demo/format";
import { WsCtx, useWs } from "../../layout.jsx";
import { DEMO_ME } from "../../demo.js";
import { setDemo } from "../../api.js";
import { EmbedCtx } from "../../pages/Live.jsx";
import { FloorHome, FloorView } from "../../pages/Floor.jsx";

function Roster() {
  const s = useStore();
  return (
    <>
      <h2 style={{ fontSize: 17, margin: "4px 0 12px" }}>People <span className="w-sub">{s.people.length}</span></h2>
      <div className="w-roster">
        {s.people.map((p) => {
          const open = q.openTasks(s).filter((t) => t.assignee.id === p.id).length;
          const jobs = q.jobsToday(s).filter((j) => j.crewIds.includes(p.id));
          return (
            <Link key={p.id} to={hrefFor({ type: "person", id: p.id })} className="w-person">
              <Avatar actor={{ kind: "person", id: p.id }} size="lg" />
              <span style={{ minWidth: 0 }}><b>{p.name}</b><small>{p.role}</small><small style={{ display: "block" }}>{jobs.length ? `On ${jobs.map((j) => q.company(s, j.companyId).short).join(", ")} today` : open ? `${open} open ${open === 1 ? "task" : "tasks"}` : "Nothing waiting"}</small></span>
            </Link>
          );
        })}
      </div>
      <h2 style={{ fontSize: 17, margin: "28px 0 12px" }}>Agents <span className="w-sub">{s.agents.length}</span></h2>
      <div className="w-roster">
        {s.agents.map((a) => {
          const st = q.agentStats(s, a.id);
          return (
            <Link key={a.id} to={hrefFor({ type: "agent", id: a.id })} className="w-person">
              <Avatar actor={{ kind: "agent", id: a.id }} size="lg" />
              <span style={{ minWidth: 0 }}><b>{a.name} <span className="w-agent-role" style={{ fontWeight: 400 }}>· {a.roleName}</span></b><small>{s.paused ? "Paused" : `${st.actionsThisWeek} actions this week · ${mins(st.minutesSavedThisWeek)} saved`}</small>{st.waiting > 0 && <small style={{ display: "block", color: "var(--status-attn)" }}>{st.waiting} waiting for you</small>}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Chat() {
  const s = useStore();
  const { query, path } = useRoute();
  const ch = s.channels.find((c) => c.name === (query.c || "general")) || s.channels[0];
  const msgs = s.chat.filter((m) => m.channelId === ch.id).sort((a, b) => a.at.localeCompare(b.at));
  const [text, setText] = useState("");
  const log = useRef(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [msgs.length, ch.id]);
  const send = (e) => { e.preventDefault(); sendChat(ch.id, text); setText(""); };
  return (
    <div className="w-chat">
      <nav className="w-pane w-chat-list" aria-label="Channels" style={{ padding: 8 }}>
        {s.channels.map((c) => (
          <button key={c.id} type="button" className="w-chat-ch" aria-current={c.id === ch.id} onClick={() => navigate(path + "?c=" + c.name)}><Icon name="Hash" size={16} />{c.name}</button>
        ))}
      </nav>
      <section className="w-pane" aria-label={"#" + ch.name}>
        <div className="w-pane-h"><b>#{ch.name}</b><span className="w-sub">{ch.purpose}</span></div>
        <div className="w-chat-log" ref={log} aria-live="polite">
          {msgs.map((m) => (
            <div key={m.id} className="w-chat-m">
              <Avatar actor={m.author} />
              <div style={{ minWidth: 0 }}>
                <p className="w-msg-m">{m.author.kind === "agent" ? <AgentBadge agentId={m.author.id} /> : <b>{q.actorName(s, m.author)}</b>} <span>{relative(m.at, s.now > m.at ? s.now : undefined)}</span></p>
                <p>{m.body}</p>
                {m.card && <Link to={hrefFor(m.card.ref, s)} className="w-acard"><Icon name="ArrowUpRight" size={16} />{m.card.label}</Link>}
              </div>
            </div>
          ))}
          {!msgs.length && <EmptyState icon="MessagesSquare" title={`Nothing in #${ch.name} yet`} body="Messages from people and agents appear here. Mention an agent with @ to ask it something." />}
        </div>
        <form className="w-compose" onSubmit={send}>
          <label htmlFor="w-chat-in" className="sr-only">Message #{ch.name}</label>
          <input id="w-chat-in" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message #${ch.name}. Try @Fern what do we owe this week?`} />
          <Button type="submit" variant="primary" icon="Send" aria-label="Send" disabled={!text.trim()} />
        </form>
      </section>
    </div>
  );
}

/** The Floor, unchanged, answered from the demo API (which reads the workspace store). */
function Floor() {
  const ctx = useWs();
  const { path } = useRoute();
  const id = path.match(/^\/(?:floor|workspace\/team\/floor)\/([^/]+)$/)?.[1];
  setDemo(true);
  return (
    <WsCtx.Provider value={{ ...ctx, me: DEMO_ME }}>
      <EmbedCtx.Provider value={true}>{id ? <FloorView id={id} /> : <FloorHome />}</EmbedCtx.Provider>
    </WsCtx.Provider>
  );
}

const VIEWS = { roster: Roster, chat: Chat, floor: Floor };

export function Team({ tab }) {
  const s = useStore();
  const app = useTab("team", tab);
  const V = app && VIEWS[app.key];
  const rate = q.approvalRate(s);
  const credits = useCredits();
  const metrics = [
    <MetricTile key="p" label="People" value={q.peopleCount(s)} to="/workspace/team/roster" sub={`${q.crewToday(s).length} on jobs today`} />,
    <MetricTile key="a" label="Agents" value={q.agentCount(s)} to="/workspace/team/roster" sub={s.paused ? "All paused" : "All working"} tone={s.paused ? "attn" : undefined} />,
    <MetricTile key="w" label="Agent actions this week" value={q.actionsThisWeek(s)} to="/workspace" sub="Every one logged on its record" />,
    <MetricTile key="c" label="Credits left this month" value={credits ? credits.left.toLocaleString("en-GB") : "…"} to="/workspace/setup/usage" sub={credits ? `of ${credits.plan.toLocaleString("en-GB")}, used ${credits.used.toLocaleString("en-GB")}` : "Usage and credits"} tone={credits?.paused ? "risk" : undefined} />,
    <MetricTile key="r" label="Drafts you approve" value={pct(rate)} sub="Of everything decided" />,
  ];
  return <HubFrame hub="team" tab={app?.key} metrics={metrics}>{V ? <V /> : null}</HubFrame>;
}
export { StatusChip };
