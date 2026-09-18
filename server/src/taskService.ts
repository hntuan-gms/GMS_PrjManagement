import { JiraApiError, type JiraClient } from "./jiraClient.js";
import * as store from "./store.js";
import type {
  IssueTypeName,
  JiraUser,
  ProjectSummary,
  SessionMeta,
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

/**
 * Everything a request needs to act as one user on one project. Supplied by the
 * auth middleware; there is no process-wide Jira identity any more.
 */
export interface TaskContext {
  cloudId: string;
  /** Human site URL — browse links only, never the api.atlassian.com gateway. */
  siteUrl: string;
  projectKey: string;
  /** Discovered per site; null means this site has no native Start date field. */
  startDateFieldId: string | null;
}

export interface UpdateResult {
  task: Task;
  /** Issue keys whose Jira write failed during the cascade, if any. */
  cascadeWarnings: string[];
}

/**
 * One instance per request. The constructor does no work beyond holding two
 * references, so this is free — and it means the access token can never go stale
 * inside a cached object, and one user's state can never leak into another's.
 */
export class TaskService {
  constructor(
    private readonly jira: JiraClient,
    private readonly ctx: TaskContext
  ) {}

  meta(overlayEphemeral: boolean, user: SessionMeta["user"], siteName: string, projectName: string | null): SessionMeta {
    return {
      user,
      site: { cloudId: this.ctx.cloudId, url: this.ctx.siteUrl, name: siteName },
      project: projectName !== null ? { key: this.ctx.projectKey, name: projectName } : null,
      startDateFieldId: this.ctx.startDateFieldId,
      overlayEphemeral,
    };
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.jira.listProjects();
  }

  async listUsers(): Promise<JiraUser[]> {
    const users = await this.jira.getAssignableUsers(this.ctx.projectKey);
    return users.map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      avatarUrl: u.avatarUrls?.["24x24"] ?? null,
    }));
  }

  async listTasks(): Promise<Task[]> {
    const jql = `project = ${this.ctx.projectKey} ORDER BY created ASC`;
    const fields = this.ctx.startDateFieldId
      ? [...SEARCH_FIELDS, this.ctx.startDateFieldId]
      : SEARCH_FIELDS;
    const issues = await this.jira.searchIssues(jql, fields);
    const tasks: Task[] = [];
    for (const issue of issues) {
      tasks.push(await this.hydrate(issue.key, this.fromJiraIssue(issue), this.jiraStartDateOf(issue)));
    }
    return tasks;
  }

  private jiraStartDateOf(issue: any): string | null {
    if (!this.ctx.startDateFieldId) return null;
    return issue.fields?.[this.ctx.startDateFieldId] ?? null;
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
      jiraUrl: `${this.ctx.siteUrl}/browse/${issue.key}`,
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
    let overlay = await store.getOverlay(this.ctx.cloudId, id);
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
      overlay = await store.setOverlay(this.ctx.cloudId, id, {
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
        overlay = await store.setOverlay(this.ctx.cloudId, id, patch);
      }
    }
    return { ...base, ...overlay, id };
  }

  /** Fields written to Jira for a schedule change, omitting the start date when the site has none. */
  private scheduleFields(due: string | null, start: string | null): Record<string, unknown> {
    const fields: Record<string, unknown> = { duedate: due };
    if (this.ctx.startDateFieldId) fields[this.ctx.startDateFieldId] = start;
    return fields;
  }

  async updateTask(id: string, input: TaskUpdateInput): Promise<UpdateResult> {
    const current = await store.getOverlay(this.ctx.cloudId, id);

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

    const fields: Record<string, unknown> = {};
    if (input.summary !== undefined) fields.summary = input.summary;
    if (scheduleTouched) Object.assign(fields, this.scheduleFields(newDue, newStart));
    if (Object.keys(fields).length > 0) {
      await this.jira.updateIssueFields(id, fields);
    } else if (
      input.assigneeAccountId === undefined &&
      input.statusTransition === undefined
    ) {
      // Overlay-only edit (%, predecessors, baseline) touches no Jira field, so it
      // would otherwise skip every permission check. Read the issue first so a user
      // who cannot even see it gets a 403/404 instead of silently rewriting shared
      // schedule data.
      await this.jira.getIssue(id);
    }
    if (input.assigneeAccountId !== undefined) {
      await this.jira.assignIssue(id, input.assigneeAccountId);
    }
    if (input.statusTransition) {
      await this.jira.transitionIssue(id, input.statusTransition);
    }

    const overlayPatch: Record<string, unknown> = {};
    if (input.startDate !== undefined) overlayPatch.startDate = input.startDate;
    if (scheduleTouched) overlayPatch.durationDays = newDuration;
    if (input.percentComplete !== undefined) overlayPatch.percentComplete = input.percentComplete;
    if (input.predecessors !== undefined) overlayPatch.predecessors = input.predecessors;
    if (input.baselineStart !== undefined) overlayPatch.baselineStart = input.baselineStart;
    if (input.baselineDue !== undefined) overlayPatch.baselineDue = input.baselineDue;
    if (Object.keys(overlayPatch).length > 0) {
      await store.setOverlay(this.ctx.cloudId, id, overlayPatch);
    }

    let cascadeWarnings: string[] = [];
    if (scheduleTouched || input.predecessors !== undefined) {
      cascadeWarnings = await this.applyDependencyCascade(id);
    }

    const all = await this.listTasks();
    const updated = all.find((t) => t.id === id);
    if (!updated) throw new Error(`Task ${id} not found after update`);
    return { task: updated, cascadeWarnings };
  }

  /**
   * After a task's schedule (or its dependency list) changes, push any FS/SS/FF/SF
   * successors forward so they never start earlier than their predecessor allows.
   * Simple forward-only propagation (not a full CPM/backward pass) — enough to keep
   * a Gantt chart consistent without needing MS Project's full scheduling engine.
   *
   * Returns the ids whose Jira write failed. A 401 is re-thrown instead: a revoked
   * token used to be swallowed here, leaving the overlay and Jira permanently and
   * silently divergent.
   */
  private async applyDependencyCascade(changedId: string): Promise<string[]> {
    const tasks = await this.listTasks();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const successorsOf = new Map<string, Array<{ taskId: string; pred: { type: string; lagDays: number } }>>();
    for (const t of tasks) {
      for (const p of t.predecessors) {
        if (!successorsOf.has(p.taskId)) successorsOf.set(p.taskId, []);
        successorsOf.get(p.taskId)!.push({ taskId: t.id, pred: p });
      }
    }

    const warnings: string[] = [];
    const pushDates = async (taskId: string, start: string, due: string) => {
      try {
        await this.jira.updateIssueFields(taskId, this.scheduleFields(due, start));
      } catch (err) {
        if (err instanceof JiraApiError && err.status === 401) throw err;
        warnings.push(taskId);
      }
    };

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
        await store.setOverlay(this.ctx.cloudId, cur.id, { startDate: curStart });
        await pushDates(cur.id, curStart, curDue);
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
          await store.setOverlay(this.ctx.cloudId, succ.id, { startDate: earliestStart });
          await pushDates(succ.id, earliestStart, succDue);
          byId.set(succ.id, succ);
          queue.push(succ.id);
        }
      }
    }
    return warnings;
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const durationDays = input.durationDays ?? 3;
    const startDate = input.startDate ?? null;
    const dueDate =
      input.dueDate ?? (startDate ? addDays(startDate, durationDays - 1) : null);

    const created = await this.jira.createIssue({
      projectKey: this.ctx.projectKey,
      issueTypeName: input.issueType,
      summary: input.summary,
      parentKey: input.wbsParentId ?? null,
      dueDate,
      startDate,
      startDateFieldId: this.ctx.startDateFieldId,
      assigneeAccountId: input.assigneeAccountId ?? null,
    });
    const key = created.key;

    await store.setOverlay(this.ctx.cloudId, key, {
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
    const issue = await this.jira.getIssue(key);
    return this.hydrate(key, this.fromJiraIssue(issue), this.jiraStartDateOf(issue));
  }

  async deleteTask(id: string): Promise<void> {
    await this.jira.deleteIssue(id);
    await store.deleteOverlay(this.ctx.cloudId, id);
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
