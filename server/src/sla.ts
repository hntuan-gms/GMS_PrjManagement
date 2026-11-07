import { badRequest } from "./errors.js";

/**
 * A project's SLA policy: how long each priority may stay open, counted in
 * working time on the project's own business calendar. One row per project
 * (slaStore.ts). The clock itself is computed in the browser (client/src/sla.ts):
 * this file only decides what a valid policy is.
 *
 * Priorities and issue types are stored by name, the way Task carries them.
 */
/**
 * The project's working calendar: which days are worked. It is stored inside the SLA row (one row per
 * project, sla_settings) but is not only the SLA's: the resource heatmap, the timesheet, sprint capacity
 * and the assistant's workload all read it through workCalendar.ts, whether SLA is switched on or not.
 * Edited in its own dialog (PUT /api/calendar); PUT /api/sla/settings never writes these three fields.
 */
export interface WorkCalendarSettings {
  /** ISO weekdays that are working days, 1 = Monday … 7 = Sunday. */
  workDays: number[];
  /** Days off for everyone, one entry per date (a holiday of several days is several entries). */
  holidays: Array<{ date: string; name: string }>;
  /** Days worked although their weekday is not in workDays ("ngày làm bù", e.g. a Saturday before Tết). */
  makeUpDays: Array<{ date: string; name: string }>;
  /** Working periods of a day, "HH:mm", ascending and not overlapping. */
  periods: Array<{ start: string; end: string }>;
  /**
   * The calendar's timezone, minutes east of UTC. Fixed in the project rather than taken from each
   * browser, so everyone sees the same deadline for the same issue.
   */
  tzOffsetMinutes: number;
}

/** The fields that belong to the calendar rather than to the SLA policy itself. */
export const CALENDAR_KEYS = ["workDays", "holidays", "makeUpDays", "periods", "tzOffsetMinutes"] as const;

export interface SlaSettings extends WorkCalendarSettings {
  /** Off until someone turns it on, so a project's old work never shows up as "late" by surprise. */
  enabled: boolean;
  /** Only issues created on or after this day (YYYY-MM-DD) are measured. */
  appliesFrom: string | null;
  /** Working hours allowed per priority; null = no SLA for that priority. */
  targets: Array<{ priority: string; hours: number | null }>;
  /** "Sắp trễ" once the remaining time is at most this share of the target. 0 = never warn. */
  warnPercent: number;
  /** Issue types measured; empty = every type except Epic. */
  issueTypes: string[];
}

export const DEFAULT_SLA_SETTINGS: SlaSettings = {
  enabled: false,
  appliesFrom: null,
  targets: [
    { priority: "Highest", hours: 4 },
    { priority: "High", hours: 16 },
    { priority: "Medium", hours: 40 },
    { priority: "Low", hours: 80 },
    { priority: "Lowest", hours: null },
  ],
  warnPercent: 25,
  issueTypes: [],
  workDays: [1, 2, 3, 4, 5],
  periods: [
    { start: "08:00", end: "12:00" },
    { start: "13:00", end: "17:00" },
  ],
  holidays: [],
  makeUpDays: [],
  tzOffsetMinutes: 420,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TARGET_HOURS = 10_000;
const MAX_HOLIDAYS = 400;

function fail(message: string): never {
  throw badRequest(`Cài đặt SLA: ${message}`);
}

function calendarFail(message: string): never {
  throw badRequest(`Lịch làm việc: ${message}`);
}

function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function name(v: unknown, max = 100): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Request body → policy, or a 400 naming what is wrong. Unknown keys are dropped. */
export function validateSlaSettings(raw: unknown): SlaSettings {
  const b = (raw ?? {}) as Record<string, any>;

  if (b.appliesFrom != null && b.appliesFrom !== "" && !isRealDate(b.appliesFrom)) {
    fail("ngày \"Áp dụng cho việc tạo từ\" không hợp lệ.");
  }

  const targets: SlaSettings["targets"] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(b.targets) ? b.targets : []) {
    const priority = name(t?.priority);
    if (!priority || seen.has(priority.toLowerCase())) continue;
    seen.add(priority.toLowerCase());
    let hours: number | null = null;
    if (t?.hours != null && t.hours !== "") {
      const h = Number(t.hours);
      if (!Number.isFinite(h) || h <= 0 || h > MAX_TARGET_HOURS) {
        fail(`thời hạn của mức "${priority}" phải là số giờ lớn hơn 0 và không quá ${MAX_TARGET_HOURS}.`);
      }
      hours = Math.round(h * 100) / 100;
    }
    targets.push({ priority, hours });
  }

  const warn = b.warnPercent == null ? DEFAULT_SLA_SETTINGS.warnPercent : Number(b.warnPercent);
  if (!Number.isInteger(warn) || warn < 0 || warn > 90) fail("ngưỡng \"Sắp trễ\" phải là số nguyên từ 0 đến 90 (%).");

  const issueTypes = [...new Set((Array.isArray(b.issueTypes) ? b.issueTypes : []).map((t: unknown) => name(t)).filter(Boolean))] as string[];

  const calendar = validateCalendar(b, fail);

  return {
    enabled: b.enabled === true,
    appliesFrom: isRealDate(b.appliesFrom) ? b.appliesFrom : null,
    targets,
    warnPercent: warn,
    issueTypes,
    ...calendar,
  };
}

function datedList(raw: unknown, what: string, onFail: (m: string) => never): Array<{ date: string; name: string }> {
  const byDate = new Map<string, string>();
  for (const h of Array.isArray(raw) ? raw : []) {
    if (!isRealDate(h?.date)) onFail(`${what} "${String(h?.date ?? "")}" không hợp lệ.`);
    if (!byDate.has(h.date)) byDate.set(h.date, name(h?.name));
  }
  if (byDate.size > MAX_HOLIDAYS) onFail(`tối đa ${MAX_HOLIDAYS} ${what}.`);
  return [...byDate].sort(([a], [b2]) => a.localeCompare(b2)).map(([date, n]) => ({ date, name: n }));
}

/**
 * The calendar part of a request body, or a 400 naming what is wrong. Shared by the SLA dialog's validation
 * (which still accepts a whole policy) and PUT /api/calendar. A date cannot be both a holiday and a make-up day:
 * which one wins would be a guess.
 */
export function validateCalendar(raw: unknown, onFail: (m: string) => never = calendarFail): WorkCalendarSettings {
  const b = (raw ?? {}) as Record<string, any>;
  const workDays = [...new Set((Array.isArray(b.workDays) ? b.workDays : []).map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((x, y) => x - y);
  if (workDays.length === 0) onFail("cần ít nhất một ngày làm việc trong tuần.");
  const holidays = datedList(b.holidays, "ngày lễ", onFail);
  const makeUpDays = datedList(b.makeUpDays, "ngày làm bù", onFail);
  const off = new Set(holidays.map((h) => h.date));
  const clash = makeUpDays.find((m) => off.has(m.date));
  if (clash) onFail(`ngày ${clash.date.split("-").reverse().join("/")} không thể vừa là ngày lễ vừa là ngày làm bù.`);
  const periods = (Array.isArray(b.periods) ? b.periods : []).map((p: any) => ({ start: String(p?.start ?? ""), end: String(p?.end ?? "") }));
  if (periods.length === 0 || periods.length > 3) onFail("cần từ 1 đến 3 khung giờ làm việc.");
  for (const p of periods) {
    if (!HHMM.test(p.start) || !HHMM.test(p.end)) onFail(`khung giờ "${p.start}–${p.end}" phải có dạng HH:mm.`);
    if (minutesOf(p.start) >= minutesOf(p.end)) onFail(`khung giờ "${p.start}–${p.end}" phải kết thúc sau khi bắt đầu.`);
  }
  periods.sort((x: { start: string }, y: { start: string }) => minutesOf(x.start) - minutesOf(y.start));
  for (let i = 1; i < periods.length; i++) {
    if (minutesOf(periods[i].start) < minutesOf(periods[i - 1].end)) {
      onFail(`khung giờ "${periods[i - 1].start}–${periods[i - 1].end}" và "${periods[i].start}–${periods[i].end}" bị chồng nhau.`);
    }
  }

  const tz = b.tzOffsetMinutes == null ? DEFAULT_SLA_SETTINGS.tzOffsetMinutes : Number(b.tzOffsetMinutes);
  if (!Number.isInteger(tz) || tz < -720 || tz > 840) onFail("múi giờ không hợp lệ.");

  return { workDays, holidays, makeUpDays, periods, tzOffsetMinutes: tz };
}

/** The calendar fields of a policy. */
export function calendarOf(s: SlaSettings): WorkCalendarSettings {
  return { workDays: s.workDays, holidays: s.holidays, makeUpDays: s.makeUpDays, periods: s.periods, tzOffsetMinutes: s.tzOffsetMinutes };
}

/** The SLA fields of a policy, i.e. everything PUT /api/sla/settings may write. */
export function slaFieldsOf(s: SlaSettings): Omit<SlaSettings, (typeof CALENDAR_KEYS)[number]> {
  const out: Record<string, unknown> = { ...s };
  for (const k of CALENDAR_KEYS) delete out[k];
  return out as Omit<SlaSettings, (typeof CALENDAR_KEYS)[number]>;
}

/** A stored row over the defaults, so a field added later has a value for projects saved before it. */
export function withSlaDefaults(stored: Partial<SlaSettings> | null | undefined): SlaSettings {
  const d = structuredClone(DEFAULT_SLA_SETTINGS);
  if (!stored) return d;
  return {
    enabled: stored.enabled ?? d.enabled,
    appliesFrom: stored.appliesFrom ?? d.appliesFrom,
    targets: stored.targets ?? d.targets,
    warnPercent: stored.warnPercent ?? d.warnPercent,
    issueTypes: stored.issueTypes ?? d.issueTypes,
    workDays: stored.workDays ?? d.workDays,
    periods: stored.periods ?? d.periods,
    holidays: stored.holidays ?? d.holidays,
    makeUpDays: stored.makeUpDays ?? d.makeUpDays,
    tzOffsetMinutes: stored.tzOffsetMinutes ?? d.tzOffsetMinutes,
  };
}
