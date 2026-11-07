import type { TaskFilter } from "./taskFilter";

/*
 * Where the "Nhịp dự án" page starts (plan E1): the filter set on the plan, as far as the report can say it.
 * The report narrows by one person, one Epic and a set of types, so a plan filter on exactly those carries
 * over; anything else the plan is filtering by (status, label, JQL, ...) cannot be, and is named in a note
 * rather than silently dropped. Pure and React-free, so the rule is tested without a browser.
 */

export interface ReportScopeDefault {
  /** An account id, "none" for unassigned, or "" for everyone. */
  assignee: string;
  /** An Epic key, or "". */
  epic: string;
  types: string[];
  /** What the plan filters by that the report cannot; null when nothing is lost. */
  note: string | null;
}

type Source = Pick<
  TaskFilter,
  "text" | "people" | "epics" | "types" | "statuses" | "labels" | "components" | "versions" | "sprints" | "priorities" | "onlyOverdue" | "onlySlaBreached" | "jql"
>;

export const EMPTY_REPORT_SCOPE: ReportScopeDefault = { assignee: "", epic: "", types: [], note: null };

/** Facets the report has no control for, as the words used in the note. */
function unsupportedFacets(f: Source): string[] {
  const out: string[] = [];
  if (f.people.size > 1) out.push("nhiều người");
  if (f.epics.size > 1) out.push("nhiều giai đoạn");
  if (f.text.trim()) out.push("từ khoá");
  if (f.statuses.size > 0) out.push("trạng thái");
  if (f.labels.size > 0) out.push("nhãn");
  if (f.components.size > 0) out.push("thành phần");
  if (f.versions.size > 0) out.push("phiên bản");
  if (f.sprints.size > 0) out.push("sprint");
  if (f.priorities.size > 0) out.push("ưu tiên");
  if (f.onlyOverdue) out.push("quá hạn");
  if (f.onlySlaBreached) out.push("trễ SLA");
  if (f.jql.trim()) out.push("JQL");
  return out;
}

/**
 * One person or one Epic becomes the report's scope; any number of types does (the report takes a set).
 * With several people or Epics the report starts on everything and the note says why.
 */
export function scopeFromTaskFilter(filter: Source | undefined | null): ReportScopeDefault {
  if (!filter) return EMPTY_REPORT_SCOPE;
  const lost = unsupportedFacets(filter);
  return {
    assignee: filter.people.size === 1 ? [...filter.people][0] : "",
    epic: filter.epics.size === 1 ? [...filter.epics][0] : "",
    types: [...filter.types],
    note: lost.length > 0 ? `Kế hoạch đang lọc thêm theo ${lost.join(", ")}. Nhịp dự án không áp dụng.` : null,
  };
}
