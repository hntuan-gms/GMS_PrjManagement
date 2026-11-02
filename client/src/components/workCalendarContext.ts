import { createContext, useContext } from "react";
import { DEFAULT_WORK_CALENDAR, type WorkCalendar } from "../workCalendar";

/**
 * The open project's working calendar (weekdays, holidays, make-up days), provided once by ProjectWorkspace
 * from the SLA row it already loads. A context rather than a prop because the board's sprint header and cards
 * sit several components deep. Outside a provider (tests, a component rendered alone) it is Monday–Friday.
 */
export const WorkCalendarContext = createContext<WorkCalendar>(DEFAULT_WORK_CALENDAR);

export function useWorkCalendar(): WorkCalendar {
  return useContext(WorkCalendarContext);
}
