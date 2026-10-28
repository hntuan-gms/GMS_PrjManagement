import { badRequest } from "../errors.js";
import { FIELD_SOURCES, type MappedKind } from "./fields.js";

/**
 * What jira_sync_config.json used to hard-code, now one row per Jira project
 * (kbktSettingsStore.ts). Names, not ids: they are what a person types and
 * reads, and the sync resolves each against the project's real issue types and
 * the issue's real transitions on every run, reporting a mismatch instead of
 * writing a wrong value.
 */
export type SpecKind = "story" | "test" | "bug";

export interface KbktSettings {
  issueTypes: { story: string; test: string; bug: string };
  status: {
    pass: string;
    fail: string;
    pending: string;
    notrun: string;
    bugOpen: string;
    bugClosed: string;
  };
  /** Severity as written in "Danh sách lỗi" ("Cao") → this site's priority name ("High"). */
  priority: Record<string, string>;
  linkType: string;
  /** Which new issues get the run's due date. Only on create, so a date changed in Jira is kept. */
  dueDateOn: SpecKind[];
  /**
   * Per kind: section key (kbkt/fields.ts FIELD_SOURCES) → Jira field id. A kind
   * left out is matched by field name on every run; a section left out of a
   * saved map stays in the description.
   */
  fieldMap?: Partial<Record<MappedKind, Record<string, string>>>;
}

/** jira_sync_config.json as it stood when the script moved here. */
export const DEFAULT_SETTINGS: KbktSettings = {
  issueTypes: { story: "Story", test: "Sub Testcase", bug: "Sub Bug" },
  status: {
    pass: "Passed",
    fail: "Failed",
    pending: "Pending",
    notrun: "Not run",
    bugOpen: "To Do",
    bugClosed: "Done",
  },
  priority: { Cao: "High", "Trung bình": "Medium", Thấp: "Low" },
  linkType: "Relates",
  dueDateOn: ["story", "test", "bug"],
};

const KINDS: SpecKind[] = ["story", "test", "bug"];

function str(v: unknown, field: string, max = 255): string {
  if (typeof v !== "string" || !v.trim()) throw badRequest(`Cấu hình nhập KBKT: thiếu "${field}".`);
  return v.trim().slice(0, max);
}

/** Request body → settings, or a 400 naming the field. Unknown keys are dropped. */
export function validateSettings(raw: unknown): KbktSettings {
  const b = (raw ?? {}) as Record<string, any>;
  const priority: Record<string, string> = {};
  if (b.priority && typeof b.priority === "object" && !Array.isArray(b.priority)) {
    for (const [sev, name] of Object.entries(b.priority)) {
      if (typeof name === "string" && sev.trim() && name.trim()) priority[sev.trim()] = name.trim();
    }
  }
  return {
    issueTypes: {
      story: str(b.issueTypes?.story, "Loại issue Story"),
      test: str(b.issueTypes?.test, "Loại issue test case"),
      bug: str(b.issueTypes?.bug, "Loại issue lỗi"),
    },
    status: {
      pass: str(b.status?.pass, "Trạng thái Đạt"),
      fail: str(b.status?.fail, "Trạng thái Không đạt"),
      pending: str(b.status?.pending, "Trạng thái Đang xem xét"),
      notrun: str(b.status?.notrun, "Trạng thái Chưa thực hiện"),
      bugOpen: str(b.status?.bugOpen, "Trạng thái lỗi đang mở"),
      bugClosed: str(b.status?.bugClosed, "Trạng thái lỗi đã đóng"),
    },
    priority,
    linkType: str(b.linkType, "Kiểu liên kết"),
    dueDateOn: Array.isArray(b.dueDateOn) ? KINDS.filter((k) => b.dueDateOn.includes(k)) : [],
    ...fieldMapFrom(b.fieldMap),
  };
}

/** Only known section keys, only field-id-shaped values; a kind that isn't an object is left to name matching. */
function fieldMapFrom(raw: unknown): Pick<KbktSettings, "fieldMap"> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<MappedKind, Record<string, string>>> = {};
  for (const kind of ["test", "bug"] as const) {
    const m = (raw as Record<string, unknown>)[kind];
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const keys = new Set(FIELD_SOURCES[kind].map((s) => s.key));
    out[kind] = Object.fromEntries(
      Object.entries(m as Record<string, unknown>).filter(
        ([k, v]) => keys.has(k) && typeof v === "string" && /^(customfield_\d+|environment)$/.test(v)
      )
    ) as Record<string, string>;
  }
  return Object.keys(out).length ? { fieldMap: out } : {};
}

/**
 * A stored row merged over the defaults, so a field added later has a value for
 * projects that saved their settings before it existed.
 */
export function withDefaults(stored: Partial<KbktSettings> | null | undefined): KbktSettings {
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  return {
    issueTypes: { ...DEFAULT_SETTINGS.issueTypes, ...stored.issueTypes },
    status: { ...DEFAULT_SETTINGS.status, ...stored.status },
    priority: stored.priority ?? { ...DEFAULT_SETTINGS.priority },
    linkType: stored.linkType ?? DEFAULT_SETTINGS.linkType,
    dueDateOn: stored.dueDateOn ?? [...DEFAULT_SETTINGS.dueDateOn],
    // Absent for every project saved before fields existed: those match by name.
    ...(stored.fieldMap ? { fieldMap: stored.fieldMap } : {}),
  };
}
