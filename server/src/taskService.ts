import { JiraClient, loadJiraConfig, type JiraConfig } from "./jiraClient.js";
import { mockIssues, mockUsers, type MockIssue } from "./mockData.js";
import * as store from "./store.js";
import type {
  IssueTypeName,
  JiraUser,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
} from "./types.js";

const SEARCH_FIELDS = ["summary", "issuetype", "status", "assignee", "duedate", "parent"];

function statusCategoryKey(key: string): "new" | "indeterminate" | "done" {
  if (key === "done") return "done";
  if (key === "indeterminate") return "indeterminate";
  return "new";
}

export interface ProjectMeta {
  mode: "live" | "mock";
  projectKey: string;
  siteUrl: string | null;
}

export class TaskService {
  private jira: JiraClient | null;
  private cfg: JiraConfig | null;
  private mockStore: MockIssue[]; // in-memory mutable copy used only in mock mode
  private mockSeq = 1000;

  constructor() {
    this.cfg = loadJiraConfig();
    this.jira = this.cfg ? new JiraClient(this.cfg) : null;
    this.mockStore = mockIssues.map((i) => ({ ...i, predecessors: [...i.predecessors] }));
  }

  meta(): ProjectMeta {
    return {
      mode: this.jira ? "live" : "mock",
      projectKey: this.cfg?.projectKey ?? "HHBJ",
      siteUrl: this.cfg?.baseUrl ?? null,
    };
  }

  async listUsers(): Promise<JiraUser[]> {
    if (!this.jira || !this.cfg) return mockUsers;
    const users = await this.jira.getAssignableUsers(this.cfg.projectKey);
    return users.map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      avatarUrl: u.avatarUrls?.["24x24"] ?? null,
    }));
  }

  async listTasks(): Promise<Task[]> {
    if (!this.jira || !this.cfg) return this.listMockTasks();
    const jql = `project = ${this.cfg.projectKey} ORDER BY created ASC`;
    const issues = await this.jira.searchIssues(jql, [...SEARCH_FIELDS, this.cfg.startDateFieldId]);
    const tasks: Task[] = [];
    for (const issue of issues) {
      tasks.push(await this.hydrate(issue.key, this.fromJiraIssue(issue), this.jiraStartDateOf(issue)));
    }
    return tasks;
  }

  private jiraStartDateOf(issue: any): string | null {
    return this.cfg ? issue.fields?.[this.cfg.startDateFieldId] ?? null : null;
  }

  private fromJiraIssue(issue: any): Record<string, unknown> {
    const f = issue.fields;
    return {
      id: issue.key,
      wbsParentId: f.parent?.key ?? null,
      summary: f.summary,
      issueType: f.issuetype?.name as IssueTypeName,
      statusName: f.status?.name ?? "Unknown",
      statusCategory: statusCategoryKey(f.status?.statusCategory?.key ?? "new"),
      assigneeAccountId: f.assignee?.accountId ?? null,
      assigneeName: f.assignee?.displayName ?? null,
      assigneeAvatarUrl: f.assignee?.avatarUrls?.["24x24"] ?? null,
      dueDate: f.duedate ?? null,
      jiraUrl: `${this.cfg!.baseUrl}/browse/${issue.key}`,
    };
  }

  /**
   * Merge Jira-sourced fields with the local schedule overlay, seeding sensible
   * overlay defaults on first sight. When this Jira project has a native "Start
   * date" field configured (jiraStartDate), that field is the source of truth for
   * startDate — same as duedate already is — so it always wins over the local
   * overlay value once set.
   */
  private async hydrate(id: string, base: any, jiraStartDate: string | null): Promise<Task> {
    let overlay = await store.getOverlay(id);
    const hasOverlay = overlay.startDate !== null || overlay.percentComplete !== 0 || overlay.durationDays !== 1 || overlay.predecessors.length > 0;
    if (!hasOverlay) {
      const derivedPercent =
        base.statusCategory === "done" ? 100 : base.statusCategory === "indeterminate" ? 50 : 0;
      const dueDate: string | null = base.dueDate;
      let durationDays = 3;
      let startDate: string | null;
      if (jiraStartDate) {
        startDate = jiraStartDate;
        if (dueDate) durationDays = Math.max(1, diffDaysInclusive(jiraStartDate, dueDate));
      } else {
        startDate = dueDate ? addDays(dueDate, -(durationDays - 1)) : null;
      }
      overlay = await store.setOverlay(id, {
        startDate,
        durationDays,
        percentComplete: derivedPercent,
      });
    } else {
      const patch: Partial<store.TaskOverlay> = {};
      if (jiraStartDate && jiraStartDate !== overlay.startDate) {
        // Jira's Start date field is the source of truth once it has a value.
        patch.startDate = jiraStartDate;
        if (base.dueDate) patch.durationDays = Math.max(1, diffDaysInclusive(jiraStartDate, base.dueDate));
      } else if (!jiraStartDate && overlay.startDate && base.dueDate) {
        // No Jira Start date field (or this project doesn't have one): fall back to
        // reconciling against duedate, in case someone edited it directly in Jira
        // and it drifted from what the local schedule overlay implies.
        const impliedDue = addDays(overlay.startDate, overlay.durationDays - 1);
        if (impliedDue !== base.dueDate) {
          patch.startDate = addDays(base.dueDate, -(overlay.durationDays - 1));
        }
      }
      if (Object.keys(patch).length > 0) {
        overlay = await store.setOverlay(id, patch);
      }
    }
    return { ...base, ...overlay, id };
  }

  private async listMockTasks(): Promise<Task[]> {
    const tasks: Task[] = [];
    for (const issue of this.mockStore) {
      const base = {
        id: issue.key,
        wbsParentId: issue.parentKey,
        summary: issue.summary,
        issueType: issue.issueType,
        statusName: issue.statusName,
        statusCategory: issue.statusCategory,
        assigneeAccountId: issue.assigneeAccountId,
        assigneeName: mockUsers.find((u) => u.accountId === issue.assigneeAccountId)?.displayName ?? null,
        assigneeAvatarUrl: null,
        dueDate: issue.dueDate,
        jiraUrl: `https://gimasys.atlassian.net/browse/${issue.key}`,
        isMock: true,
      };
      let overlay = await store.getOverlay(issue.key);
      const hasOverlay = overlay.startDate !== null || overlay.predecessors.length > 0 || overlay.percentComplete !== 0 || overlay.durationDays !== 1;
      if (!hasOverlay) {
        overlay = await store.setOverlay(issue.key, {
          startDate: issue.startDate,
          durationDays: issue.durationDays,
          percentComplete: issue.percentComplete,
          predecessors: issue.predecessors,
        });
      }
      tasks.push({ ...base, ...overlay, id: issue.key } as Task);
    }
    return tasks;
  }

  async updateTask(id: string, input: TaskUpdateInput): Promise<Task> {
    const current = await store.getOverlay(id);

    // Schedule (start/duration/due) is edited on the local overlay and the resulting
    // due date is always pushed back to Jira's native `duedate` field.
    let newStart = input.startDate !== undefined ? input.startDate : current.startDate;
    let newDuration = input.durationDays !== undefined ? input.durationDays : current.durationDays;
    const scheduleTouched =
      input.startDate !== undefined || input.durationDays !== undefined || input.dueDate !== undefined;

    if (
      input.dueDate &&
      input.startDate === undefined &&
      input.durationDays === undefined &&
      newStart
    ) {
      // Editing the due date directly keeps the start date fixed and resizes duration.
      newDuration = Math.max(1, diffDaysInclusive(newStart, input.dueDate));
    }
    const newDue = newStart ? addDays(newStart, newDuration - 1) : input.dueDate ?? current.baselineDue ?? null;

    if (this.jira && this.cfg) {
      const fields: Record<string, unknown> = {};
      if (input.summary !== undefined) fields.summary = input.summary;
      if (scheduleTouched) {
        fields.duedate = newDue;
        fields[this.cfg.startDateFieldId] = newStart;
      }
      if (Object.keys(fields).length > 0) {
        await this.jira.updateIssueFields(id, fields);
      }
      if (input.assigneeAccountId !== undefined) {
        await this.jira.assignIssue(id, input.assigneeAccountId);
      }
      if (input.statusTransition) {
        await this.jira.transitionIssue(id, input.statusTransition);
      }
    } else {
      const issue = this.mockStore.find((i) => i.key === id);
      if (!issue) throw new Error(`Task ${id} not found`);
      if (input.summary !== undefined) issue.summary = input.summary;
      if (scheduleTouched) issue.dueDate = newDue;
      if (input.assigneeAccountId !== undefined) issue.assigneeAccountId = input.assigneeAccountId;
      if (input.statusTransition) {
        issue.statusName = input.statusTransition;
        issue.statusCategory =
          input.statusTransition.toLowerCase() === "done"
            ? "done"
            : input.statusTransition.toLowerCase() === "to do" || input.statusTransition.toLowerCase() === "backlog"
            ? "new"
            : "indeterminate";
      }
    }

    const overlayPatch: Record<string, unknown> = {};
    if (input.startDate !== undefined) overlayPatch.startDate = input.startDate;
    if (scheduleTouched) overlayPatch.durationDays = newDuration;
    if (input.percentComplete !== undefined) overlayPatch.percentComplete = input.percentComplete;
    if (input.predecessors !== undefined) overlayPatch.predecessors = input.predecessors;
    if (input.baselineStart !== undefined) overlayPatch.baselineStart = input.baselineStart;
    if (input.baselineDue !== undefined) overlayPatch.baselineDue = input.baselineDue;
    if (Object.keys(overlayPatch).length > 0) {
      await store.setOverlay(id, overlayPatch);
    }

    if (scheduleTouched || input.predecessors !== undefined) {
      await this.applyDependencyCascade(id);
    }

    const all = await this.listTasks();
    const updated = all.find((t) => t.id === id);
    if (!updated) throw new Error(`Task ${id} not found after update`);
    return updated;
  }

  /**
   * After a task's schedule (or its dependency list) changes, push any FS/SS/FF/SF
   * successors forward so they never start earlier than their predecessor allows.
   * Simple forward-only propagation (not a full CPM/backward pass) — enough to keep
   * a Gantt chart consistent without needing MS Project's full scheduling engine.
   */
  private async applyDependencyCascade(changedId: string): Promise<void> {
    const tasks = await this.listTasks();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const successorsOf = new Map<string, Array<{ taskId: string; pred: { type: string; lagDays: number } }>>();
    for (const t of tasks) {
      for (const p of t.predecessors) {
        if (!successorsOf.has(p.taskId)) successorsOf.set(p.taskId, []);
        successorsOf.get(p.taskId)!.push({ taskId: t.id, pred: p });
      }
    }

    const visited = new Set<string>();
    const queue = [changedId];
    while (queue.length > 0) {
      const curId = queue.shift()!;
      if (visited.has(curId)) continue;
      visited.add(curId);
      const cur = byId.get(curId);
      if (!cur || !cur.startDate) continue;

      // Before pushing this task's schedule onto its successors, first make sure its
      // own start doesn't violate its own predecessors (e.g. a predecessor was just
      // added, or the predecessor list changed) — otherwise a newly added dependency
      // is silently not enforced until some unrelated edit happens to re-trigger this.
      let curStart = cur.startDate;
      for (const pred of cur.predecessors) {
        const predTask = byId.get(pred.taskId);
        if (!predTask || !predTask.startDate) continue;
        const predEnd = addDays(predTask.startDate, predTask.durationDays - 1);
        let earliest: string | null = null;
        if (pred.type === "FS") earliest = addDays(predEnd, pred.lagDays + 1);
        else if (pred.type === "SS") earliest = addDays(predTask.startDate, pred.lagDays);
        else if (pred.type === "FF") earliest = addDays(predEnd, pred.lagDays - (cur.durationDays - 1));
        else if (pred.type === "SF") earliest = addDays(predTask.startDate, pred.lagDays - (cur.durationDays - 1));
        if (earliest && earliest > curStart) curStart = earliest;
      }
      if (curStart !== cur.startDate) {
        cur.startDate = curStart;
        const curDue = addDays(curStart, cur.durationDays - 1);
        await store.setOverlay(cur.id, { startDate: curStart });
        if (this.jira && this.cfg) {
          await this.jira
            .updateIssueFields(cur.id, { duedate: curDue, [this.cfg.startDateFieldId]: curStart })
            .catch(() => {});
        } else {
          const mockIssue = this.mockStore.find((i) => i.key === cur.id);
          if (mockIssue) mockIssue.dueDate = curDue;
        }
        byId.set(cur.id, cur);
      }
      const curEnd = addDays(curStart, cur.durationDays - 1);

      for (const { taskId, pred } of successorsOf.get(curId) ?? []) {
        const succ = byId.get(taskId);
        if (!succ || !succ.startDate) continue;
        let earliestStart: string | null = null;
        if (pred.type === "FS") earliestStart = addDays(curEnd, pred.lagDays + 1);
        else if (pred.type === "SS") earliestStart = addDays(curStart, pred.lagDays);
        else if (pred.type === "FF") earliestStart = addDays(curEnd, pred.lagDays - (succ.durationDays - 1));
        else if (pred.type === "SF") earliestStart = addDays(curStart, pred.lagDays - (succ.durationDays - 1));

        if (earliestStart && earliestStart > succ.startDate) {
          succ.startDate = earliestStart;
          const succDue = addDays(earliestStart, succ.durationDays - 1);
          await store.setOverlay(succ.id, { startDate: earliestStart });
          if (this.jira && this.cfg) {
            await this.jira
              .updateIssueFields(succ.id, { duedate: succDue, [this.cfg.startDateFieldId]: earliestStart })
              .catch(() => {});
          } else {
            const mockIssue = this.mockStore.find((i) => i.key === succ.id);
            if (mockIssue) mockIssue.dueDate = succDue;
          }
          byId.set(succ.id, succ);
          queue.push(succ.id);
        }
      }
    }
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const durationDays = input.durationDays ?? 3;
    const startDate = input.startDate ?? null;
    const dueDate =
      input.dueDate ?? (startDate ? addDays(startDate, durationDays - 1) : null);

    let key: string;
    if (this.jira && this.cfg) {
      const created = await this.jira.createIssue({
        projectKey: this.cfg.projectKey,
        issueTypeName: input.issueType,
        summary: input.summary,
        parentKey: input.wbsParentId ?? null,
        dueDate,
        startDate,
        startDateFieldId: this.cfg.startDateFieldId,
        assigneeAccountId: input.assigneeAccountId ?? null,
      });
      key = created.key;
    } else {
      key = `HHBJ-${this.mockSeq++}`;
      this.mockStore.push({
        key,
        summary: input.summary,
        issueType: input.issueType,
        parentKey: input.wbsParentId ?? null,
        statusName: "To Do",
        statusCategory: "new",
        assigneeAccountId: input.assigneeAccountId ?? null,
        dueDate,
        startDate,
        durationDays,
        percentComplete: 0,
        predecessors: [],
      });
    }

    await store.setOverlay(key, {
      startDate,
      durationDays,
      percentComplete: 0,
      predecessors: [],
      baselineStart: startDate,
      baselineDue: dueDate,
    });

    // Fetch the created issue directly by key rather than re-running listTasks()'s
    // JQL search: Jira Cloud's search index lags a few seconds behind issue creation,
    // so a freshly created issue can be briefly invisible to search while already
    // fetchable by key.
    if (this.jira && this.cfg) {
      const issue = await this.jira.getIssue(key);
      return this.hydrate(key, this.fromJiraIssue(issue), this.jiraStartDateOf(issue));
    }
    const all = await this.listMockTasks();
    const created = all.find((t) => t.id === key);
    if (!created) throw new Error(`Task ${key} not found after create`);
    return created;
  }

  async deleteTask(id: string): Promise<void> {
    if (this.jira) {
      await this.jira.deleteIssue(id);
    } else {
      this.mockStore = this.mockStore.filter((i) => i.key !== id && i.parentKey !== id);
    }
    await store.deleteOverlay(id);
  }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDaysInclusive(startIso: string, endIso: string): number {
  const start = new Date(startIso + "T00:00:00Z").getTime();
  const end = new Date(endIso + "T00:00:00Z").getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

export const taskService = new TaskService();
