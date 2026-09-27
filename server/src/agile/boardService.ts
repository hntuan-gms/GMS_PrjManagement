import { agileEnabled } from "../auth/config.js";
import { badRequest } from "../errors.js";
import { JiraApiError, type JiraClient } from "../jiraClient.js";
import * as store from "../store.js";
import type {
  BoardColumn,
  BoardFallback,
  BoardIssue,
  BoardSnapshot,
  BoardStatus,
  BoardSummary,
  Sprint,
  StatusCategory,
  VelocityPoint,
} from "./boardTypes.js";

/**
 * The Bảng tab's server half: reads a Jira Software board as it is, and writes
 * back the moves a board is for (status, rank, sprint, estimate).
 *
 * Two modes, and the choice is made per request rather than configured:
 * - **agile** — a real board through /rest/agile/1.0. Needs the granular Jira
 *   Software scopes (auth/config.ts AGILE_SCOPES), so it is attempted only when
 *   JIRA_AGILE is on, and a scope refusal from the gateway drops to…
 * - **status** — columns built from the project's own statuses over the platform
 *   API the app already has. No sprints, no rank, but a working Kanban board, and
 *   `fallback` says exactly what is missing instead of an empty tab.
 *
 * Every write is scoped to the session's project: issue keys must carry its
 * prefix and sprints must belong to one of its boards. Jira enforces its own
 * permissions on top; this stops the tab from being used to reach sideways into
 * a project the user never picked, which is the same rule predecessors follow.
 */

/** Non-done work, plus the last two weeks of done so a Done column isn't empty the day after a release. */
const BOARD_JQL = "statusCategory != Done OR resolutiondate >= -14d OR sprint in openSprints()";
const RECENT_DONE_JQL = "statusCategory = Done AND resolutiondate >= -180d";
const ISSUE_LIMIT = 800;
const VELOCITY_SPRINTS = 6;
const BOARDS_TTL_MS = 5 * 60_000;
const MOVE_CHUNK = 50;

const boardsCache = new Map<string, { at: number; boards: BoardSummary[] }>();

const FALLBACK_MESSAGES: Record<BoardFallback["reason"], string> = {
  disabled:
    "Đang dùng bảng theo trạng thái. Để có Sprint, Backlog và thứ hạng như Jira Software, quản trị viên cần bật quyền Jira Software cho ứng dụng (JIRA_AGILE).",
  scope:
    "Phiên đăng nhập hiện tại chưa có quyền Jira Software nên đang dùng bảng theo trạng thái. Đăng xuất và đăng nhập lại để cấp quyền.",
  no_board: "Dự án chưa có board Jira Software nào, nên đang dùng bảng theo trạng thái của dự án.",
};

function category(key: string | undefined): StatusCategory {
  return key === "done" ? "done" : key === "indeterminate" ? "indeterminate" : "new";
}

const isScopeRefusal = (err: unknown) => err instanceof JiraApiError && err.scopeProblem;

export class BoardService {
  constructor(
    private readonly jira: JiraClient,
    private readonly ctx: { cloudId: string; projectKey: string }
  ) {}

  /* ------------------------------------------------------------------ reads */

  async listBoards(): Promise<BoardSummary[]> {
    const cacheKey = `${this.ctx.cloudId}:${this.ctx.projectKey}`;
    const hit = boardsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < BOARDS_TTL_MS) return hit.boards;
    const raw = await this.jira.listBoards(this.ctx.projectKey);
    const boards = raw.map((b) => ({ id: b.id, name: b.name, type: b.type }));
    // Scrum first: it's the board a team with sprints actually plans on.
    boards.sort((a, b) => Number(b.type === "scrum") - Number(a.type === "scrum") || a.id - b.id);
    boardsCache.set(cacheKey, { at: Date.now(), boards });
    return boards;
  }

  async snapshot(boardId: number | null): Promise<BoardSnapshot> {
    if (!agileEnabled()) return this.statusBoard("disabled");
    let boards: BoardSummary[];
    try {
      boards = await this.listBoards();
    } catch (err) {
      if (isScopeRefusal(err)) return this.statusBoard("scope");
      throw err;
    }
    if (boards.length === 0) return this.statusBoard("no_board");
    const board = boards.find((b) => b.id === boardId) ?? boards[0];
    try {
      return await this.agileBoard(board, boards);
    } catch (err) {
      if (isScopeRefusal(err)) return this.statusBoard("scope");
      throw err;
    }
  }

  private async projectStatuses(): Promise<Map<string, BoardStatus>> {
    const byType = await this.jira.getProjectStatuses(this.ctx.projectKey);
    const out = new Map<string, BoardStatus>();
    for (const type of byType) {
      for (const s of type.statuses ?? []) {
        if (!out.has(s.id)) out.set(s.id, { id: s.id, name: s.name, category: category(s.statusCategory?.key) });
      }
    }
    return out;
  }

  private async blockedByMap(): Promise<Map<string, string[]>> {
    const overlays = await store.getProjectOverlays(this.ctx.cloudId, this.ctx.projectKey);
    const out = new Map<string, string[]>();
    for (const [key, o] of overlays) {
      if (o.predecessors.length > 0) out.set(key, o.predecessors.map((p) => p.taskId));
    }
    return out;
  }

  private async agileBoard(board: BoardSummary, boards: BoardSummary[]): Promise<BoardSnapshot> {
    const [config, statusMap, predecessors] = await Promise.all([
      this.jira.getBoardConfiguration(board.id),
      this.projectStatuses(),
      this.blockedByMap(),
    ]);

    const fieldId = config.estimation?.field?.fieldId ?? null;
    const unit: "points" | "hours" = fieldId && /^time(original)?estimate$/.test(fieldId) ? "hours" : "points";
    const estimation =
      config.estimation?.type === "field" && fieldId
        ? { fieldId, name: config.estimation.field?.displayName ?? fieldId, unit }
        : null;

    const fields = [
      "summary", "status", "issuetype", "assignee", "priority", "parent", "duedate",
      "labels", "resolutiondate", "updated", "sprint", "closedSprints", "flagged",
      ...(estimation ? [estimation.fieldId] : []),
    ];
    const hasSprints = board.type === "scrum";

    const [rawIssues, openSprints, closedSprints, recentDone] = await Promise.all([
      this.jira.getBoardIssues(board.id, BOARD_JQL, fields, ISSUE_LIMIT + 1),
      hasSprints ? this.jira.listSprints(board.id, "active,future") : Promise.resolve([]),
      hasSprints ? this.jira.listSprints(board.id, "closed") : Promise.resolve([]),
      this.jira.getBoardIssues(
        board.id,
        RECENT_DONE_JQL,
        ["resolutiondate", "closedSprints", "sprint", ...(estimation ? [estimation.fieldId] : [])],
        500
      ),
    ]);

    // Statuses the board shows that the project list didn't carry (a board can
    // span projects) still need a name for their column; the issues supply it.
    for (const raw of rawIssues) {
      const s = raw.fields?.status;
      if (s?.id && !statusMap.has(s.id)) {
        statusMap.set(s.id, { id: s.id, name: s.name, category: category(s.statusCategory?.key) });
      }
    }

    const columns: BoardColumn[] = (config.columnConfig?.columns ?? [])
      .map((c) => ({
        name: c.name,
        statusIds: (c.statuses ?? []).map((s) => String(s.id)),
        min: typeof c.min === "number" ? c.min : null,
        max: typeof c.max === "number" ? c.max : null,
      }))
      // A column with no status mapped is Jira's own "unmapped" holding pen —
      // nothing can be dropped into it, so it only costs width.
      .filter((c) => c.statusIds.length > 0);

    const issues = this.toIssues(rawIssues.slice(0, ISSUE_LIMIT), estimation, predecessors);

    const sprints: Sprint[] = openSprints.map(toSprint);
    const velocity = computeVelocity(closedSprints.map(toSprint), recentDone, estimation);

    return {
      mode: "agile",
      fallback: null,
      boards,
      board,
      columns,
      statuses: [...statusMap.values()],
      estimation,
      sprints,
      velocity,
      throughput: computeThroughput(recentDone),
      issues,
      truncated: rawIssues.length > ISSUE_LIMIT,
    };
  }

  /**
   * Columns from the project's statuses, grouped To Do → In Progress → Done in
   * the order Jira lists them. Issues come from JQL, rank-ordered when the site
   * has a Rank field (every Jira Software site) and by creation otherwise.
   */
  private async statusBoard(reason: BoardFallback["reason"]): Promise<BoardSnapshot> {
    const [statusMap, predecessors] = await Promise.all([this.projectStatuses(), this.blockedByMap()]);
    const fields = [
      "summary", "status", "issuetype", "assignee", "priority", "parent", "duedate",
      "labels", "resolutiondate", "updated",
    ];
    const base = `project = "${this.ctx.projectKey}" AND (statusCategory != Done OR resolutiondate >= -14d)`;
    let raw: any[];
    try {
      raw = await this.jira.searchIssues(`${base} ORDER BY Rank ASC`, fields);
    } catch (err) {
      if (!(err instanceof JiraApiError) || err.status !== 400) throw err;
      raw = await this.jira.searchIssues(`${base} ORDER BY created ASC`, fields);
    }

    const order: StatusCategory[] = ["new", "indeterminate", "done"];
    const statuses = [...statusMap.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
    const columns: BoardColumn[] = statuses.map((s) => ({ name: s.name, statusIds: [s.id], min: null, max: null }));

    return {
      mode: "status",
      fallback: { reason, message: FALLBACK_MESSAGES[reason] },
      boards: [],
      board: null,
      columns,
      statuses,
      estimation: null,
      sprints: [],
      velocity: [],
      throughput: computeThroughput(raw.filter((r) => r.fields?.resolutiondate)),
      issues: this.toIssues(raw.slice(0, ISSUE_LIMIT), null, predecessors),
      truncated: raw.length > ISSUE_LIMIT,
    };
  }

  private toIssues(
    raw: any[],
    estimation: BoardSnapshot["estimation"],
    predecessors: Map<string, string[]>
  ): BoardIssue[] {
    const issues: BoardIssue[] = raw.map((r) => {
      const f = r.fields ?? {};
      const parent = f.parent;
      const parentIsEpic = parent?.fields?.issuetype?.hierarchyLevel === 1 || parent?.fields?.issuetype?.name === "Epic";
      const rawEstimate = estimation ? f[estimation.fieldId] : null;
      const estimate =
        typeof rawEstimate === "number"
          ? estimation!.unit === "hours"
            ? Math.round((rawEstimate / 3600) * 10) / 10
            : rawEstimate
          : null;
      return {
        key: r.key,
        summary: f.summary ?? r.key,
        issueType: f.issuetype?.name ?? "Task",
        subtask: !!f.issuetype?.subtask,
        statusId: String(f.status?.id ?? ""),
        statusName: f.status?.name ?? "",
        statusCategory: category(f.status?.statusCategory?.key),
        assigneeAccountId: f.assignee?.accountId ?? null,
        assigneeName: f.assignee?.displayName ?? null,
        priority: f.priority?.name ?? null,
        estimate,
        sprintId: f.sprint && f.sprint.state !== "closed" ? Number(f.sprint.id) : null,
        epicKey: parent && parentIsEpic ? parent.key : null,
        epicSummary: parent && parentIsEpic ? parent.fields?.summary ?? null : null,
        parentKey: parent?.key ?? null,
        flagged: !!f.flagged,
        labels: Array.isArray(f.labels) ? f.labels : [],
        dueDate: f.duedate ?? null,
        resolutionDate: f.resolutiondate ?? null,
        updated: f.updated ?? null,
        blockedBy: [],
      };
    });

    // Blocked = a predecessor that is on this board and not done. One that isn't
    // on the board at all has either been done for a while (the JQL drops old
    // done work) or lives elsewhere; neither should paint a card as stuck.
    const byKey = new Map(issues.map((i) => [i.key, i]));
    for (const issue of issues) {
      const preds = predecessors.get(issue.key) ?? [];
      issue.blockedBy = preds.filter((p) => {
        const pred = byKey.get(p);
        return pred && pred.statusCategory !== "done";
      });
    }
    return issues;
  }

  /**
   * Finished, estimated work on this board — the reference class the estimation
   * AI compares against. Spread across values (up to 6 per estimate) so the
   * model sees what a 2 and a 13 look like on this team, not forty 3s.
   */
  async estimationReferences(
    boardId: number,
    estimation: NonNullable<BoardSnapshot["estimation"]>
  ): Promise<Array<{ key: string; summary: string; type: string; estimate: number }>> {
    const cf = estimation.fieldId.match(/^customfield_(\d+)$/);
    const notEmpty = cf ? `cf[${cf[1]}] is not EMPTY` : estimation.unit === "hours" ? "originalEstimate is not EMPTY" : null;
    if (!notEmpty) return [];
    const raw = await this.jira.getBoardIssues(
      boardId,
      `statusCategory = Done AND resolutiondate >= -365d AND ${notEmpty}`,
      ["summary", "issuetype", estimation.fieldId],
      300
    );
    const perValue = new Map<number, number>();
    const out: Array<{ key: string; summary: string; type: string; estimate: number }> = [];
    for (const r of raw) {
      const v = r.fields?.[estimation.fieldId];
      if (typeof v !== "number") continue;
      const value = estimation.unit === "hours" ? Math.round((v / 3600) * 10) / 10 : v;
      const n = perValue.get(value) ?? 0;
      if (n >= 6) continue;
      perValue.set(value, n + 1);
      out.push({ key: r.key, summary: String(r.fields?.summary ?? "").slice(0, 110), type: r.fields?.issuetype?.name ?? "", estimate: value });
      if (out.length >= 45) break;
    }
    return out;
  }

  /* -------------------------------------------------------------- guards */

  assertProjectKeys(keys: string[]): string[] {
    const pattern = new RegExp(`^${this.ctx.projectKey}-\\d+$`);
    const clean = [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))];
    const foreign = clean.filter((k) => !pattern.test(k));
    if (clean.length === 0) throw badRequest("Chưa chọn công việc nào.");
    if (foreign.length > 0) {
      throw badRequest(`Chỉ thao tác được với công việc của dự án ${this.ctx.projectKey}: ${foreign.join(", ")}`);
    }
    return clean;
  }

  async assertBoard(boardId: number): Promise<BoardSummary> {
    const board = (await this.listBoards()).find((b) => b.id === boardId);
    if (!board) throw badRequest("Board này không thuộc dự án đang mở.");
    return board;
  }

  async assertSprint(sprintId: number): Promise<Sprint & { originBoardId: number }> {
    const raw = await this.jira.getSprint(sprintId);
    await this.assertBoard(Number(raw.originBoardId));
    return { ...toSprint(raw), originBoardId: Number(raw.originBoardId) };
  }

  /* -------------------------------------------------------------- writes */

  /** What the card can move to right now — the drop targets light up from this. */
  async transitionsFor(key: string): Promise<Array<{ id: string; name: string; toStatusId: string }>> {
    this.assertProjectKeys([key]);
    const transitions = await this.jira.getTransitions(key);
    return transitions.filter((t) => t.to?.id).map((t) => ({ id: t.id, name: t.name, toStatusId: String(t.to!.id) }));
  }

  /**
   * Move a card: change its status when the target column needs one, then rank
   * it among its new neighbours. A column can map several statuses; the first
   * one the issue's workflow can actually reach wins.
   */
  async moveCard(input: {
    key: string;
    toStatusIds?: string[];
    before?: string | null;
    after?: string | null;
  }): Promise<{ statusId: string | null }> {
    const [key] = this.assertProjectKeys([input.key]);
    let statusId: string | null = null;

    if (input.toStatusIds && input.toStatusIds.length > 0) {
      const [transitions, current] = await Promise.all([this.jira.getTransitions(key), this.jira.getIssue(key)]);
      const currentStatus = String(current.fields?.status?.id ?? "");
      if (!input.toStatusIds.includes(currentStatus)) {
        const match = transitions.find((t) => t.to?.id && input.toStatusIds!.includes(String(t.to.id)));
        if (!match) {
          throw badRequest(
            `Quy trình của ${key} không cho chuyển sang cột này từ "${current.fields?.status?.name ?? "?"}". ` +
              `Có thể chuyển: ${transitions.map((t) => t.to?.name ?? t.name).join(", ") || "không có"}.`
          );
        }
        await this.jira.transitionIssueById(key, match.id);
        statusId = String(match.to!.id);
      }
    }

    const neighbour = input.before ?? input.after ?? null;
    if (neighbour && agileEnabled()) {
      this.assertProjectKeys([neighbour]);
      await this.rank([key], input.before ? { before: input.before } : { after: input.after! });
    }
    return { statusId };
  }

  async rank(keys: string[], rank: { before?: string; after?: string }): Promise<void> {
    const clean = this.assertProjectKeys(keys);
    // Chunks ranked one after another, each after the previous chunk's tail, so a
    // 60-card move lands as one contiguous block in the order given.
    let anchor = rank;
    for (let i = 0; i < clean.length; i += MOVE_CHUNK) {
      const chunk = clean.slice(i, i + MOVE_CHUNK);
      await this.jira.rankIssues(chunk, anchor);
      anchor = { after: chunk[chunk.length - 1] };
    }
  }

  async moveToSprint(sprintId: number, keys: string[], rank?: { before?: string; after?: string }): Promise<void> {
    const sprint = await this.assertSprint(sprintId);
    if (sprint.state === "closed") throw badRequest("Không thể thêm việc vào sprint đã hoàn thành.");
    const clean = this.assertProjectKeys(keys);
    for (let i = 0; i < clean.length; i += MOVE_CHUNK) {
      await this.jira.moveIssuesToSprint(sprintId, clean.slice(i, i + MOVE_CHUNK), i === 0 ? rank : undefined);
    }
  }

  async moveToBacklog(keys: string[], rank?: { before?: string; after?: string }): Promise<void> {
    const clean = this.assertProjectKeys(keys);
    for (let i = 0; i < clean.length; i += MOVE_CHUNK) {
      await this.jira.moveIssuesToBacklog(clean.slice(i, i + MOVE_CHUNK));
    }
    if (rank && (rank.before || rank.after)) await this.rank(clean, rank);
  }

  async createSprint(input: { boardId: number; name: string; goal?: string | null; startDate?: string | null; endDate?: string | null }): Promise<Sprint> {
    await this.assertBoard(input.boardId);
    const name = input.name.trim();
    if (!name) throw badRequest("Sprint cần có tên.");
    const created = await this.jira.createSprint({
      name,
      originBoardId: input.boardId,
      ...(input.goal ? { goal: input.goal } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
    });
    return toSprint(created);
  }

  async updateSprint(
    sprintId: number,
    patch: { name?: string; goal?: string | null; startDate?: string | null; endDate?: string | null }
  ): Promise<Sprint> {
    await this.assertSprint(sprintId);
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name.trim();
    if (patch.goal !== undefined) body.goal = patch.goal ?? "";
    if (patch.startDate) body.startDate = patch.startDate;
    if (patch.endDate) body.endDate = patch.endDate;
    return toSprint(await this.jira.updateSprint(sprintId, body));
  }

  async startSprint(
    sprintId: number,
    input: { startDate: string; endDate: string; name?: string; goal?: string | null }
  ): Promise<Sprint> {
    const sprint = await this.assertSprint(sprintId);
    if (sprint.state !== "future") throw badRequest("Chỉ bắt đầu được sprint chưa chạy.");
    if (!(Date.parse(input.endDate) > Date.parse(input.startDate))) {
      throw badRequest("Ngày kết thúc sprint phải sau ngày bắt đầu.");
    }
    return toSprint(
      await this.jira.updateSprint(sprintId, {
        state: "active",
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.goal !== undefined ? { goal: input.goal ?? "" } : {}),
      })
    );
  }

  /**
   * Complete a sprint, deciding explicitly where unfinished work goes. Jira's own
   * dialog asks the same question; doing the move ourselves before closing —
   * rather than relying on what the close call does with open issues — means the
   * answer is always the one the user picked.
   */
  async completeSprint(
    sprintId: number,
    moveTo: number | "backlog" | "new"
  ): Promise<{ moved: number; target: Sprint | "backlog" }> {
    const sprint = await this.assertSprint(sprintId);
    if (sprint.state !== "active") throw badRequest("Chỉ hoàn thành được sprint đang chạy.");

    const open = await this.jira.getBoardIssues(
      sprint.originBoardId,
      `sprint = ${sprintId} AND statusCategory != Done`,
      ["issuetype"],
      2000
    );
    // Sub-tasks travel with their parent; moving them on their own is rejected.
    const keys = open.filter((i) => !i.fields?.issuetype?.subtask).map((i) => String(i.key));

    let target: Sprint | "backlog" = "backlog";
    if (moveTo === "new") {
      target = await this.createSprint({ boardId: sprint.originBoardId, name: nextSprintName(sprint.name) });
    } else if (typeof moveTo === "number") {
      const t = await this.assertSprint(moveTo);
      if (t.state !== "future") throw badRequest("Chỉ chuyển việc sang một sprint chưa bắt đầu.");
      target = t;
    }

    if (keys.length > 0) {
      if (target === "backlog") await this.moveToBacklog(keys);
      else await this.moveToSprint(target.id, keys);
    }
    await this.jira.updateSprint(sprintId, { state: "closed" });
    return { moved: keys.length, target };
  }

  async setEstimate(key: string, boardId: number, value: number | null, unit: "points" | "hours"): Promise<void> {
    this.assertProjectKeys([key]);
    await this.assertBoard(boardId);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1000)) {
      throw badRequest("Ước lượng phải là số từ 0 đến 1000.");
    }
    // Time fields take Jira duration syntax; points take the bare number.
    const raw = value === null ? "" : unit === "hours" ? `${value}h` : String(value);
    await this.jira.setEstimation(key, boardId, raw);
  }
}

/* ------------------------------------------------------------------ helpers */

function toSprint(raw: any): Sprint {
  const state = raw?.state === "active" || raw?.state === "closed" ? raw.state : "future";
  return {
    id: Number(raw.id),
    name: String(raw.name ?? `Sprint ${raw.id}`),
    state,
    goal: raw.goal ? String(raw.goal) : null,
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    completeDate: raw.completeDate ?? null,
  };
}

/** "GPM Sprint 7" → "GPM Sprint 8"; anything without a trailing number gets " (tiếp)". */
export function nextSprintName(name: string): string {
  const m = name.match(/^(.*?)(\d+)\s*$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name} (tiếp)`;
}

/**
 * Completed estimate per closed sprint: issues whose closedSprints include the
 * sprint AND that were resolved inside its window. The window check is what
 * stops an issue carried through three sprints from counting for all three.
 * Jira's own velocity chart also knows what was *committed*; that needs the
 * sprint report, which has no public REST API, so only completion is shown.
 */
function computeVelocity(
  closed: Sprint[],
  recentDone: any[],
  estimation: BoardSnapshot["estimation"]
): VelocityPoint[] {
  const recent = closed
    .filter((s) => s.completeDate)
    .sort((a, b) => (a.completeDate ?? "").localeCompare(b.completeDate ?? ""))
    .slice(-VELOCITY_SPRINTS);

  return recent.map((s) => {
    const start = s.startDate ? Date.parse(s.startDate) : -Infinity;
    // A day's grace: work resolved on closing day in another timezone still counts.
    const end = Date.parse(s.completeDate!) + 86_400_000;
    let completed = 0;
    let completedCount = 0;
    for (const issue of recentDone) {
      const f = issue.fields ?? {};
      const inSprint = (f.closedSprints ?? []).some((cs: any) => Number(cs.id) === s.id);
      const resolved = f.resolutiondate ? Date.parse(f.resolutiondate) : NaN;
      if (!inSprint || !(resolved >= start && resolved <= end)) continue;
      completedCount += 1;
      const raw = estimation ? f[estimation.fieldId] : null;
      if (typeof raw === "number") completed += estimation!.unit === "hours" ? raw / 3600 : raw;
    }
    return {
      sprintId: s.id,
      name: s.name,
      startDate: s.startDate,
      completeDate: s.completeDate,
      completed: Math.round(completed * 10) / 10,
      completedCount,
    };
  });
}

/** Issues finished per week (Monday-based, UTC) for the last six weeks. */
function computeThroughput(done: any[]): Array<{ weekStart: string; count: number }> {
  const monday = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x;
  };
  const thisWeek = monday(new Date());
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const w = new Date(thisWeek);
    w.setUTCDate(w.getUTCDate() - 7 * (5 - i));
    return { weekStart: w.toISOString().slice(0, 10), count: 0 };
  });
  for (const issue of done) {
    const at = issue.fields?.resolutiondate;
    if (!at) continue;
    const week = monday(new Date(at)).toISOString().slice(0, 10);
    const slot = weeks.find((w) => w.weekStart === week);
    if (slot) slot.count += 1;
  }
  return weeks;
}
