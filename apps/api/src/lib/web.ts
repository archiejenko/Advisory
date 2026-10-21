// Web research for agents: search (Brave Search API shape) and reading one public page as text.
import type { Env } from "./db";
import { UpstreamError } from "./registers";
import { HttpError } from "./http";

export type SearchResult = { title: string; url: string; snippet: string };

export async function webSearch(env: Env, query: string, count = 8): Promise<SearchResult[]> {
  if (!env.SEARCH_API_KEY) throw new UpstreamError("Web search", 503, "SEARCH_API_KEY is not set");
  const base = (env.SEARCH_BASE || "https://api.search.brave.com").replace(/\/$/, "");
  const cacheKey = `search:${count}:${query.toLowerCase().trim()}`;
  const hit = await env.CACHE.get(cacheKey, "json");
  if (hit) return hit as SearchResult[];
  const res = await fetch(`${base}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=GB`, {
    headers: { Accept: "application/json", "X-Subscription-Token": env.SEARCH_API_KEY },
  });
  if (!res.ok) throw new UpstreamError("Web search", res.status, `Search returned ${res.status}`);
  const j: any = await res.json();
  const out = (j.web?.results || []).slice(0, count).map((r: any) => ({ title: String(r.title || ""), url: String(r.url || ""), snippet: strip(String(r.description || "")) }));
  await env.CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: 6 * 3600 });
  return out;
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export function allowedUrl(env: Env, raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, "invalid_url", "Give a full URL starting with https://."); }
  const devHttp = env.ALLOW_HTTP_FETCH === "true";
  if (u.protocol !== "https:" && !(devHttp && u.protocol === "http:")) throw new HttpError(400, "invalid_url", "Only https pages can be read.");
  const h = u.hostname.toLowerCase();
  const privateHost = h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || h.startsWith("[");
  if (privateHost && !devHttp) throw new HttpError(400, "invalid_url", "That address isn't a public web page.");
  return u;
}

/** Fetch one public page and return its readable text, capped at about 12,000 characters. */
export async function readPage(env: Env, raw: string) {
  const u = allowedUrl(env, raw);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  let res: Response;
  try { res = await fetch(u.toString(), { headers: { "User-Agent": "AgentHouseBot/1.0 (+https://agenthouse.example/#/standards)", Accept: "text/html,text/plain" }, signal: ctl.signal, redirect: "follow" }); }
  catch { throw new UpstreamError(u.hostname, 504, "The page didn't respond in time."); }
  finally { clearTimeout(t); }
  if (!res.ok) throw new UpstreamError(u.hostname, res.status, `The page returned ${res.status}.`);
  const type = res.headers.get("content-type") || "";
  if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new HttpError(415, "not_a_page", "That address isn't a readable web page.");
  const html = (await res.text()).slice(0, 1_500_000);
  const title = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const body = html.replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n");
  const emails = [...new Set((html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase()))].filter((e) => !/\.(png|jpg|gif|svg|webp)$/.test(e)).slice(0, 10);
  const text = decode(body.replace(/<[^>]+>/g, " ")).replace(/[ \t\r\f\v]+/g, " ").replace(/ ?\n[\s]*/g, "\n").trim().slice(0, 12000);
  return { url: u.toString(), title, text, emails_on_page: emails, retrieved_at: new Date().toISOString() };
}
