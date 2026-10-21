// The always-on Companies House stream listener.
// Holds one long-lived connection per stream, turns each event into a register event, and posts
// batches to the API. Resumes from the last timepoint the API stored, and reconnects with backoff.
// Run anywhere that keeps a process alive: Cloudflare Containers, or a small virtual machine.
//
// Env: STREAM_BASE (https://stream.companieshouse.gov.uk), STREAM_KEY, API_URL, INGEST_SECRET,
//      STREAMS (comma list, default: companies,filings,insolvency-cases,charges,officers,persons-with-significant-control)

const STREAM_BASE = (process.env.STREAM_BASE || "https://stream.companieshouse.gov.uk").replace(/\/$/, "");
const API = (process.env.API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const SECRET = process.env.INGEST_SECRET;
const KEY = process.env.STREAM_KEY;
const STREAMS = (process.env.STREAMS || "companies,filings,insolvency-cases,charges,officers,persons-with-significant-control").split(",").map((s) => s.trim()).filter(Boolean);
const KIND = { companies: "company", filings: "filing", "insolvency-cases": "insolvency", charges: "charges", officers: "officers", "persons-with-significant-control": "psc" };

if (!SECRET || !KEY) { console.error("Set INGEST_SECRET and STREAM_KEY"); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pending = [];

async function flush() {
  if (!pending.length) return;
  const batch = pending.splice(0, 200);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(API + "/api/internal/events", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: JSON.stringify({ events: batch }) });
      if (!res.ok) throw new Error("API returned " + res.status);
      const r = await res.json();
      if (r.queued) log(`posted ${batch.length} events: ${r.queued} queued, ${r.duplicate} duplicate, ${r.not_watched} not watched`);
      return;
    } catch (e) {
      log("post failed, retrying:", e.message);
      await sleep(Math.min(30000, 1000 * 2 ** attempt));
    }
  }
}
setInterval(() => flush().catch(() => {}), 1000);

export function toEvent(stream, line) {
  const e = JSON.parse(line);
  const m = (e.resource_uri || "").match(/\/company\/([A-Z0-9]{8})/i);
  if (!m) return null;
  return {
    source: "ch-stream:" + stream,
    source_id: `${stream}:${e.event?.timepoint ?? e.resource_id}`,
    number: m[1].toUpperCase(),
    kind: KIND[stream] || stream,
    occurred_at: e.event?.published_at ? new Date(e.event.published_at + (e.event.published_at.endsWith("Z") ? "" : "Z")).toISOString() : undefined,
    timepoint: e.event?.timepoint,
    payload: { resource_kind: e.resource_kind, type: e.event?.type },
  };
}

async function lastTimepoint(stream) {
  try {
    const r = await fetch(`${API}/api/internal/timepoint?source=ch-stream:${stream}`, { headers: { Authorization: "Bearer " + SECRET } });
    return (await r.json()).timepoint;
  } catch { return null; }
}

async function follow(stream) {
  for (let attempt = 0; ; attempt++) {
    const tp = await lastTimepoint(stream);
    const url = `${STREAM_BASE}/${stream}${tp ? `?timepoint=${tp + 1}` : ""}`;
    try {
      log(`connecting ${stream}${tp ? " from timepoint " + (tp + 1) : ""}`);
      const res = await fetch(url, { headers: { Authorization: "Basic " + Buffer.from(KEY + ":").toString("base64") } });
      if (res.status === 429) throw new Error("rate limited");
      if (!res.ok || !res.body) throw new Error("stream returned " + res.status);
      attempt = 0;
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue; // heartbeat
          try { const ev = toEvent(stream, line); if (ev) pending.push(ev); } catch (e) { log("bad line on", stream, e.message); }
        }
      }
      throw new Error("stream closed");
    } catch (e) {
      const wait = Math.min(60000, 1000 * 2 ** attempt);
      log(`${stream}: ${e.message}; reconnecting in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

for (const s of STREAMS) follow(s);
process.on("SIGTERM", async () => { await flush(); process.exit(0); });
