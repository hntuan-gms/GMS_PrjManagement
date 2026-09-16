import type { IssueTypeName, JiraUser, Predecessor } from "./types.js";

/**
 * Sample data mirroring the real shape of Jira project HHBJ (gimasys.atlassian.net):
 * Epic -> Story -> Sub-task hierarchy, Vietnamese summaries, status categories.
 * Used only when JIRA_* env vars are not configured, so the app runs out of the box.
 */
export interface MockIssue {
  key: string;
  summary: string;
  issueType: IssueTypeName;
  parentKey: string | null;
  statusName: string;
  statusCategory: "new" | "indeterminate" | "done";
  assigneeAccountId: string | null;
  dueDate: string | null;
  startDate: string | null;
  durationDays: number;
  percentComplete: number;
  predecessors: Predecessor[];
}

export const mockUsers: JiraUser[] = [
  { accountId: "mock-user-1", displayName: "Nguyễn Văn A", avatarUrl: null },
  { accountId: "mock-user-2", displayName: "Trần Thị B", avatarUrl: null },
  { accountId: "mock-user-3", displayName: "Lê Văn C", avatarUrl: null },
  { accountId: "mock-user-4", displayName: "Phạm Thị D", avatarUrl: null },
];

const [u1, u2, u3, u4] = mockUsers.map((u) => u.accountId);

export const mockIssues: MockIssue[] = [
  {
    key: "HHBJ-5",
    summary: "[Area 5] Reports, Dashboards & Other Features",
    issueType: "Epic",
    parentKey: null,
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeAccountId: null,
    dueDate: "2026-10-15",
    startDate: "2026-09-01",
    durationDays: 30,
    percentComplete: 20,
    predecessors: [],
  },
  {
    key: "HHBJ-49",
    summary: "CC-02 · Knowledge: Data Category + 3 bài viết nền + cấu hình panel",
    issueType: "Story",
    parentKey: "HHBJ-5",
    statusName: "To Do",
    statusCategory: "new",
    assigneeAccountId: u1,
    dueDate: "2026-09-12",
    startDate: "2026-09-01",
    durationDays: 8,
    percentComplete: 0,
    predecessors: [],
  },
  {
    key: "HHBJ-50",
    summary: "CC-03 · Cây sản phẩm HKD",
    issueType: "Story",
    parentKey: "HHBJ-5",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeAccountId: u2,
    dueDate: "2026-09-22",
    startDate: "2026-09-13",
    durationDays: 7,
    percentComplete: 40,
    predecessors: [{ taskId: "HHBJ-49", type: "FS", lagDays: 0 }],
  },
  {
    key: "HHBJ-501",
    summary: "Thiết kế schema Product Tree",
    issueType: "Sub-task",
    parentKey: "HHBJ-50",
    statusName: "Done",
    statusCategory: "done",
    assigneeAccountId: u2,
    dueDate: "2026-09-16",
    startDate: "2026-09-13",
    durationDays: 3,
    percentComplete: 100,
    predecessors: [],
  },
  {
    key: "HHBJ-502",
    summary: "Cấu hình panel hiển thị Product Tree",
    issueType: "Sub-task",
    parentKey: "HHBJ-50",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeAccountId: u3,
    dueDate: "2026-09-22",
    startDate: "2026-09-17",
    durationDays: 4,
    percentComplete: 30,
    predecessors: [{ taskId: "HHBJ-501", type: "FS", lagDays: 0 }],
  },
  {
    key: "HHBJ-6",
    summary: "[Cross-cutting] Security, Sharing, Data Migration & Performance",
    issueType: "Epic",
    parentKey: null,
    statusName: "Backlog",
    statusCategory: "new",
    assigneeAccountId: null,
    dueDate: "2026-11-05",
    startDate: "2026-09-23",
    durationDays: 40,
    percentComplete: 0,
    predecessors: [],
  },
  {
    key: "HHBJ-48",
    summary: "CC-01 · Mô hình sharing: technical owner, public group, criteria-based rule",
    issueType: "Story",
    parentKey: "HHBJ-6",
    statusName: "Backlog",
    statusCategory: "new",
    assigneeAccountId: u4,
    dueDate: "2026-09-30",
    startDate: "2026-09-23",
    durationDays: 6,
    percentComplete: 0,
    predecessors: [{ taskId: "HHBJ-50", type: "FS", lagDays: 0 }],
  },
  {
    key: "HHBJ-51",
    summary: "CC-04 · Script migration & diễn tập (3 vòng) + bộ đối chiếu",
    issueType: "Story",
    parentKey: "HHBJ-6",
    statusName: "Backlog",
    statusCategory: "new",
    assigneeAccountId: u1,
    dueDate: "2026-10-14",
    startDate: "2026-10-01",
    durationDays: 10,
    percentComplete: 0,
    predecessors: [{ taskId: "HHBJ-48", type: "FS", lagDays: 1 }],
  },
  {
    key: "HHBJ-52",
    summary: "CC-05 · Kiểm thử hiệu năng C360 & sharing trên Full Sandbox",
    issueType: "Story",
    parentKey: "HHBJ-6",
    statusName: "Backlog",
    statusCategory: "new",
    assigneeAccountId: u3,
    dueDate: "2026-10-28",
    startDate: "2026-10-15",
    durationDays: 10,
    percentComplete: 0,
    predecessors: [{ taskId: "HHBJ-51", type: "FS", lagDays: 0 }],
  },
  {
    key: "HHBJ-60",
    summary: "Bug: Sai lệch dữ liệu số dư sau đồng bộ",
    issueType: "Bug",
    parentKey: null,
    statusName: "To Do",
    statusCategory: "new",
    assigneeAccountId: u2,
    dueDate: "2026-09-18",
    startDate: "2026-09-14",
    durationDays: 3,
    percentComplete: 0,
    predecessors: [],
  },
];
