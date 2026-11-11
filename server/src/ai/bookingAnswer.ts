import { canWrite, roleOf, shapeForViewer, visibleAccounts, type Booking, type Viewer } from "../booking.js";
import { bookedWeeks } from "../bookingLoad.js";
import { DEFAULT_CAPACITY_HOURS, type ResourceAbsence, type ResourceProfile } from "../resourceStore.js";
import type { JiraUser } from "../types.js";
import { isWorkingDate, type WorkCalendar } from "../workCalendar.js";
import { addDays, ISO_DATE, resolvePerson } from "./toolUtils.js";

/**
 * What the assistant's `bookings` tool answers (server/test/bookingAnswer.test.ts), apart from tools.ts so it
 * needs no database: everything it reads is handed in.
 *
 * It applies the Booking screen's own rules (booking.ts) to the person who is asking, because the model must
 * not be a way around them:
 *  - a member sees their own bookings only; a project manager the people booked on projects they manage and
 *    the team of this project; a resource manager everyone;
 *  - a booking on a project the asker cannot browse is "dự án khác" — no key, no note;
 *  - asking about someone the asker may not see is an explicit refusal, never an empty list (an empty list
 *    reads as "free" and the model would say so).
 */

const WINDOW_DAYS = 120;
const MAX_PEOPLE = 40;

export interface BookingsAnswerInput {
  person: string;
  from: string;
  to: string;
  today: string;
  /** The project the conversation is about. */
  projectKey: string;
  team: JiraUser[];
  bookings: readonly Booking[];
  viewer: Viewer;
  profiles: readonly ResourceProfile[];
  absences: readonly ResourceAbsence[];
  calendar: WorkCalendar;
  /** Names for account ids that are not in `team`. */
  names: (ids: string[]) => Promise<Map<string, string>>;
}

export async function bookingsAnswer(input: BookingsAnswerInput): Promise<Record<string, unknown>> {
  const from = ISO_DATE.test(input.from) ? input.from : input.today;
  let to = ISO_DATE.test(input.to) && input.to >= from ? input.to : addDays(from, 27);
  if (to > addDays(from, WINDOW_DAYS)) to = addDays(from, WINDOW_DAYS);

  const { viewer, team } = input;
  const inWindow = input.bookings.filter((b) => b.to >= from && b.from <= to);
  const teamIds = team.map((u) => u.accountId);
  const manages = canWrite(viewer, input.projectKey);
  const visible = visibleAccounts(viewer, inWindow, manages ? teamIds : []);
  const role = roleOf(viewer);
  const covers = (id: string) => visible === "all" || visible.has(id);

  let subjects: string[];
  if (input.person.trim()) {
    const found = resolvePerson(team, input.person);
    if ("error" in found) return found;
    if (!covers(found.person.accountId)) {
      return {
        error: "Bạn chỉ xem được booking của mình.",
        role,
        instruction: "Nói rõ với người dùng là họ không có quyền xem booking của người này; đừng suy đoán từ nguồn khác.",
      };
    }
    subjects = [found.person.accountId];
  } else {
    const booked = inWindow.map((b) => b.accountId);
    subjects = [...new Set([viewer.accountId, ...(manages ? teamIds : []), ...booked])].filter(covers).slice(0, MAX_PEOPLE);
  }

  const shaped = shapeForViewer(viewer, inWindow, visible);
  const known = new Map(team.map((u) => [u.accountId, u.displayName]));
  const strangers = subjects.filter((id) => !known.has(id));
  const extra = strangers.length > 0 ? await input.names(strangers).catch(() => new Map<string, string>()) : new Map<string, string>();
  const profileOf = new Map(input.profiles.map((p) => [p.accountId, p]));

  const people = subjects.map((accountId) => {
    const capacity = profileOf.get(accountId)?.capacityHoursPerDay ?? DEFAULT_CAPACITY_HOURS;
    const away = input.absences.filter((a) => a.accountId === accountId);
    const isOff = (d: string) => !isWorkingDate(d, input.calendar) || away.some((a) => d >= a.from && d <= a.to);
    const mine = shaped.filter((b) => b.accountId === accountId);
    const weeks = bookedWeeks({ bookings: mine, capacityHoursPerDay: capacity, from, to, isOff });
    return {
      accountId,
      name: known.get(accountId) ?? extra.get(accountId) ?? "Không rõ",
      capacityHoursPerDay: capacity,
      weeks: weeks.map((w) => ({ from: w.from, to: w.to, bookedHours: w.booked, capacityHours: w.capacity, freeHours: w.free, over: w.over })),
      overWeeks: weeks.filter((w) => w.over).length,
      freeHours: Math.round(weeks.reduce((s, w) => s + w.free, 0) * 10) / 10,
      bookings: mine.map((b) => ({
        project: b.projectKey ?? "dự án khác",
        from: b.from,
        to: b.to,
        hoursPerDay: b.hoursPerDay,
        status: b.status === "confirmed" ? "chắc" : "dự kiến",
      })),
    };
  });

  const partial = visible !== "all" && teamIds.some((id) => !visible.has(id));
  return {
    window: `${from} → ${to}`,
    role,
    people,
    ...(partial
      ? {
          limited: true,
          note:
            role === "member"
              ? "Bạn chỉ xem được booking của mình; người khác không có trong kết quả không có nghĩa là họ rảnh."
              : "Chỉ có những người bạn được xem; người vắng mặt trong kết quả không có nghĩa là họ rảnh.",
        }
      : {}),
  };
}
