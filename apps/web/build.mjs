// Builds the website into one self-contained dist/index.html, served by the API Worker as static assets.
// The same file also opens straight from disk, where it runs as an offline demo.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// DEMO=1 builds a stand-alone demo (no API needed) into dist-demo/, for static hosting such as Vercel or Cloudflare Pages.
const DEMO = process.env.DEMO === "1";
const OUT = DEMO ? "dist-demo" : "dist";

const out = await build({
  entryPoints: ["src/main.jsx"], bundle: true, minify: true, format: "iife", write: false,
  jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __DEMO_BUILD__: DEMO ? "true" : "false" }, target: "es2020",
});
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const css = ["src/styles.css", "src/theme.css", "src/floor.css"].map((f) => readFileSync(f, "utf8")).join("\n");
const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent House</title>
<meta name="description" content="Agent House: a team of agents for any small business, led by an orchestrator and built from twelve building blocks. Check who you deal with before you pay them. Signed tools for developers, paid per call by agents with x402.">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(readFileSync("src/brand/favicon.svg", "utf8"))}">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<noscript><p style="padding:40px;font-family:Helvetica,Arial,sans-serif">Agent House needs JavaScript.</p></noscript>
<script>${js}</script>
</body>
</html>`;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.html`, html);
console.log(`${OUT}/index.html ${Math.round(html.length / 1024)} KB`);
