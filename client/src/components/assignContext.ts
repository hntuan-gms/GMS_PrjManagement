import { createContext, useContext } from "react";
import type { ResourceLoad } from "../resourceAllocation";
import type { JiraUser, Task } from "../types";
import type { WorkCalendar } from "../workCalendar";

/**
 * What an avatar on a board card or backlog row needs to open the shared person picker with
 * hints (plan G9): the people, the workspace task behind an issue key (its dates are what a hint
 * is measured over) and the load inside those dates. The load is asked for per task, when a
 * picker opens, so a 4000-task project does not build a heatmap nobody looked at.
 */
export interface AssignContextValue {
  people: JiraUser[];
  taskFor: (key: string) => Task | undefined;
  loadFor: (task: Task) => Pick<ResourceLoad, "people"> | null;
  calendar: WorkCalendar;
  meAccountId: string;
}

export const AssignContext = createContext<AssignContextValue | null>(null);

export const useAssignContext = () => useContext(AssignContext);
