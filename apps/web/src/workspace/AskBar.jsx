// Ask: ⌘K on desktop, the search button (with voice) on a phone. Go to any record or page, or ask a question in plain
// English and the agent that owns the subject answers from the records.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../router.jsx";
import { Icon, hrefFor, useStore } from "./core.jsx";
import { AgentBadge, Button } from "./ui.jsx";
import { answer, routeAgent } from "./demo/ask";
import { search, title } from "./demo/selectors";
import { HUBS, appName, shellApps } from "./demo/catalogue";
import { useVoice, voiceSupported, speakText, stopSpeaking } from "../voice.js";

const QUESTION = /\?\s*$|^(what|how|who|when|where|why|which|do|does|did|is|are|can|could|should|will|have|has|any|show me|tell me)\b/i;
const SUGGEST = ["Who owes us money?", "What do we owe this week?", "What's on today?", "How's the pipeline looking?"];

export function AskButton({ onOpen, compact }) {
  if (compact) return <Button variant="ghost" icon="Search" onClick={onOpen} aria-label="Ask or search" className="w-only-m" />;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button type="button" className="w-ask" onClick={onOpen} aria-label="Ask or search (Command K)">
      <Icon name="Search" size={16} /><span>Ask anything or find a record</span><kbd className="w-kbd">{mac ? "⌘" : "Ctrl"} K</kbd>
    </button>
  );
}

export function AskPalette({ open, onClose }) {
  const s = useStore();
  const [text, setText] = useState("");
  const [out, setOut] = useState(null);
  const [sel, setSel] = useState(0);
  const input = useRef(null);
  const box = useRef(null);
  useEffect(() => { if (open) { setText(""); setOut(null); setSel(0); setTimeout(() => input.current?.focus(), 20); } else stopSpeaking(); }, [open]);
  const voice = useVoice({ serverVoice: false, onText: (t) => { setText(t); ask(t); }, onError: (m) => setOut({ error: m }) });

  const pages = useMemo(() => [
    { label: "Home", sub: "Decisions, outcomes and today", to: "/workspace", icon: "Home" },
    ...HUBS.flatMap((h) => [{ label: h.name, sub: h.purpose, to: "/workspace/" + h.id, icon: h.icon }, ...shellApps(s.os, h.id).map((a) => ({ label: appName(a, s.prefs.view), sub: h.name, to: `/workspace/${h.id}/${a.key}`, icon: a.icon }))]),
    { label: "Setup", sub: "Apps, agents and tools", to: "/workspace/setup", icon: "Settings" },
  ], [s.os, s.prefs.view]);
  const t = text.trim();
  const items = useMemo(() => {
    if (!t) return SUGGEST.map((x) => ({ kind: "ask", label: x, text: x }));
    const w = t.toLowerCase();
    const ask = { kind: "ask", label: `Ask: ${t}`, text: t };
    const goPages = pages.filter((p) => p.label.toLowerCase().includes(w)).slice(0, 4).map((p) => ({ kind: "go", ...p }));
    const recs = search(s, t).map((h) => ({ kind: "go", label: h.label, sub: h.sub, to: hrefFor(h.ref, s), icon: "ArrowRight" }));
    return QUESTION.test(t) ? [ask, ...goPages, ...recs] : [...goPages, ...recs, ask];
  }, [t, pages, s]);
  useEffect(() => setSel(0), [t]);

  function ask(x) { setOut(answer(s, x, routeAgent(x))); }
  function pick(it) {
    if (!it) return;
    if (it.kind === "go") { navigate(it.to); onClose(); return; }
    setText(it.text); ask(it.text);
  }
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(items[sel]); }
    else if (e.key === "Escape") onClose();
  };
  if (!open) return null;
  return (
    <>
      <div className="w-scrim" onClick={onClose} />
      <div className="w-cmd" role="dialog" aria-modal="true" aria-label="Ask or search" ref={box}>
        <div className="w-cmd-row">
          <Icon name="Search" size={20} />
          <input ref={input} value={text} onChange={(e) => { setText(e.target.value); setOut(null); }} onKeyDown={key} placeholder="Ask a question, or type a name or invoice number"
            role="combobox" aria-expanded="true" aria-controls="w-cmd-list" aria-activedescendant={items[sel] ? "w-cmd-" + sel : undefined} aria-label="Ask or search" />
          {voiceSupported() && <Button variant={voice.state === "listening" ? "primary" : "ghost"} icon="Mic" onClick={voice.toggle} aria-label={voice.state === "listening" ? "Stop listening" : "Ask by voice"} />}
          <Button variant="ghost" icon="X" onClick={onClose} aria-label="Close" />
        </div>
        {!out && (
          <div className="w-cmd-list" id="w-cmd-list" role="listbox" aria-label={t ? "Results" : "Suggestions"}>
            <p className="w-cmd-h">{t ? "Results" : "Try asking"}</p>
            {items.map((it, i) => (
              <button key={i} id={"w-cmd-" + i} type="button" role="option" aria-selected={i === sel} className="w-cmd-item" onMouseEnter={() => setSel(i)} onClick={() => pick(it)}>
                <Icon name={it.kind === "ask" ? "Sparkles" : it.icon || "ArrowRight"} size={18} />
                <span>{it.label}{it.sub && <small>{it.sub}</small>}</span>
              </button>
            ))}
          </div>
        )}
        {out && (
          <div className="w-answer" aria-live="polite">
            {out.error ? <p>{out.error}</p> : (
              <>
                <AgentBadge agentId={out.agentId} />
                <p>{out.text}</p>
                <div className="w-row" style={{ marginTop: 12 }}>
                  {out.card?.ref?.id && <Button variant="primary" size="sm" icon="ArrowRight" onClick={() => { navigate(hrefFor(out.card.ref, s)); onClose(); }}>{out.card.label || title(s, out.card.ref)}</Button>}
                  <Button size="sm" icon="Volume2" onClick={() => speakText(out.text)}>Read it to me</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOut(null); setText(""); input.current?.focus(); }}>Ask something else</Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
