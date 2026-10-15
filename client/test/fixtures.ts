import type { Task } from "../src/types";

const base: Task = {
  id: "X-0",
  wbsParentId: null,
  summary: "",
  description: null,
  issueType: "Task",
  statusName: "To Do",
  statusCategory: "new",
  assigneeAccountId: null,
  assigneeName: null,
  assigneeAvatarUrl: null,
  startDate: "2026-10-01",
  dueDate: "2026-10-10",
  durationDays: 10,
  percentComplete: 0,
  predecessors: [],
  baselineStart: "2026-10-01",
  baselineDue: "2026-10-10",
  estimateHours: null,
  spentHours: null,
  priority: "Medium",
  labels: [],
  jiraUrl: "",
};

export const task = (o: Partial<Task> & Pick<Task, "id" | "summary">): Task => ({ ...base, ...o });

export const sampleProject = (): Task[] => [
  task({ id: "P-1", summary: "Phase A", issueType: "Epic" }),
  task({ id: "P-2", summary: "Phase B", issueType: "Epic" }),
  task({ id: "P-3", summary: "Story with subs", issueType: "Story", wbsParentId: "P-1", assigneeAccountId: "boss", assigneeName: "Boss" }),
  task({ id: "P-4", summary: "sub of anh", issueType: "Sub-task", wbsParentId: "P-3", assigneeAccountId: "anh", assigneeName: "Anh", statusCategory: "done", statusName: "Done" }),
  task({ id: "P-5", summary: "sub of binh", issueType: "Sub-task", wbsParentId: "P-3", assigneeAccountId: "binh", assigneeName: "Binh" }),
  task({ id: "P-6", summary: "task B", issueType: "Task", wbsParentId: "P-2", assigneeAccountId: "anh", assigneeName: "Anh", dueDate: "2026-10-05" }),
  task({ id: "P-7", summary: "bug", issueType: "Bug", wbsParentId: "P-2", labels: ["urgent"] }),
];
