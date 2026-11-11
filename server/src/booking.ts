/**
 * Booking: the rules, with no database and no Jira in them (server/test/booking.test.ts).
 *
 * A booking is "this person, this project, these dates, this many hours a day". Three kinds of
 * people look at them:
 *  - a member sees their own, on every project;
 *  - a project manager (someone Jira lets administer a project) sees the people booked on the
 *    projects they manage, and edits bookings on those projects only;
 *  - a resource manager sees and edits everything.
 *
 * What a manager is shown about a person includes the hours other projects hold: without them
 * a second project would book the same days. The *name* of such a project is shown only when
 * the viewer can browse it in Jira; otherwise the row carries hours and dates and nothing else.
 */
import { badRequest } from "./errors.js";

export type BookingStatus = "tentative" | "confirmed";
export type BookingRole = "member" | "pm" | "manager";

export interface Booking {
  id: string;
  accountId: string;
  projectKey: string;
  from: string;
  to: string;
  hoursPerDay: number;
  status: BookingStatus;
  note: string | null;
  createdBy: string;
}

/** A booking as one viewer is allowed to see it. */
export interface BookingView {
  id: string;
  accountId: string;
  /** null: a project this viewer cannot browse. Hours and dates only. */
  projectKey: string | null;
  from: string;
  to: string;
  hoursPerDay: number;
  status: BookingStatus;
  note: string | null;
  editable: boolean;
}

export interface Viewer {
  accountId: string;
  manager: boolean;
  /** Projects this account administers. */
  pmOf: ReadonlySet<string>;
  /** Projects this account can browse. */
  accessible: ReadonlySet<string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{1,24}$/;
export const MAX_HOURS_PER_DAY = 16;
export const MAX_NOTE = 500;
/** A booking longer than this is a typo in the year, not a plan. */
export const MAX_BOOKING_DAYS = 731;
export const MAX_RANGE_DAYS = 800;

const DAY_MS = 86_400_000;
const isDate = (v: unknown): v is string => typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

export function roleOf(viewer: Viewer): BookingRole {
  return viewer.manager ? "manager" : viewer.pmOf.size > 0 ? "pm" : "member";
}

export function canWrite(viewer: Viewer, projectKey: string): boolean {
  return viewer.accessible.has(projectKey) && (viewer.manager || viewer.pmOf.has(projectKey));
}

/** Leave is entered by the person themselves, or by anyone who manages people. */
export function canEditAbsence(viewer: Viewer, accountId: string): boolean {
  return accountId === viewer.accountId || roleOf(viewer) !== "member";
}

export interface BookingInput {
  accountId: string;
  projectKey: string;
  from: string;
  to: string;
  hoursPerDay: number;
  status: BookingStatus;
  note: string | null;
}

function readHours(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : Number(raw);
  if (raw === null || raw === "" || !Number.isFinite(n) || n <= 0 || n > MAX_HOURS_PER_DAY) {
    throw badRequest(`Giờ mỗi ngày phải lớn hơn 0 và không quá ${MAX_HOURS_PER_DAY}.`);
  }
  // Quarter hours: fine enough for "1,25" typed by hand, coarse enough to read on a bar.
  return Math.max(0.25, Math.round(n * 4) / 4);
}

function readStatus(raw: unknown): BookingStatus {
  if (raw === "tentative" || raw === "confirmed") return raw;
  throw badRequest("Trạng thái booking phải là Dự kiến hoặc Chắc.");
}

function readNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw badRequest("Ghi chú không hợp lệ.");
  const note = raw.trim();
  if (note.length > MAX_NOTE) throw badRequest(`Ghi chú tối đa ${MAX_NOTE} ký tự.`);
  return note || null;
}

function checkRange(from: string, to: string): void {
  if (to < from) throw badRequest("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
  if (daysBetween(from, to) > MAX_BOOKING_DAYS) throw badRequest("Một booking dài tối đa hai năm.");
}

function readAccount(raw: unknown): string {
  const accountId = typeof raw === "string" ? raw.trim() : "";
  if (!accountId || accountId.length > 128) throw badRequest("Thiếu người được book.");
  return accountId;
}

export function validateBookingInput(body: unknown): BookingInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const accountId = readAccount(b.accountId);
  const projectKey = typeof b.projectKey === "string" ? b.projectKey.trim() : "";
  if (!PROJECT_KEY.test(projectKey)) throw badRequest("Thiếu dự án của booking.");
  if (!isDate(b.from) || !isDate(b.to)) throw badRequest("Ngày của booking phải ở dạng YYYY-MM-DD.");
  checkRange(b.from, b.to);
  return {
    accountId,
    projectKey,
    from: b.from,
    to: b.to,
    hoursPerDay: readHours(b.hoursPerDay),
    status: b.status === undefined ? "tentative" : readStatus(b.status),
    note: readNote(b.note),
  };
}

export type BookingPatch = Partial<Pick<BookingInput, "accountId" | "from" | "to" | "hoursPerDay" | "status" | "note">>;

/**
 * The fields of a PATCH that were sent, checked; the range is checked against what is stored for
 * the end that was not sent. The project never changes: a booking moved to another project is a
 * different promise, made by someone who may not manage the first one.
 */
export function validateBookingPatch(body: unknown, current: Pick<Booking, "from" | "to">): BookingPatch {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: BookingPatch = {};
  if (b.projectKey !== undefined) throw badRequest("Không đổi được dự án của booking. Xoá và tạo lại ở dự án kia.");
  if (b.accountId !== undefined) patch.accountId = readAccount(b.accountId);
  for (const key of ["from", "to"] as const) {
    if (b[key] === undefined) continue;
    if (!isDate(b[key])) throw badRequest("Ngày của booking phải ở dạng YYYY-MM-DD.");
    patch[key] = b[key] as string;
  }
  if (patch.from !== undefined || patch.to !== undefined) checkRange(patch.from ?? current.from, patch.to ?? current.to);
  if (b.hoursPerDay !== undefined) patch.hoursPerDay = readHours(b.hoursPerDay);
  if (b.status !== undefined) patch.status = readStatus(b.status);
  if (b.note !== undefined) patch.note = readNote(b.note);
  if (Object.keys(patch).length === 0) throw badRequest("Không có gì để sửa.");
  return patch;
}

export function validateRange(from: unknown, to: unknown): { from: string; to: string } {
  if (!isDate(from) || !isDate(to) || to < from) throw badRequest("Khoảng ngày không hợp lệ.");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw badRequest("Khoảng ngày quá dài.");
  return { from, to };
}

/**
 * Whose rows a viewer gets. "all" for a resource manager; otherwise themselves, everyone booked on
 * a project they manage, and `team` (the members of the project they are looking at, when they
 * manage it, so a person nobody has booked yet still has a row to book on).
 */
export function visibleAccounts(
  viewer: Viewer,
  bookings: readonly Booking[],
  team: readonly string[] = []
): ReadonlySet<string> | "all" {
  if (viewer.manager) return "all";
  const out = new Set<string>([viewer.accountId]);
  for (const b of bookings) if (viewer.pmOf.has(b.projectKey)) out.add(b.accountId);
  for (const id of team) out.add(id);
  return out;
}

/** The bookings of the visible people, each as this viewer may see it. */
export function shapeForViewer(
  viewer: Viewer,
  bookings: readonly Booking[],
  visible: ReadonlySet<string> | "all"
): BookingView[] {
  const out: BookingView[] = [];
  for (const b of bookings) {
    if (visible !== "all" && !visible.has(b.accountId)) continue;
    const named = viewer.accessible.has(b.projectKey);
    out.push({
      id: b.id,
      accountId: b.accountId,
      projectKey: named ? b.projectKey : null,
      from: b.from,
      to: b.to,
      hoursPerDay: b.hoursPerDay,
      status: b.status,
      // A note is written for the people of that project ("chờ ký hợp đồng").
      note: named ? b.note : null,
      editable: canWrite(viewer, b.projectKey),
    });
  }
  return out;
}

/** "a;b; c" → ids. Semicolons: the deploy action splits env_vars on commas. */
export function parseIdList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const fold = (s: string) => s.trim().toLowerCase();

/** A resource manager is named by account id, or belongs to the configured Jira group. */
export function decideManager(
  accountId: string,
  groups: readonly string[] | null,
  cfg: { ids: readonly string[]; group: string | null }
): boolean {
  if (cfg.ids.includes(accountId)) return true;
  if (!cfg.group || !groups) return false;
  const wanted = fold(cfg.group);
  return groups.some((g) => fold(g) === wanted);
}
