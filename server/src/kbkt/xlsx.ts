import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { posix } from "node:path";

/**
 * The few parts of an .xlsx a KBKT workbook needs: cell text, sheet names, and
 * which picture sits at which row.
 *
 * Not exceljs: the workbooks are written by openpyxl, which puts its drawing
 * XML in the *default* namespace (`<wsDr><oneCellAnchor>`) rather than behind
 * `xdr:`, and exceljs matches tag names literally — every workbook with a
 * screenshot crashed it on load. Parsing with namespace prefixes stripped reads
 * an openpyxl file and an Excel-saved one the same way. It also uses absolute
 * relationship targets (`/xl/media/image1.png`), which `resolveTarget` accepts.
 *
 * Values are what the file stores: a formula with no cached result reads as
 * empty, and a merged cell's non-anchor cells read as empty — both the way
 * openpyxl reports them, which is what jira_sync.py was written against.
 */

export interface XlsxImage {
  /** 1-based row of the cell the picture's top-left corner is anchored to. */
  row: number;
  /** Path inside the zip, e.g. "xl/media/image3.png" — its extension names the format. */
  media: string;
  data: Uint8Array;
}

export interface XlsxSheet {
  name: string;
  maxRow: number;
  maxCol: number;
  /** Raw cell text, "" when empty. 1-based, like openpyxl. */
  cell(row: number, col: number): string;
  /** Every non-empty cell, row by row. */
  cells(): Array<{ row: number; col: number; value: string }>;
  images: XlsxImage[];
}

export interface XlsxBook {
  sheets: XlsxSheet[];
  sheet(name: string): XlsxSheet | undefined;
}

export class XlsxFormatError extends Error {}

const ARRAYS = new Set([
  "sheet", "Relationship", "si", "r", "row", "c", "mergeCell",
  "oneCellAnchor", "twoCellAnchor", "absoluteAnchor",
]);

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * openpyxl writes every non-ASCII character as a numeric reference
 * (`&#7882;` for "Ị"), which fast-xml-parser leaves alone unless told about
 * HTML entities — and even then decodes with fromCharCode, which breaks above
 * U+FFFF. Decoding all five XML entities and numeric references in one pass
 * also keeps a literal "&amp;#7882;" as the text "&#7882;".
 */
function decodeXml(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (m, dec, hex, named) => {
    if (named) return NAMED_ENTITIES[named];
    const cp = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  tagValueProcessor: (_name, value) => decodeXml(value),
  attributeValueProcessor: (_name, value) => decodeXml(value),
  isArray: (name) => ARRAYS.has(name),
});

type Node = Record<string, any>;

/** A text node is a string, or `{ "#text": ... }` once it carries xml:space. */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  // A drawing anchor's <row> comes back as an array: "row" is listed in ARRAYS for sheetData.
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Node)) return String((node as Node)["#text"]);
  return "";
}

/** A shared or inline string: plain `<t>`, or rich text runs `<r><t>`. */
function stringItem(si: Node | undefined): string {
  if (!si) return "";
  if (si.t !== undefined) return textOf(si.t);
  return (si.r ?? []).map((run: Node) => textOf(run.t)).join("");
}

/** "AB12" → { row: 12, col: 28 } */
function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

/** Relationship targets are relative to their part's folder, or absolute from the zip root. */
function resolveTarget(part: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join(posix.dirname(part), target));
}

function relsOf(files: Record<string, Uint8Array>, part: string): Array<{ id: string; type: string; target: string }> {
  const relsPath = posix.join(posix.dirname(part), "_rels", posix.basename(part) + ".rels");
  const raw = files[relsPath];
  if (!raw) return [];
  const doc = parser.parse(strFromU8(raw));
  return (doc.Relationships?.Relationship ?? [])
    .filter((r: Node) => r["@_TargetMode"] !== "External")
    .map((r: Node) => ({ id: r["@_Id"], type: String(r["@_Type"] ?? ""), target: resolveTarget(part, String(r["@_Target"] ?? "")) }));
}

/** The first `blip` anywhere below a node — a picture may sit inside a group shape. */
function findBlipEmbed(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findBlipEmbed(n);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Node;
  if (obj.blip && typeof obj.blip === "object" && obj.blip["@_embed"]) return String(obj.blip["@_embed"]);
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("@_")) continue;
    const hit = findBlipEmbed(v);
    if (hit) return hit;
  }
  return null;
}

function readImages(files: Record<string, Uint8Array>, sheetPart: string): XlsxImage[] {
  const out: XlsxImage[] = [];
  for (const rel of relsOf(files, sheetPart)) {
    if (!rel.type.endsWith("/drawing") || !files[rel.target]) continue;
    const media = new Map(relsOf(files, rel.target).map((r) => [r.id, r.target]));
    const doc = parser.parse(strFromU8(files[rel.target]));
    const dr: Node = doc.wsDr ?? {};
    // absoluteAnchor has no cell to hang a picture on, so it is skipped.
    for (const anchor of [...(dr.oneCellAnchor ?? []), ...(dr.twoCellAnchor ?? [])] as Node[]) {
      const row = Number(textOf(anchor.from?.row));
      const embed = findBlipEmbed(anchor);
      const path = embed ? media.get(embed) : undefined;
      if (!Number.isFinite(row) || !path || !files[path]) continue;
      out.push({ row: row + 1, media: path, data: files[path] });
    }
  }
  return out;
}

export function readXlsx(buf: Uint8Array): XlsxBook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch {
    throw new XlsxFormatError("Tệp không phải là một file Excel .xlsx hợp lệ.");
  }
  if (!files["xl/workbook.xml"]) {
    throw new XlsxFormatError("Tệp không phải là một file Excel .xlsx hợp lệ (thiếu xl/workbook.xml).");
  }

  const shared: string[] = files["xl/sharedStrings.xml"]
    ? (parser.parse(strFromU8(files["xl/sharedStrings.xml"])).sst?.si ?? []).map(stringItem)
    : [];

  const wbRels = new Map(relsOf(files, "xl/workbook.xml").map((r) => [r.id, r.target]));
  const wbDoc = parser.parse(strFromU8(files["xl/workbook.xml"]));
  const sheets: XlsxSheet[] = [];

  for (const s of (wbDoc.workbook?.sheets?.sheet ?? []) as Node[]) {
    // removeNSPrefix turns r:id into "id"; the sheet's own numeric id is "sheetId".
    const part = wbRels.get(String(s["@_id"] ?? ""));
    if (!part || !files[part]) continue;
    const doc = parser.parse(strFromU8(files[part]));
    const grid = new Map<number, Map<number, string>>();
    let maxRow = 0;
    let maxCol = 0;

    for (const row of (doc.worksheet?.sheetData?.row ?? []) as Node[]) {
      for (const c of (row.c ?? []) as Node[]) {
        const ref = parseRef(String(c["@_r"] ?? ""));
        if (!ref) continue;
        const t = c["@_t"];
        let value: string;
        if (t === "s") value = shared[Number(textOf(c.v))] ?? "";
        else if (t === "inlineStr") value = stringItem(c.is);
        else value = textOf(c.v);
        if (value === "") continue;
        if (!grid.has(ref.row)) grid.set(ref.row, new Map());
        grid.get(ref.row)!.set(ref.col, value);
        maxRow = Math.max(maxRow, ref.row);
        maxCol = Math.max(maxCol, ref.col);
      }
    }

    sheets.push({
      name: String(s["@_name"] ?? ""),
      maxRow,
      maxCol,
      cell: (r, c) => grid.get(r)?.get(c) ?? "",
      cells: () =>
        [...grid.entries()]
          .sort((a, b) => a[0] - b[0])
          .flatMap(([row, cols]) =>
            [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([col, value]) => ({ row, col, value }))
          ),
      images: readImages(files, part),
    });
  }

  return { sheets, sheet: (name) => sheets.find((s) => s.name === name) };
}
