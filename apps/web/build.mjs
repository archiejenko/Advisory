// Builds the website into one self-contained dist/index.html, served by the API Worker as static assets.
// The same file also opens straight from disk, where it runs as an offline demo.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const out = await build({
  entryPoints: ["src/main.jsx"], bundle: true, minify: true, format: "iife", write: false,
  jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"' }, target: "es2020",
});
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const css = readFileSync("src/styles.css", "utf8") + "\n" + readFileSync("src/theme.css", "utf8");
const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent House</title>
<meta name="description" content="Agent House: agents that run your business, tools developers publish for them, and a catalogue any agent can pay to use per call with x402.">
<meta name="theme-color" content="#FFFFFF">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<noscript><p style="padding:40px;font-family:Helvetica,Arial,sans-serif">Agent House needs JavaScript.</p></noscript>
<script>${js}</script>
</body>
</html>`;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`dist/index.html ${Math.round(html.length / 1024)} KB`);
