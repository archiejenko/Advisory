// Voice: speech to text for the command bar, and spoken replies. Cloudflare Workers AI by default
// (Whisper large v3 turbo in, Deepgram Aura out), behind one adapter so another provider can slot in.
// VOICE_HTTP_URL points both at an HTTP service instead (local development and tests use the mocks).
import type { Env } from "./db";
import { HttpError } from "./http";
import { UpstreamError } from "./registers";

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;   // about a minute of compressed speech
export const MAX_SPEAK_CHARS = 1200;
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const TTS_MODEL = "@cf/deepgram/aura-1";

export const voiceAvailable = (env: Env) => !!(env.AI || env.VOICE_HTTP_URL);
const off = () => new HttpError(503, "voice_off", "Voice isn't switched on for this workspace yet. Type instead, or dictate with your phone's keyboard.");

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Audio in, text out. The audio is passed straight through and never stored. */
export async function transcribe(env: Env, audio: ArrayBuffer): Promise<string> {
  if (!audio.byteLength) throw new HttpError(400, "invalid_request", "No audio arrived. Hold the mic while you speak.");
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new HttpError(413, "too_long", "That recording is too long. Keep it under a minute.");
  const audioB64 = base64(new Uint8Array(audio));
  let text = "";
  if (env.VOICE_HTTP_URL) {
    const res = await fetch(env.VOICE_HTTP_URL.replace(/\/$/, "") + "/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: audioB64 }) });
    if (!res.ok) throw new UpstreamError("Speech to text", res.status, `Speech to text returned ${res.status}`);
    text = String((await res.json<any>()).text || "");
  } else if (env.AI) {
    const r: any = await env.AI.run(STT_MODEL, { audio: audioB64, language: env.VOICE_LANGUAGE || "en", vad_filter: true });
    text = String(r?.text || "");
  } else throw off();
  return text.replace(/\s+/g, " ").trim();
}

/** Text in, MP3 out. */
export async function speak(env: Env, text: string): Promise<Response> {
  const t = text.replace(/\s+/g, " ").trim().slice(0, MAX_SPEAK_CHARS);
  if (!t) throw new HttpError(400, "invalid_request", "Nothing to say.");
  let body: BodyInit | null;
  if (env.VOICE_HTTP_URL) {
    const res = await fetch(env.VOICE_HTTP_URL.replace(/\/$/, "") + "/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
    if (!res.ok) throw new UpstreamError("Text to speech", res.status, `Text to speech returned ${res.status}`);
    body = res.body;
  } else if (env.AI) {
    const r: any = await env.AI.run(TTS_MODEL, { text: t, speaker: env.VOICE_SPEAKER || "angus", encoding: "mp3" }, { returnRawResponse: true });
    body = r instanceof Response ? r.body : r;
  } else throw off();
  return new Response(body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}

