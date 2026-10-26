// Builds the website into one self-contained dist/index.html, served by the API Worker as static assets.
// The same file also opens straight from disk, where it runs as an offline demo.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

// DEMO=1 builds a stand-alone demo (no API needed) into dist-demo/, for static hosting such as Vercel or Cloudflare Pages.
const DEMO = process.env.DEMO === "1";
const OUT = DEMO ? "dist-demo" : "dist";

const out = await build({
  entryPoints: ["src/main.jsx"], bundle: true, minify: true, format: "iife", write: false,
  jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __DEMO_BUILD__: DEMO ? "true" : "false" }, target: "es2020",
});
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const css = ["src/styles.css", "src/theme.css", "src/floor.css", "src/landing.css", "src/os.css", "src/workspace/ws.css"].map((f) => readFileSync(f, "utf8")).join("\n");
const sw = `if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });`;
// Content Security Policy for the hosted site: only these two inline scripts (by hash), our own origin, and
// Turnstile may run, so an injected <script> can't. (Inline styles stay allowed: React sets them. The demo build,
// opened from disk, has no policy.) frame-ancestors can't go in a meta tag; the Worker sends it as a header.
const hash = (s) => "'sha256-" + createHash("sha256").update(s).digest("base64") + "'";
const csp = [
  "default-src 'self'", `script-src 'self' ${hash(js)} ${hash(sw)} https://challenges.cloudflare.com`, "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "media-src 'self' blob:", "frame-src https://challenges.cloudflare.com",
  "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
].join("; ");
const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">${DEMO ? "" : `\n<meta http-equiv="Content-Security-Policy" content="${csp}">`}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent House</title>
<meta name="description" content="Agent House: the all-in-one business operating system. Drag together the apps your business runs on, all on one database, and let your AI Team do the manual work. For UK businesses of 1 to 100 people.">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(readFileSync("src/brand/favicon.svg", "utf8"))}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<noscript><p style="padding:40px;font-family:Helvetica,Arial,sans-serif">Agent House needs JavaScript.</p></noscript>
<script>${js}</script>
<script>${sw}</script>
</body>
</html>`;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.html`, html);

// Installable on a phone: a manifest that opens the workspace full screen, and a service worker that keeps the
// shell available offline and opens the right screen when a notification is tapped.
const icon = readFileSync("src/brand/favicon.svg", "utf8");
writeFileSync(`${OUT}/icon.svg`, icon);
writeFileSync(`${OUT}/manifest.webmanifest`, JSON.stringify({
  name: "Agent House", short_name: "Agent House", description: "Your business operating system, run by your AI Team.",
  start_url: "./#/workspace", scope: "./", display: "standalone", orientation: "portrait", background_color: "#0E1013", theme_color: "#0E1013",
  icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
}, null, 2));
writeFileSync(`${OUT}/sw.js`, `// Agent House service worker: the app shell offline, and notifications that open the right screen.
const SHELL = "ah-shell-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon.svg"])).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || /^\\/(api|v1|mcp|r)\\b/.test(u.pathname)) return;
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(SHELL).then((x) => x.put("./index.html", c)); return r; }).catch(() => caches.match("./index.html")));
});
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Agent House", { body: d.body || "Something needs you.", data: { to: d.to || "/workspace" }, tag: d.tag || "ah", icon: "icon.svg" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const to = "./#" + ((e.notification.data && e.notification.data.to) || "/workspace");
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { for (const c of cs) { if ("focus" in c) { c.navigate(to); return c.focus(); } } return self.clients.openWindow(to); }));
});
`);
console.log(`${OUT}/index.html ${Math.round(html.length / 1024)} KB`);
