export type CsvCell = string | number | null | undefined;

/**
 * A cell Excel would run as a formula: anything starting with = + - @ (or a
 * tab/CR). Issue titles and comments are typed by anyone on the project, so an
 * exported sheet must not execute what a teammate wrote. Numbers are left alone —
 * they are ours, and a negative one is not a formula.
 */
function neutralise(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  const text = typeof v === "number" ? String(v) : neutralise(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180 rows, CRLF-separated, with a UTF-8 byte-order mark: without it Excel
 * on Windows opens the file as ANSI and every Vietnamese diacritic turns to
 * mojibake.
 */
export function toCsv(rows: CsvCell[][]): string {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `name-2026-10-14.csv` — the date is the browser's local day. */
export function csvName(base: string, today: string): string {
  return `${base.replace(/[^\w-]+/g, "_")}-${today}.csv`;
}
