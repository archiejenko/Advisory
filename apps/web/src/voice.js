// Voice for the Floor's command bar. Records with the microphone and sends the audio to /api/ws/voice/transcribe
// (Workers AI on the server). Where that isn't available (the demo, or voice not switched on), it falls back to the
// browser's own speech recognition, and spoken replies fall back to the browser's speech synthesis.
// Dictation keyboards such as Wispr Flow need nothing from us: they type into the command bar like any keyboard.
import { useEffect, useRef, useState } from "react";
import { api, isDemo } from "./api.js";

const MAX_MS = 60000;
const Rec = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const canRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
export const voiceSupported = () => canRecord() || !!Rec;

/**
 * Hold-to-talk or tap-to-talk. `serverVoice` says whether the workspace transcribes on the server.
 * Returns { state: "idle" | "listening" | "thinking", level (0 to 1, for the meter), start, stop, toggle }.
 */
export function useVoice({ serverVoice, onText, onError }) {
  const [state, setState] = useState("idle");
  const [level, setLevel] = useState(0);
  const rec = useRef(null), stream = useRef(null), chunks = useRef([]), timer = useRef(null), raf = useRef(0), speech = useRef(null), ctx = useRef(null);

  const cleanup = () => {
    clearTimeout(timer.current); cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    try { ctx.current?.close(); } catch {}
    ctx.current = null; setLevel(0);
  };
  useEffect(() => () => { cleanup(); try { speech.current?.abort(); } catch {} }, []);

  const browserListen = () => {
    if (!Rec) { onError("Voice needs a browser with speech support. You can also dictate with your phone's keyboard, for example Wispr Flow."); return; }
    const r = new Rec();
    r.lang = "en-GB"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => { const t = e.results?.[0]?.[0]?.transcript || ""; if (t.trim()) onText(t.trim()); };
    r.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") onError("I couldn't hear that. Try again, or type it."); };
    r.onend = () => setState("idle");
    speech.current = r;
    setState("listening");
    r.start();
  };

  const start = async () => {
    if (state !== "idle") return;
    if (!serverVoice || isDemo() || !canRecord()) return browserListen();
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch { onError("The microphone is blocked. Allow it in your browser's settings, or type instead."); return; }
    // A level meter, so the owner can see they're being heard.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx.current = new AC();
      const an = ctx.current.createAnalyser(); an.fftSize = 512;
      ctx.current.createMediaStreamSource(stream.current).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); setLevel(Math.min(1, peak / 64)); raf.current = requestAnimationFrame(tick); };
      tick();
    } catch {}
    chunks.current = [];
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => window.MediaRecorder.isTypeSupported?.(t)) || "";
    const r = new window.MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = async () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
      cleanup();
      if (blob.size < 800) { setState("idle"); return; }
      setState("thinking");
      try {
        const { text } = await api("POST", "/api/ws/voice/transcribe", blob);
        setState("idle");
        if (text && text.trim()) onText(text.trim()); else onError("I didn't catch that. Try again.");
      } catch (e) {
        setState("idle");
        if (e.code === "voice_off" && Rec) browserListen(); else onError(e.message);
      }
    };
    rec.current = r;
    r.start();
    setState("listening");
    timer.current = setTimeout(() => stop(), MAX_MS);
  };

  function stop() {
    if (rec.current) {
      if (rec.current.state === "recording") rec.current.stop();
      rec.current = null;
      return;
    }
    try { speech.current?.stop(); } catch {}
  }
  const toggle = () => (state === "listening" ? stop() : start());
  return { state, level, start, stop, toggle };
}

let current = null;
/** Read a reply aloud: the workspace's voice when it has one, the browser's otherwise. */
export async function speakText(text, { serverVoice } = {}) {
  if (!text) return;
  try { current?.pause(); } catch {}
  try { window.speechSynthesis?.cancel(); } catch {}
  if (serverVoice && !isDemo()) {
    try {
      const res = await api("POST", "/api/ws/voice/speak", { text: text.slice(0, 1200) }, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      current = new Audio(url);
      current.onended = () => URL.revokeObjectURL(url);
      await current.play();
      return;
    } catch {}
  }
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    const v = window.speechSynthesis.getVoices().find((x) => x.lang === "en-GB");
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }
}
export function stopSpeaking() {
  try { current?.pause(); } catch {}
  try { window.speechSynthesis?.cancel(); } catch {}
}
