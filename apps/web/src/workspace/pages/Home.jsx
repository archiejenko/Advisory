// Home: the command centre. Dana should be able to run her day from here alone, on her phone, in five minutes:
// outcomes first, then the one decision queue, then leaks, today's work and what the team has done.
import React, { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "../../router.jsx";
import { Icon, toast, useStore } from "../core.jsx";
import { Avatar, Button, Dialog, EmptyState, MetricTile, RecordLink, StatusChip, delta } from "../ui.jsx";
import { DecisionCard } from "../DecisionCard.jsx";
import { acceptTrust, approveMany, dismissTrust, fixLeak, undo, undoTokenForEvent } from "../demo/store";
import { briefing } from "../demo/ask";
import * as q from "../demo/selectors";
import { clock, mins, plural, pounds, relative, ukDay, ukTime } from "../demo/format";
import { speakText, stopSpeaking } from "../../voice.js";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function Outcomes() {
  const s = useStore();
  const o = q.outcomes(s);
  const name = q.person(s, s.org.owner).name.split(" ")[0];
  const [brief, setBrief] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  const play = async () => { if (playing) { stopSpeaking(); setPlaying(false); return; } setPlaying(true); try { await speakText(briefing(s)); } catch { /* text is on screen */ } finally { setPlaying(false); } };
  return (
    <section aria-labelledby="w-greet">
      <div className="w-home-top">
        <div>
          <h1 id="w-greet" className="w-greet">{greeting()}, {name}.</h1>
          <p className="w-outcome">
            This week your team collected <Link to="/workspace/money/invoices?f=paid">{pounds(o.collected)}</Link>{o.responseMins > 0 ? ", " : " and "}saved <Link to="/workspace/team">{o.hoursSaved} hours</Link>{o.responseMins > 0 && <>, and answered enquiries in <Link to="/workspace/customers/inbox">{mins(o.responseMins)}</Link> on average</>}.
          </p>
        </div>
        <Button icon="Volume2" onClick={() => setBrief(true)}>Brief me</Button>
      </div>
      <div className="w-metrics is-scroll" aria-label="This week compared with the same week last month">
        <MetricTile label="Collected this week" value={pounds(o.collected)} to="/workspace/money/invoices?f=paid" delta={delta(o.collected, o.collectedBefore)} />
        <MetricTile label="Time saved by agents" value={`${o.hoursSaved} h`} to="/workspace/team" delta={delta(o.hoursSaved, o.hoursSavedBefore)} />
        <MetricTile label="Average reply time" value={o.responseMins ? mins(o.responseMins) : "None yet"} to="/workspace/customers/inbox" delta={delta(o.responseMins, o.responseMinsBefore, { higherIsBetter: false })} />
      </div>
      <Dialog open={brief} onClose={() => { stopSpeaking(); setPlaying(false); setBrief(false); }} title="Your weekly briefing">
        <p style={{ fontSize: 17, lineHeight: 1.6 }}>{briefing(s)}</p>
        <div className="w-row" style={{ marginTop: 16 }}><Button variant="primary" icon={playing ? "VolumeX" : "Volume2"} onClick={play}>{playing ? "Stop" : "Play it"}</Button><span className="w-sub">Written by Bea, your Briefing agent, from this week's records.</span></div>
      </Dialog>
    </section>
  );
}

function TrustPrompt({ t }) {
  const s = useStore();
  const a = q.agent(s, t.agentId);
  const verb = q.TRUST_COPY[t.type];
  return (
    <div className="w-trust" role="note">
      <div className="w-row"><Icon name="Sparkles" size={18} /><b>Let {a.roleName} {verb} under {pounds(t.limit)} without asking?</b></div>
      <p>You've approved {a.name}'s last {t.streak} {verb.split(" ").pop()} without changing a word. Anything over {pounds(t.limit)} will still come to you. You can change this on {a.name}'s page at any time.</p>
      <div className="w-row" style={{ marginTop: 12 }}>
        <Button variant="primary" size="sm" icon="Check" onClick={() => { const tok = acceptTrust(t.agentId, t.type, t.limit); toast(`${a.name} will ${verb} under ${pounds(t.limit)} on their own.`, { undo: tok }); }}>Yes, let {a.name} do it</Button>
        <Button size="sm" variant="ghost" onClick={() => dismissTrust(t.key)}>Keep asking me</Button>
      </div>
    </div>
  );
}

function NeedsYou() {
  const s = useStore();
  const { query } = useRoute();
  const routine = q.routine(s), review = q.review(s), all = [...routine, ...review];
  const trust = q.trustPrompts(s);
  const [focus, setFocus] = useState(null);
  const refs = useRef({});
  useEffect(() => {
    if (query.decision && refs.current[query.decision]) { refs.current[query.decision].focus(); refs.current[query.decision].scrollIntoView({ block: "center" }); }
  }, [query.decision]);
  const onKey = (e) => {
    if (e.target.matches("input,textarea") || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k !== "j" && k !== "k") return;
    e.preventDefault();
    const i = all.findIndex((a) => a.id === focus);
    const next = all[Math.max(0, Math.min(all.length - 1, i < 0 ? 0 : i + (k === "j" ? 1 : -1)))];
    if (next) refs.current[next.id]?.focus();
  };
  // When a card goes, keep the keyboard on the next one.
  useEffect(() => { if (focus && !all.some((a) => a.id === focus) && all[0] && document.activeElement === document.body) refs.current[all[0].id]?.focus(); });
  const card = (a) => <DecisionCard key={a.id} a={a} focused={focus === a.id} onFocus={() => setFocus(a.id)} innerRef={(el) => { refs.current[a.id] = el; }} />;
  return (
    <section className="w-section" aria-labelledby="w-ny" onKeyDown={onKey}>
      <div className="w-section-h">
        <h2 id="w-ny">Needs you</h2>{all.length > 0 && <span className="w-count" data-testid="needs-you-count">{all.length}</span>}
        <span className="w-sp" />
        <span className="w-sub w-hide-m"><kbd className="w-kbd">J</kbd> <kbd className="w-kbd">K</kbd> to move · <kbd className="w-kbd">A</kbd> approve · <kbd className="w-kbd">E</kbd> edit · <kbd className="w-kbd">R</kbd> reject</span>
      </div>
      <p className="w-sub w-only-m" style={{ marginBottom: 12 }}>Swipe right to approve, left to reject. Tap the draft to edit.</p>
      {trust.map((t) => <div key={t.key} style={{ marginBottom: 16 }}><TrustPrompt t={t} /></div>)}
      {!all.length && <div className="w-card"><EmptyState icon="CircleCheck" title="Nothing needs you" body="When an agent wants to send, pay or book something, it waits here for your OK." action={<Button to="/workspace/team" icon="Bot">See what your agents did</Button>} /></div>}
      {routine.length > 0 && (
        <div className="w-queue-group">
          <div className="w-queue-gh"><h3>Routine</h3><span className="w-sub">{plural(routine.length, "item")} your agents do every week</span><span className="w-sp" />
            <Button variant="primary" icon="Check" onClick={() => { const tok = approveMany(routine.map((a) => a.id)); toast(`Approved ${plural(routine.length, "routine item")}.`, { undo: tok }); }}>Approve all {routine.length} routine</Button>
          </div>
          <div className="w-queue-list">{routine.map(card)}</div>
        </div>
      )}
      {review.length > 0 && (
        <div className="w-queue-group">
          <div className="w-queue-gh"><h3>Needs a look</h3><span className="w-sub">{plural(review.length, "item")} worth reading first</span></div>
          <div className="w-queue-list">{review.map(card)}</div>
        </div>
      )}
    </section>
  );
}

function Leaks() {
  const s = useStore();
  const list = q.leaks(s);
  if (!list.length) return null;
  return (
    <section className="w-section" aria-labelledby="w-leaks">
      <div className="w-section-h"><h2 id="w-leaks">Leaks</h2><span className="w-sub">Money or time slipping away</span></div>
      <div className="w-grid w-grid-2">
        {list.map((l) => (
          <div key={l.id} className="w-leak">
            <span className={"w-leak-i " + l.tone}><Icon name={l.tone === "risk" ? "AlertTriangle" : "Clock"} size={18} /></span>
            <div style={{ minWidth: 0 }}>
              <b>{l.title}</b>
              <p>{l.reason}</p>
              <div className="w-row">
                <Button size="sm" icon="Zap" onClick={() => { const tok = fixLeak(l.id); toast(`${l.fix}: done.`, { undo: tok }); }}>{l.fix}</Button>
                <RecordLink refTo={l.ref} className="w-link">See why</RecordLink>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Today() {
  const s = useStore();
  const jobs = q.jobsToday(s);
  const crew = q.crewToday(s);
  const diary = q.diaryAhead(s, 7);
  return (
    <section className="w-section" aria-labelledby="w-today">
      <div className="w-section-h"><h2 id="w-today">Today</h2><span className="w-sub">{plural(jobs.length, "job")}{s.people.some((p) => p.team === "crew") ? ` · ${crew.length} of ${s.people.filter((p) => p.team === "crew").length} crew out` : ""}</span><span className="w-sp" /><Link to="/workspace/work/jobs?view=calendar" className="w-link">Calendar</Link></div>
      {jobs.length ? (
        <ul className="w-today">
          {jobs.map((j) => (
            <li key={j.id}>
              <time>{clock(j.schedule.time)}</time>
              <div style={{ minWidth: 0 }}><RecordLink refTo={{ type: "job", id: j.id }}>{q.company(s, j.companyId).short}</RecordLink><div className="w-sub">{j.title}</div></div>
              <span className="w-crew" aria-label={"Crew: " + j.crewIds.map((p) => q.person(s, p)?.name).join(", ")}>{j.crewIds.map((p) => <Avatar key={p} actor={{ kind: "person", id: p }} />)}</span>
            </li>
          ))}
        </ul>
      ) : <div className="w-card"><EmptyState icon="CalendarDays" title="No cleans today" body="Booked jobs and site visits for the day show here, with who's on them." action={<Button to="/workspace/work/jobs">See the week</Button>} /></div>}
      {diary.length > 0 && (
        <div className="w-card" style={{ marginTop: 12 }}>
          <p className="w-sub" style={{ marginBottom: 8 }}>Diary, next 7 days</p>
          <ul className="w-related">{diary.map((d) => <li key={d.id}><span><b style={{ fontWeight: 500 }}>{d.title}</b><span className="w-sub" style={{ display: "block" }}>{ukDay(d.at)}, {ukTime(d.at)}{d.with && <> · <RecordLink refTo={d.with} /></>}</span></span>{d.title.includes("to confirm") && <StatusChip tone="attn">To confirm</StatusChip>}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function Activity() {
  const s = useStore();
  const list = s.activity.slice(0, 8);
  return (
    <section className="w-section" aria-labelledby="w-act">
      <div className="w-section-h"><h2 id="w-act">Team activity</h2><span className="w-sp" /><Link to="/workspace/team" className="w-link">Everyone</Link></div>
      <div className="w-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <ul className="w-feed">
          {list.map((e) => {
            const tok = e.undoable ? undoTokenForEvent(e.id) : null;
            return (
              <li key={e.id}>
                <Avatar actor={e.actor} />
                <div className="w-feed-b">
                  <p><b>{q.actorName(s, e.actor)}</b>{e.actor.kind === "agent" && <span className="sr-only"> (agent)</span>} {e.verb}</p>
                  <p className="w-feed-m">{e.actor.kind === "agent" && <StatusChip tone="agent">Agent</StatusChip>} {relative(e.at, s.now > e.at ? s.now : undefined)}{e.linkedRecord && <> · <RecordLink refTo={e.linkedRecord} /></>}</p>
                </div>
                {tok && <Button size="sm" icon="Undo2" onClick={() => { undo(tok); toast("Undone."); }}>Undo</Button>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function WatchBanner() {
  const s = useStore();
  const until = s.prefs.watchUntil;
  if (!until || Date.parse(until) < Date.now()) return null;
  return (
    <div className="w-trust" role="status" style={{ marginBottom: 24 }}>
      <div className="w-row"><Icon name="Eye" size={18} /><b>Watch mode until {ukDay(until)}, {ukTime(until)}</b></div>
      <p>For 48 hours your team shows you what it would have done, and sends nothing. Approve or reject each draft below so it learns how you like things done.</p>
    </div>
  );
}

export function Home() {
  const s = useStore();
  useEffect(() => { document.title = `Home | ${s.org.name}`; }, [s.org.name]);
  return (
    <div>
      <WatchBanner />
      <Outcomes />
      <div className="w-cols">
        <div><NeedsYou /><Leaks /></div>
        <div><Today /><Activity /></div>
      </div>
    </div>
  );
}
