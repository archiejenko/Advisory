// RFC 4180 CSV: quoted fields, embedded commas, quotes and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => {
    const v = c == null ? "" : String(c);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(",")).join("\n") + "\n";
}

/** Map a customer, supplier or client list's header row to known columns. Names alone are enough. */
export function mapClientColumns(header: string[]) {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (...keys: string[]) => h.findIndex((x) => keys.some((k) => x === k || x.includes(k)));
  const isNumber = (x: string) => /number|\bno\b|\bno\.|crn|since|date|fee|email|postcode|website/.test(x);
  const nameCol = () => {
    for (const k of ["customer", "supplier", "client", "company name", "business", "organisation", "organization", "account name", "name"]) {
      const i = h.findIndex((x) => (x === k || x.includes(k)) && !isNumber(x));
      if (i >= 0) return i;
    }
    return h.findIndex((x) => x === "company");
  };
  return {
    name: nameCol(),
    number: find("company number", "company no", "number", "crn"),
    postcode: find("postcode", "post code"),
    website: find("website", "domain", "url"),
    since: find("client since", "customer since", "since"),
    users: find("users", "seats"),
    fee: find("monthly fee", "fee", "mrr"),
    nextInvoice: find("next invoice", "invoice date"),
  };
}
