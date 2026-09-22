import { adfToText, textToAdf } from "./adf.js";
import { JiraApiError, type JiraClient } from "./jiraClient.js";
import * as store from "./store.js";
import type {
  BulkTaskCreateInput,
  BulkTaskCreateResult,
  IssueTypeName,
  JiraUser,
  Predecessor,
  ProjectSummary,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
} from "./types.js";

const SEARCH_FIELDS = ["summary", "description", "issuetype", "status", "assignee", "duedate", "parent"];

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
  /**
   * Every OTHER task the dependency cascade actually moved, fully hydrated — so
   * the client can apply the whole effect of this one edit from this single
   * response instead of following up with a separate GET /tasks. That follow-up
   * GET used to be the only way to see a cascade's effect on successors, which
   * meant every drag showed the optimistic value first and then visibly snapped
   * to the server-confirmed one a moment later once the GET resolved.
   */
  cascaded: Task[];
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
    // The whole project's overlays in one read, and one write for whatever
    // reconciliation changed. Against the old JSON file a read and a write per
    // task were free; against Postgres they are a round trip each, so a 100-task
    // project would otherwise spend 200 of them inside a single page load.
    const [issues, overlays] = await Promise.all([
      this.jira.searchIssues(jql, fields),
      store.getProjectOverlays(this.ctx.cloudId, this.ctx.projectKey),
    ]);

    const tasks: Task[] = [];
    const toPersist: Array<{ issueKey: string; overlay: store.TaskOverlay }> = [];
    // Issue keys whose reconcile() just invented a schedule out of thin air (no
    // due date, no Start date field, anywhere) — pushed to Jira too, same as a
    // manual schedule edit always is, so the issue doesn't show "no due date" in
    // Jira while this app shows one.
    const toWriteJira: Array<{ issueKey: string; due: string; start: string }> = [];
    for (const issue of issues) {
      const base = this.fromJiraIssue(issue);
      const stored = overlays.get(issue.key) ?? store.defaultOverlay();
      const { overlay, changed, synthesizedDue } = this.reconcile(base, this.jiraStartDateOf(issue), stored);
      if (changed) toPersist.push({ issueKey: issue.key, overlay });
      if (synthesizedDue) toWriteJira.push({ issueKey: issue.key, due: synthesizedDue, start: overlay.startDate! });
      tasks.push({ ...base, ...overlay, id: issue.key, dueDate: synthesizedDue ?? base.dueDate } as Task);
    }
    await store.setOverlays(this.ctx.cloudId, toPersist);
    if (toWriteJira.length > 0) {
      // Best-effort and parallel, like the cascade's successor pushes: these are
      // independent issues, and one write failing (a permission quirk on a
      // single issue, say) must not stop the rest of a bulk first sync, nor make
      // listTasks() itself fail — the overlay default already applied either way,
      // so the app stays consistent even if Jira's copy lags for that one issue.
      await Promise.allSettled(
        toWriteJira.map(({ issueKey, due, start }) =>
          this.jira.updateIssueFields(issueKey, this.scheduleFields(due, start))
        )
      );
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
      description: f.description ? adfToText(f.description) : null,
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
   * Decides what a task's overlay should become once Jira's own fields are taken
   * into account — seeding sensible defaults on first sight, and letting Jira's
   * native "Start date" field (jiraStartDate) win over the stored value once it
   * has one, the same way duedate already does.
   *
   * Pure, and separate from the write, so the caller decides whether that is one
   * statement or a batched one. Both branches exist because of real bugs (BUG-02,
   * BUG-03 in the test report) — don't simplify them away.
   */
  private reconcile(
    base: any,
    jiraStartDate: string | null,
    overlay: store.TaskOverlay
  ): { overlay: store.TaskOverlay; changed: boolean; synthesizedDue: string | null } {
    const hasOverlay =
      overlay.startDate !== null ||
      overlay.percentComplete !== 0 ||
      overlay.durationDays !== 1 ||
      overlay.predecessors.length > 0;

    if (!hasOverlay) {
      const derivedPercent =
        base.statusCategory === "done" ? 100 : base.statusCategory === "indeterminate" ? 50 : 0;
      const dueDate: string | null = base.dueDate;
      let durationDays = 3;
      let startDate: string | null;
      // Neither Jira's own duedate nor (if this site has one) its Start date
      // field has ever been set: a pure backlog item, never scheduled by anyone
      // in or out of this app. Give it the same 3-days-from-today default a
      // freshly created task gets (see createTask) instead of leaving it with no
      // startDate — which drops it from the Gantt and the WBS table entirely
      // (ganttMapping.ts), silently, with nothing on screen to explain why a
      // task that clearly exists never shows up after a sync.
      let synthesizedDue: string | null = null;
      if (jiraStartDate) {
        startDate = jiraStartDate;
        if (dueDate) durationDays = Math.max(1, diffDaysInclusive(jiraStartDate, dueDate));
      } else if (dueDate) {
        startDate = addDays(dueDate, -(durationDays - 1));
      } else {
        startDate = todayIso();
        synthesizedDue = addDays(startDate, durationDays - 1);
      }
      return {
        overlay: { ...overlay, startDate, durationDays, percentComplete: derivedPercent },
        changed: true,
        synthesizedDue,
      };
    }

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
    if (Object.keys(patch).length === 0) return { overlay, changed: false, synthesizedDue: null };
    return { overlay: { ...overlay, ...patch }, changed: true, synthesizedDue: null };
  }

  /** Single-task read-back path: reconcile one task and persist if it moved. */
  private async hydrate(id: string, base: any, jiraStartDate: string | null): Promise<Task> {
    const stored = await store.getOverlay(this.ctx.cloudId, id);
    const { overlay, changed, synthesizedDue } = this.reconcile(base, jiraStartDate, stored);
    if (changed) await store.setOverlays(this.ctx.cloudId, [{ issueKey: id, overlay }]);
    if (synthesizedDue) {
      await this.jira.updateIssueFields(id, this.scheduleFields(synthesizedDue, overlay.startDate));
    }
    return { ...base, ...overlay, id, dueDate: synthesizedDue ?? base.dueDate };
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
    if (input.description !== undefined) fields.description = textToAdf(input.description ?? "");
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
    let cascaded: Task[] = [];
    if (scheduleTouched || input.predecessors !== undefined) {
      // cascadeSnapshot() (inside applyDependencyCascade) is a project-wide Jira
      // search — expensive, and pure overhead for the common case of a task with
      // no dependency edges at all, which can't possibly move anything else or be
      // constrained itself. Skip it entirely then: this was previously
      // unconditional, so every single drag paid for a full-project search (on
      // top of the write + read-back below) regardless of whether the task had
      // any predecessors or successors — the main reason a plain drag could take
      // several seconds to save.
      const ownPredecessors = input.predecessors ?? current.predecessors;
      if (ownPredecessors.length > 0 || (await this.hasSuccessors(id))) {
        // newStart/newDuration are what this request just wrote (or, if the
        // schedule wasn't touched, the unchanged current value) — passed straight
        // in rather than left for the cascade to re-derive from its own listTasks()
        // snapshot, which is a search read that can still be racing the write above.
        const result = await this.applyDependencyCascade(id, newStart, newDuration);
        cascadeWarnings = result.warnings;
        cascaded = result.changed.filter((t) => t.id !== id);
      }
    }

    // Read the primary task back by key, NOT via listTasks()'s JQL search: Jira
    // Cloud's search index can lag a few seconds behind a write this same request
    // just made (the exact reason createTask() already fetches by key — see its
    // comment). Re-deriving straight from a stale search hit used to let hydrate()'s
    // "Jira wins" reconciliation see an old duedate/start pair and recompute a wrong
    // duration from it — a drag could "stick" at a different length than dropped.
    // Cascaded tasks need no extra read at all: applyDependencyCascade already
    // mutated them in memory with exactly what it wrote to Jira moments earlier.
    const issue = await this.jira.getIssue(id);
    const updated = await this.hydrate(id, this.fromJiraIssue(issue), this.jiraStartDateOf(issue));
    return { task: updated, cascadeWarnings, cascaded };
  }

  /** Cheap, Jira-free check: does any other task in this scope list `id` as a predecessor? */
  private async hasSuccessors(id: string): Promise<boolean> {
    return store.hasSuccessors(this.ctx.cloudId, id);
  }

  /**
   * Project-wide snapshot used only by the dependency cascade. Deliberately built
   * from Jira's base fields (summary/status/...) plus each task's overlay AS
   * STORED, skipping hydrate()'s "Jira wins" reconciliation — the cascade only
   * ever needs startDate/durationDays/predecessors, and every one of those is
   * overlay-owned. Reconciling against Jira here used to be actively harmful:
   * hydrate() trusted this same JQL search, whose index can still be catching up
   * with a write this very request just made a moment earlier (worse for a custom
   * Start-Date field, which Jira Cloud can reindex slower than `duedate`), so a
   * stale read could overwrite an unrelated successor's overlay with a duration
   * stretched to match a due date that had already moved. The primary task gets a
   * corrective re-read by key at the end of updateTask(); every other task the
   * cascade touches does not, so any corruption picked up here stuck permanently.
   */
  private async cascadeSnapshot(): Promise<Task[]> {
    const jql = `project = ${this.ctx.projectKey} ORDER BY created ASC`;
    const [issues, overlays] = await Promise.all([
      this.jira.searchIssues(jql, SEARCH_FIELDS),
      store.getProjectOverlays(this.ctx.cloudId, this.ctx.projectKey),
    ]);
    return issues.map(
      (issue) =>
        ({
          ...this.fromJiraIssue(issue),
          ...(overlays.get(issue.key) ?? store.defaultOverlay()),
          id: issue.key,
        }) as Task
    );
  }

  /**
   * After a task's schedule (or its dependency list) changes, push any FS/SS/FF/SF
   * successors forward so they never start earlier than their predecessor allows.
   * Simple forward-only propagation (not a full CPM/backward pass) — enough to keep
   * a Gantt chart consistent without needing MS Project's full scheduling engine.
   *
   * Returns the ids whose Jira write failed (`warnings`) and every task whose
   * schedule was actually moved (`changed`), including `changedId` itself if its
   * own self-check adjusted it. `changed` tasks are returned straight from the
   * in-memory copies this loop already mutated — exactly what was just pushed to
   * Jira — rather than read back, so there's no stale-search-index window for
   * them to be re-derived from (see updateTask's own comment on the same issue
   * for the primary task). A 401 is re-thrown instead of collected as a warning:
   * a revoked token used to be swallowed here, leaving the overlay and Jira
   * permanently and silently divergent.
   */
  private async applyDependencyCascade(
    changedId: string,
    knownStart: string | null,
    knownDuration: number
  ): Promise<{ warnings: string[]; changed: Task[] }> {
    const tasks = await this.cascadeSnapshot();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // cascadeSnapshot() reads the overlay directly, but `changedId`'s own overlay
    // patch was only just written by updateTask() a moment ago — seed it with the
    // values already known to be correct rather than re-read it, so there's no
    // window where a slow write could leave this seeing the pre-drag value.
    const primary = byId.get(changedId);
    if (primary && knownStart) {
      byId.set(changedId, {
        ...primary,
        startDate: knownStart,
        durationDays: knownDuration,
        dueDate: addDays(knownStart, knownDuration - 1),
      });
    }
    const successorsOf = new Map<string, Array<{ taskId: string; pred: { type: string; lagDays: number } }>>();
    for (const t of tasks) {
      for (const p of t.predecessors) {
        if (!successorsOf.has(p.taskId)) successorsOf.set(p.taskId, []);
        successorsOf.get(p.taskId)!.push({ taskId: t.id, pred: p });
      }
    }

    const warnings: string[] = [];
    const changed = new Map<string, Task>();
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
        cur.dueDate = addDays(curStart, cur.durationDays - 1);
        await store.setOverlay(this.ctx.cloudId, cur.id, { startDate: curStart });
        await pushDates(cur.id, curStart, cur.dueDate);
        byId.set(cur.id, cur);
        changed.set(cur.id, cur);
      }
      const curEnd = addDays(curStart, cur.durationDays - 1);

      // Every successor here is a different Jira issue, so their writes have no
      // ordering dependency on one another — collected and pushed with Promise.all
      // below instead of one `await` per successor, which used to chain N
      // sequential network round trips onto a single drag (the successors' bars
      // would then only update once that whole chain finally resolved).
      const toPush: Array<{ id: string; start: string; due: string }> = [];
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
          succ.dueDate = addDays(earliestStart, succ.durationDays - 1);
          byId.set(succ.id, succ);
          changed.set(succ.id, succ);
          queue.push(succ.id);
          toPush.push({ id: succ.id, start: earliestStart, due: succ.dueDate });
        }
      }
      await Promise.all(
        toPush.map(({ id, start, due }) =>
          store.setOverlay(this.ctx.cloudId, id, { startDate: start }).then(() => pushDates(id, start, due))
        )
      );
    }
    return { warnings, changed: [...changed.values()] };
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
      description: input.description ?? null,
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

  /** The issue types this project actually accepts — used to validate an AI plan. */
  async listIssueTypes(): Promise<Array<{ name: string; subtask: boolean }>> {
    const types = await this.jira.getProjectIssueTypes(this.ctx.projectKey);
    return types.map((t) => ({ name: t.name, subtask: t.subtask }));
  }

  /**
   * Creates one issue from an approved AI plan.
   *
   * Separate from createTask because `issueType` here is whatever this project
   * actually calls its types, read from Jira — not the hard-coded
   * `IssueTypeName` union that the manual create form is still stuck with. It
   * also takes explicit dates rather than deriving them: the plan's schedule was
   * already computed across the whole dependency graph, and recomputing one task
   * at a time here would contradict it.
   */
  async createFromPlan(input: {
    summary: string;
    description: string | null;
    issueType: string;
    parentKey: string | null;
    startDate: string;
    durationDays: number;
    assigneeAccountId: string | null;
  }): Promise<Task> {
    const dueDate = addDays(input.startDate, input.durationDays - 1);
    const created = await this.jira.createIssue({
      projectKey: this.ctx.projectKey,
      issueTypeName: input.issueType,
      summary: input.summary,
      description: input.description,
      parentKey: input.parentKey,
      dueDate,
      startDate: input.startDate,
      startDateFieldId: this.ctx.startDateFieldId,
      assigneeAccountId: input.assigneeAccountId,
    });

    await store.setOverlay(this.ctx.cloudId, created.key, {
      startDate: input.startDate,
      durationDays: input.durationDays,
      percentComplete: 0,
      predecessors: [],
      // The plan's own dates are the baseline: that is what was approved, so
      // later drift shows up against it rather than against the first drag.
      baselineStart: input.startDate,
      baselineDue: dueDate,
    });

    const issue = await this.jira.getIssue(created.key);
    return this.hydrate(created.key, this.fromJiraIssue(issue), this.jiraStartDateOf(issue));
  }

  /** Writes an approved plan's dependency edges once every issue key exists. */
  async setPredecessors(issueKey: string, predecessors: Predecessor[]): Promise<void> {
    await store.setOverlay(this.ctx.cloudId, issueKey, { predecessors });
  }

  /**
   * One shared set of fields applied to N summaries, created sequentially (not via
   * Jira's native /issue/bulk) so each row can still resolve `wbsParentId` and get
   * its own overlay the same way a single createTask does. Rows are independent: one
   * Jira write failure (permission, 400 on a project without this issue type, ...)
   * is collected as a per-row error instead of aborting the whole batch.
   */
  async createTasksBulk(input: BulkTaskCreateInput): Promise<BulkTaskCreateResult> {
    const created: Task[] = [];
    const errors: Array<{ summary: string; message: string }> = [];
    for (const summary of input.summaries) {
      try {
        created.push(
          await this.createTask({
            summary,
            issueType: input.issueType,
            description: input.description ?? null,
            wbsParentId: input.wbsParentId ?? null,
            startDate: input.startDate ?? null,
            durationDays: input.durationDays,
            assigneeAccountId: input.assigneeAccountId ?? null,
          })
        );
      } catch (err) {
        if (err instanceof JiraApiError && err.status === 401) throw err;
        const message = err instanceof JiraApiError ? err.summary || err.message : (err as Error).message;
        errors.push({ summary, message });
      }
    }
    return { created, errors };
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

/** UTC "today", matching addDays'/diffDaysInclusive's own convention. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function diffDaysInclusive(startIso: string, endIso: string): number {
  const start = new Date(startIso + "T00:00:00Z").getTime();
  const end = new Date(endIso + "T00:00:00Z").getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}
