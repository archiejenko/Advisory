// A small, dependency-free reader for the first worksheet of an .xlsx file, for client and invoice lists.
// It replaces the `xlsx` npm package (0.18.5 has prototype-pollution and ReDoS advisories, and newer builds
// are only published on SheetJS's own CDN). Every scan is linear (indexOf, no backtracking regexes on file
// content), and sizes are capped so a crafted file (a zip bomb, a huge sheet) is refused rather than processed.

export class XlsxError extends Error {}

const MAX_ENTRY = 40 * 1024 * 1024;   // uncompressed bytes for any one part we read
const MAX_ROWS = 5000;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

type Entry = { name: string; method: number; compSize: number; size: number; offset: number };

function centralDirectory(b: Uint8Array): Map<string, Entry> {
  // End of central directory: the last 0x06054b50 signature, within the final 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxError("This isn't a valid .xlsx file.");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new XlsxError("This .xlsx file is damaged.");
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method: u16(b, p + 10), compSize: u32(b, p + 20), size: u32(b, p + 24), offset: u32(b, p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); throw new XlsxError("The spreadsheet is too large. Save it as CSV, or split it."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function readEntry(b: Uint8Array, dir: Map<string, Entry>, name: string): Promise<string | null> {
  const e = dir.get(name);
  if (!e) return null;
  if (e.size > MAX_ENTRY) throw new XlsxError("The spreadsheet is too large. Save it as CSV, or split it.");
  if (e.offset + 30 > b.length || u32(b, e.offset) !== 0x04034b50) throw new XlsxError("This .xlsx file is damaged.");
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const data = b.subarray(start, start + e.compSize);
  const raw = e.method === 0 ? data : e.method === 8 ? await inflateRaw(data, MAX_ENTRY) : null;
  if (!raw) throw new XlsxError("This .xlsx file uses a compression we can't read. Save it as CSV.");
  return new TextDecoder().decode(raw);
}

/* ---------- Linear XML scanning ---------- */
type El = { attrs: string; inner: string };
/** Each <tag ...>inner</tag> or <tag .../> in order. Assumes the tag doesn't nest inside itself (true for the parts we read). */
function* elements(xml: string, tag: string): Generator<El> {
  const open = "<" + tag, close = "</" + tag + ">";
  let i = 0;
  while ((i = xml.indexOf(open, i)) !== -1) {
    const next = xml.charCodeAt(i + open.length);
    if (next !== 32 && next !== 62 && next !== 47 && next !== 9 && next !== 10 && next !== 13) { i += open.length; continue; } // <tagSomething
    const gt = xml.indexOf(">", i);
    if (gt === -1) return;
    if (xml.charCodeAt(gt - 1) === 47) { yield { attrs: xml.slice(i + open.length, gt - 1), inner: "" }; i = gt + 1; continue; }
    const end = xml.indexOf(close, gt);
    if (end === -1) return;
    yield { attrs: xml.slice(i + open.length, gt), inner: xml.slice(gt + 1, end) };
    i = end + close.length;
  }
}
function attr(attrs: string, name: string): string | null {
  const key = name + '="';
  let i = 0;
  while ((i = attrs.indexOf(key, i)) !== -1) {
    const before = i === 0 ? 32 : attrs.charCodeAt(i - 1);
    if (before === 32 || before === 9 || before === 10 || before === 13) {
      const end = attrs.indexOf('"', i + key.length);
      return end === -1 ? null : attrs.slice(i + key.length, end);
    }
    i += key.length;
  }
  return null;
}
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function unescapeXml(s: string) {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] !== "#") return ENT[e.toLowerCase()] ?? "";
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}
/** All the <t> text inside a string item (plain or rich text), skipping phonetic runs. */
function textOf(inner: string) {
  let body = inner, i: number;
  while ((i = body.indexOf("<rPh")) !== -1) {
    const end = body.indexOf("</rPh>", i);
    body = body.slice(0, i) + (end === -1 ? "" : body.slice(end + 6));
  }
  let s = "";
  for (const t of elements(body, "t")) s += t.inner;
  return unescapeXml(s);
}

/* ---------- Dates ---------- */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function isDateFormat(code: string) {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmy]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}
function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const f of elements(stylesXml, "numFmt")) custom.set(Number(attr(f.attrs, "numFmtId")), unescapeXml(attr(f.attrs, "formatCode") || ""));
  const xfs = [...elements(stylesXml, "cellXfs")][0];
  if (!xfs) return out;
  let i = 0;
  for (const xf of elements(xfs.inner, "xf")) {
    const id = Number(attr(xf.attrs, "numFmtId") || 0);
    if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) out.add(i);
    i++;
  }
  return out;
}
/** Excel's serial day number (1900 date system) to YYYY-MM-DD. */
export function excelDate(serial: number) {
  const ms = Math.round((serial - 25569) * 864e5);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? String(serial) : d.toISOString().slice(0, 10);
}

const colIndex = (ref: string) => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

/** The first worksheet as rows of strings. Empty rows are dropped, like the CSV path. */
export async function readXlsx(buf: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dir = centralDirectory(b);
  // The first sheet in workbook order, via the workbook's relationships; sheet1.xml as a fallback.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await readEntry(b, dir, "xl/workbook.xml");
  const rels = await readEntry(b, dir, "xl/_rels/workbook.xml.rels");
  const first = wb ? [...elements(wb, "sheet")][0] : null;
  const rid = first ? attr(first.attrs, "r:id") : null;
  if (rid && rels) {
    for (const r of elements(rels, "Relationship")) {
      if (attr(r.attrs, "Id") !== rid) continue;
      const target = attr(r.attrs, "Target") || "";
      sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    }
  }
  const sheet = await readEntry(b, dir, sheetPath);
  if (sheet === null) throw new XlsxError("We couldn't find a worksheet in this file. Save it as CSV and upload that.");
  const sstXml = await readEntry(b, dir, "xl/sharedStrings.xml");
  const shared = sstXml ? [...elements(sstXml, "si")].map((si) => textOf(si.inner)) : [];
  const dates = dateStyles(await readEntry(b, dir, "xl/styles.xml"));

  const rows: string[][] = [];
  for (const row of elements(sheet, "row")) {
    if (rows.length >= MAX_ROWS) break;
    const cells: string[] = [];
    let next = 0;
    for (const c of elements(row.inner, "c")) {
      const ref = attr(c.attrs, "r");
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      if (col < 0 || col > 200) continue;
      const t = attr(c.attrs, "t") || "n";
      const v = [...elements(c.inner, "v")][0]?.inner ?? "";
      let val = "";
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = textOf([...elements(c.inner, "is")][0]?.inner ?? "");
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (t === "str" || t === "e") val = unescapeXml(v);
      else if (v !== "") val = dates.has(Number(attr(c.attrs, "s") || 0)) && Number.isFinite(Number(v)) ? excelDate(Number(v)) : v;
      while (cells.length < col) cells.push("");
      cells[col] = val;
    }
    if (cells.some((x) => String(x).trim())) rows.push(cells);
  }
  return rows;
}
