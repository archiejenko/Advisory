// Untrusted input and outbound calls: spreadsheets, inbound mail, URLs we fetch, and Claude's API under load.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readXlsx, XlsxError, excelDate } from "../../packages/core/xlsx";
import { parseMessage } from "../../apps/api/src/lib/inbound";
import { safeOutboundUrl, privateHost, readPage } from "../../apps/api/src/lib/web";
import { claude, withCaching } from "../../apps/api/src/lib/llm";

afterEach(() => vi.restoreAllMocks());

/* ---------- A minimal zip writer, to build .xlsx files in the test ---------- */
async function deflate(data: Uint8Array) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}
async function zip(files: Record<string, string>, store = false) {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text), data = store ? raw : await deflate(raw), n = enc.encode(name);
    const local = new Uint8Array(30 + n.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, store ? 0 : 8, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true); local.set(n, 30);
    const cd = new Uint8Array(46 + n.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, store ? 0 : 8, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true); cd.set(n, 46);
    parts.push(local, data); central.push(cd); offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
const WB = `<workbook xmlns:r="r"><sheets><sheet name="Clients" sheetId="1" r:id="rId7"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/clients.xml"/></Relationships>`;
const STYLES = `<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="2"/></cellXfs></styleSheet>`;
const SST = `<sst><si><t>Client</t></si><si><t>Since</t></si><si><r><t>Brindle </t></r><r><t xml:space="preserve">&amp; Co</t></r><rPh><t>ignored</t></rPh></si></sst>`;
const SHEET = `<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Fee</t></is></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45672</v></c><c r="D2" s="2"><v>1250.5</v></c></row>
  <row r="3"><c r="A3"/></row>
  <row r="4"><c r="A4" t="str"><v>Garside Motors &lt;Ltd&gt;</v></c><c r="C4" t="b"><v>1</v></c></row>
</sheetData></worksheet>`;

describe("reading .xlsx without the xlsx package", () => {
  it("reads the first sheet: shared, rich and inline strings, dates, gaps and entities", async () => {
    const file = await zip({ "xl/workbook.xml": WB, "xl/_rels/workbook.xml.rels": RELS, "xl/styles.xml": STYLES, "xl/sharedStrings.xml": SST, "xl/worksheets/clients.xml": SHEET });
    expect(await readXlsx(file)).toEqual([
      ["Client", "Since", "", "Fee"],
      ["Brindle & Co", "2025-01-15", "", "1250.5"],
      ["Garside Motors <Ltd>", "", "TRUE"],
    ]);
  });
  it("reads stored (uncompressed) parts and falls back to sheet1.xml", async () => {
    const file = await zip({ "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c t="inlineStr"><is><t>Only</t></is></c></row></sheetData></worksheet>` }, true);
    expect(await readXlsx(file)).toEqual([["Only"]]);
  });
  it("refuses files that aren't spreadsheets", async () => {
    await expect(readXlsx(new TextEncoder().encode("name,number\nAcme,123"))).rejects.toBeInstanceOf(XlsxError);
    await expect(readXlsx(await zip({ "readme.txt": "hi" }))).rejects.toThrow(/worksheet/);
  });
  it("refuses a part that inflates past the limit (a zip bomb)", async () => {
    const huge = "<worksheet><sheetData>" + "<row><c><v>1</v></c></row>".repeat(1_700_000) + "</sheetData></worksheet>"; // ~44 MB, compresses to KBs
    await expect(readXlsx(await zip({ "xl/worksheets/sheet1.xml": huge }))).rejects.toThrow(/too large/);
  });
  it("converts Excel serial dates", () => {
    expect(excelDate(45672)).toBe("2025-01-15");
    expect(excelDate(45351)).toBe("2024-02-29");
  });
});

describe("inbound mail is decoded before agents see it", () => {
  it("multipart with base64 text: the agent gets the words, not the MIME", async () => {
    const raw = [
      "From: Sam <sam@shop.example>", "To: brightwork-x1@in.agenthouse.test", "Subject: =?UTF-8?B?UXVvdGUgZm9yIDEwIGRlc2tz?=", "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b1"', "", "--b1", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "",
      Buffer.from("Hello,\nCould you quote for 10 desks? £200 budget.\nSam").toString("base64"), "--b1", "Content-Type: text/html; charset=utf-8", "", "<p>Hello</p>", "--b1--", "",
    ].join("\r\n");
    const m = await parseMessage(raw);
    expect(m.subject).toBe("Quote for 10 desks");
    expect(m.text).toBe("Hello,\nCould you quote for 10 desks? £200 budget.\nSam");
    expect(m.text).not.toMatch(/Content-Type|--b1/);
  });
  it("HTML-only mail becomes readable text", async () => {
    const raw = ["From: a@b.example", "Subject: Hi", "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "<html><style>p{}</style><body><p>Stop</p><p>Thanks =E2=80=94 A</p></body></html>"].join("\r\n");
    const m = await parseMessage(raw);
    expect(m.text).toBe("Stop\nThanks — A");
  });
});

describe("outbound URLs", () => {
  it("refuses private, local and disguised addresses", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "2130706433", "0x7f000001", "0177.0.0.1", "[::1]", "metadata.google.internal", "printer.local"]) {
      expect(privateHost(h.replace(/^\[|\]$/g, "")) || privateHost(h), h).toBe(true);
    }
    for (const h of ["example.com", "hooks.slack.com", "8.8.8.8", "ab.cd.example"]) expect(privateHost(h), h).toBe(false);
  });
  it("webhooks and developer endpoints must be https on a public host", () => {
    const env = {} as any;
    expect(safeOutboundUrl(env, "https://hooks.example.com/x").hostname).toBe("hooks.example.com");
    for (const u of ["http://hooks.example.com/x", "https://127.0.0.1/x", "https://user:pw@hooks.example.com/", "https://[::1]/", "ftp://x.example"]) expect(() => safeOutboundUrl(env, u), u).toThrow();
    expect(safeOutboundUrl(env, "http://127.0.0.1:8788/hook", true).port).toBe("8788"); // local development only
  });
  it("read-page checks every redirect hop", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      if (String(url).startsWith("https://public.example/")) return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
      return new Response("<title>secret</title>", { status: 200, headers: { "content-type": "text/html" } });
    });
    await expect(readPage({} as any, "https://public.example/start")).rejects.toThrow(/public web page/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("read-page follows a public redirect", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => String(url).includes("/old")
      ? new Response(null, { status: 301, headers: { location: "/new" } })
      : new Response("<title>New page</title><p>hello@new.example</p>", { status: 200, headers: { "content-type": "text/html" } }));
    const p = await readPage({} as any, "https://site.example/old");
    expect(p).toMatchObject({ url: "https://site.example/new", title: "New page", emails_on_page: ["hello@new.example"] });
  });
});

describe("Claude under load", () => {
  const ok = { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
  const env = { ANTHROPIC_API_KEY: "k", CLAUDE_RETRY_BASE_MS: "1" } as any;
  it("retries overloaded and rate-limited responses, then succeeds", async () => {
    const replies = [new Response("overloaded", { status: 529 }), new Response("slow down", { status: 429, headers: { "retry-after": "0" } }), new Response(JSON.stringify(ok), { status: 200 })];
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => replies.shift()!);
    expect((await claude(env, { system: "s", messages: [{ role: "user", content: "hi" }], tools: [] })).content[0]).toEqual({ type: "text", text: "done" });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("gives up after the retry budget, and doesn't retry a bad request", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("overloaded", { status: 529 }));
    await expect(claude({ ...env, CLAUDE_RETRIES: "2" }, { system: "s", messages: [{ role: "user", content: "hi" }], tools: [] })).rejects.toMatchObject({ status: 529 });
    expect(f).toHaveBeenCalledTimes(3);
    f.mockImplementation(async () => new Response("bad", { status: 400 }));
    f.mockClear();
    await expect(claude(env, { system: "s", messages: [{ role: "user", content: "hi" }], tools: [] })).rejects.toMatchObject({ status: 400 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("marks the system prompt, tools and latest turn for prompt caching, without changing the history", () => {
    const messages: any[] = [{ role: "user", content: "start" }, { role: "assistant", content: [{ type: "text", text: "a" }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }] }];
    const tools = [{ name: "a", description: "", input_schema: {} }, { name: "b", description: "", input_schema: {} }];
    const c = withCaching({ system: "sys", messages, tools });
    expect(c.system).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
    expect(c.tools.map((t: any) => !!t.cache_control)).toEqual([false, true]);
    expect((c.messages[2].content as any[])[0].cache_control).toEqual({ type: "ephemeral" });
    expect(messages[2].content[0].cache_control).toBeUndefined();
    expect(c.messages[0].content).toBe("start");
  });
});
