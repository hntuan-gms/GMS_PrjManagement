import { sectionsToAdf } from "../adf.js";
import { label, type CaseState, type KbktBug, type KbktCase, type KbktImage, type KbktWorkbook } from "./parse.js";
import type { KbktSettings, SpecKind } from "./settings.js";

/**
 * The desired Jira state for one workbook — a pure port of `build_specs` in
 * jira_sync.py. Nothing here talks to Jira; sync.ts compares these specs with
 * what exists and decides what to create, update or move.
 *
 * Issues are matched by **label**, and those labels are the compatibility
 * contract with the script: an issue it created must be found again here, or
 * the first import from the site duplicates every test case. Do not route them
 * through taskService's cleanLabels (it folds whitespace to "-", these use "_").
 */

export const RESULT_LABELS: Record<CaseState, string> = {
  pass: "result-pass",
  fail: "result-fail",
  pending: "result-pending",
  notrun: "result-notrun",
};

export interface Spec {
  kind: SpecKind;
  /** The issue's identifying label, e.g. "tc-1E_127_4". */
  id: string;
  /** Issue type name from settings; replaced by the project's exact spelling before syncing. */
  type: string;
  /** Target status, or null to leave it alone (the Story). */
  status: string | null;
  labels: string[];
  summary: string;
  description: ReturnType<typeof sectionsToAdf> | null;
  priority?: string | null;
  images?: KbktImage[];
  /** Don't create it if it doesn't exist yet: a closed/withdrawn bug nobody synced. */
  skipIfNew?: boolean;
  /** Only move an existing issue's status; never touch its fields. */
  onlyStatus?: boolean;
}

export interface SpecPlan {
  specs: Spec[];
  /** [test label, bug label] pairs to link. */
  links: Array<[string, string]>;
  warns: string[];
}

export function summary(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= 255 ? one : one.slice(0, 254) + "…";
}

function short(s: string, n = 70): string {
  const one = s.replace(/\n/g, " ");
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "AI-33_1E127_….xlsx" → "AI-33": the existing issue that holds this
 * workbook's test cases. Only a real key (digits) — "AI-xx_…" means "no Story
 * yet, make one". The script hard-coded the "AI" project; any key shape works here.
 */
export function storyKeyFromFileName(fileName: string): string | null {
  const m = /^([A-Za-z][A-Za-z0-9]*-\d+)_/.exec(baseName(fileName));
  return m ? m[1].toUpperCase() : null;
}

/** "…_v3.xlsx" → 3, no suffix → 0. The highest version of a code wins. */
export function fileVersion(fileName: string): number {
  const m = /_v(\d+)\.xlsx$/i.exec(fileName);
  return m ? Number(m[1]) : 0;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Priority for a severity: exact first, then case-insensitive (a stray capital in the sheet). */
function priorityFor(settings: KbktSettings, sev: string): string | null {
  if (!sev) return null;
  if (settings.priority[sev]) return settings.priority[sev];
  const want = sev.toLowerCase();
  const hit = Object.entries(settings.priority).find(([k]) => k.toLowerCase() === want);
  return hit ? hit[1] : null;
}

export function buildSpecs(wb: KbktWorkbook, fileName: string, settings: KbktSettings): SpecPlan {
  const { code, cases } = wb;
  const fname = baseName(fileName);
  const types = settings.issueTypes;
  const st = settings.status;
  const wl = label("kbkt-" + code);
  const warns = [...wb.warns];
  const specs: Spec[] = [];
  const links: Array<[string, string]> = [];
  // The file name lives only on the Story, so a new _vN file doesn't rewrite every issue.
  const src = (sheet: string, row: number) => `Sheet "${sheet}", dòng ${row}`;
  const stateStatus: Record<CaseState, string> = { pass: st.pass, fail: st.fail, pending: st.pending, notrun: st.notrun };

  const cnt = { P: 0, F: 0, PE: 0, "-": 0 } as Record<string, number>;
  for (const c of cases) cnt[c.latest || "-"] = (cnt[c.latest || "-"] ?? 0) + 1;

  const storyId = label("story-" + code);
  // "AI-33_1E127_….xlsx" → "AI-33 - <title>"; "AI-xx_…" → "AI-xx - <title>"; otherwise "[code] <title>".
  const m = /^([A-Za-z][A-Za-z0-9]*-(?:\d+|xx))(?=_)/i.exec(fname);
  const name = m ? `${m[1].toUpperCase().replace(/-XX$/, "-xx")} -` : `[${code}]`;
  specs.push({
    kind: "story",
    id: storyId,
    type: types.story,
    status: null,
    labels: [wl, storyId].sort(),
    summary: summary(`${name} ${wb.title.replace(new RegExp(`^\\[#?\\s*${escapeRegExp(code)}\\]\\s*`), "")}`),
    description: sectionsToAdf([
      ["Chức năng", wb.title],
      ["File kịch bản", fname],
      [
        "Kết quả",
        `Tổng: ${cases.length} | Đạt (P): ${cnt.P} | Không đạt (F): ${cnt.F} | Đang xem xét (PE): ${cnt.PE} | Chưa thực hiện: ${cnt["-"]}`,
      ],
    ]),
  });

  for (const c of cases) {
    const tid = label("tc-" + c.id);
    const runs = c.results.map(([n, x]) => `${n}: ${x}`).join("\n") || "Chưa thực hiện";
    specs.push({
      kind: "test",
      id: tid,
      type: types.test,
      status: stateStatus[c.state],
      labels: [...new Set([wl, tid, RESULT_LABELS[c.state]])].sort(),
      summary: summary(`[${c.id}] ${c.purpose}`),
      description: sectionsToAdf([
        ["Nhóm", c.section],
        ["Mục đích kiểm thử", c.purpose],
        ["Các bước thực hiện", c.steps],
        ["Kết quả mong muốn", c.expected],
        ["Kết quả kiểm thử", runs],
        ["Kết quả hiện tại", c.actual],
        ["Mã lỗi", c.bug],
        ["Ghi chú", c.note],
        ["Nguồn", src(wb.sheet, c.row)],
      ]),
    });
  }

  const refs = new Map<string, KbktCase[]>();
  for (const c of cases) {
    for (const b of c.bugs) {
      if (!refs.has(b)) refs.set(b, []);
      refs.get(b)!.push(c);
    }
  }
  const bugs = new Map<string, KbktBug>(wb.bugs);
  for (const [b, rs] of refs) {
    if (!bugs.has(b)) {
      warns.push(`${b} được nhắc ở ${rs.map((c) => c.id).join(", ")} nhưng không có trong sheet "Danh sách lỗi".`);
      bugs.set(b, { sev: "", status: "", desc: rs[0].purpose, basis: "", cause: "", evidence: "", row: null });
    }
  }
  for (const b of wb.images.keys()) {
    if (!bugs.has(b)) warns.push(`Có hình cho ${b} nhưng ${b} không có trong "Danh sách lỗi" — không đính kèm.`);
  }

  for (const [bid, info] of bugs) {
    const rs = refs.get(bid) ?? [];
    const sheetOpen = !/đóng|rút/.test(info.status.toLowerCase());
    let isOpen: boolean;
    if (rs.some((c) => c.state === "fail")) {
      isOpen = true;
      if (!sheetOpen) warns.push(`${bid} đang là "${info.status}" trong file nhưng vẫn có dòng kiểm thử không đạt nhắc tới — giữ trạng thái mở.`);
    } else if (rs.length > 0 && rs.every((c) => c.state === "pass")) {
      isOpen = false;
    } else {
      isOpen = sheetOpen;
    }
    const bl = label(`bug-${code}_${bid}`);
    const tests = rs.map((c) => `${c.id} (${c.latest || "chưa thực hiện"}) - ${short(c.purpose, 120)}`).join("\n");
    const imgs = wb.images.get(bid) ?? [];
    specs.push({
      kind: "bug",
      id: bl,
      type: types.bug,
      status: isOpen ? st.bugOpen : st.bugClosed,
      skipIfNew: !isOpen,
      labels: [wl, bl].sort(),
      priority: priorityFor(settings, info.sev),
      images: imgs,
      summary: summary(`[${code}][${bid}] ${info.desc}`),
      description: sectionsToAdf([
        ["Mô tả", info.desc],
        ["Mức độ", info.sev],
        ["Trạng thái trong file", info.status],
        ["Căn cứ", info.basis],
        ["Nguyên nhân", info.cause],
        ["Bằng chứng / tái hiện", info.evidence],
        ["Hình ảnh minh chứng (đính kèm)", imgs.map((i) => `${i.filename} - ${i.caption}`).join("\n")],
        ["Test case liên quan", tests],
        ["Nguồn", info.row ? src("Danh sách lỗi", info.row) : ""],
      ]),
    });
    for (const c of rs) links.push([label("tc-" + c.id), bl]);
  }

  // Failed rows without a bug code get a bug of their own.
  for (const c of cases) {
    if (c.state !== "fail" || c.bugs.length > 0) continue;
    const bl = label("bug-" + c.id);
    specs.push({
      kind: "bug",
      id: bl,
      type: types.bug,
      status: st.bugOpen,
      skipIfNew: false,
      labels: [wl, bl].sort(),
      priority: null,
      summary: summary(`[${c.id}] ${c.purpose}`),
      description: sectionsToAdf([
        ["Mục đích kiểm thử", c.purpose],
        ["Các bước thực hiện", c.steps],
        ["Kết quả mong muốn", c.expected],
        ["Kết quả hiện tại", c.actual],
        ["Ghi chú", c.note],
        ["Nguồn", src(wb.sheet, c.row)],
      ]),
    });
    links.push([label("tc-" + c.id), bl]);
  }

  // Such a bug from an earlier sync, for a row that no longer fails: close it.
  for (const c of cases) {
    if (c.state === "fail" || c.bugs.length > 0) continue;
    const bl = label("bug-" + c.id);
    specs.push({
      kind: "bug",
      id: bl,
      type: types.bug,
      status: st.bugClosed,
      skipIfNew: true,
      onlyStatus: true,
      labels: [wl, bl].sort(),
      priority: null,
      summary: "",
      description: null,
    });
  }

  return { specs, links, warns };
}
