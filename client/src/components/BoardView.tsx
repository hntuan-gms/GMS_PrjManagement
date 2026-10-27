import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  EMPTY_FILTER,
  initials,
  isFiltering,
  matchesFilter,
  nextSprintName,
  priorityRank,
  rankTarget,
  reorder,
  summarize,
  tzOffsetMinutes,
  unitLabel,
  type BoardFilter,
  type Swimlane,
} from "../boardModel";
import { todayIso } from "../resourceAllocation";
import type {
  BoardColumn,
  BoardIssue,
  BoardSnapshot,
  EstimateSuggestion,
  JiraUser,
  Session,
  Sprint,
  SprintInsight,
  SprintPlanProposal,
  Task,
  TaskCreateInput,
} from "../types";
import BacklogView, { type SectionId } from "./BacklogView";
import { FacetAccordion, type Option } from "./FilterBar";
import { Icon } from "./Icons";
import Popover from "./Popover";
import type { QuickOptions } from "./QuickCreateOptions";
import KanbanBoard from "./KanbanBoard";
import SprintHeader from "./SprintHeader";
import { readViewCache, viewCacheScope, writeViewCache } from "../viewCache";
import { CompleteSprintModal, CreateBoardModal, SprintFormModal, SprintPlanModal } from "./SprintModals";

interface Props {
  session: Session;
  tasks: Task[];
  users: JiraUser[];
  onOpenEdit: (task: Task) => void;
  /** Refetch the workspace's tasks — the Gantt and report show status and assignee too. */
  onTasksChanged: () => Promise<void> | void;
  /**
   * A filter the assistant set (set_view_filter). The board's filter is local state
   * that starts empty on every visit to the tab, so one sent while the board was
   * not showing is handed over here and taken once.
   */
  incomingFilter: BoardFilter | null;
  onIncomingFilterTaken: () => void;
  /**
   * The workspace is still showing its saved copy of the tasks while the fresh one loads.
   * Reading the board now would be answered twice — once for each copy — so it waits.
   */
  refreshing?: boolean;
}

/**
 * The Bảng tab: a Jira Software board (Kanban or Scrum) plus its backlog and
 * sprints, read from and written to Jira directly.
 *
 * Every move is optimistic — the card lands where it was dropped at once, and
 * Jira catches up behind it — guarded the way ProjectWorkspace guards task
 * edits: a snapshot fetched while a move was still in flight is discarded, so a
 * slow read can never snap a card back to where it was a moment ago. When the
 * last in-flight move settles, the board re-reads Jira once, which is also what
 * corrects a move Jira refused.
 */

type Modal =
  | { kind: "createBoard"; type: "scrum" | "kanban" }
  | { kind: "start" | "edit"; sprint: Sprint }
  | { kind: "complete"; sprint: Sprint }
  | { kind: "plan"; sprint: Sprint };

const storageKey = (project: string) => `gms.board.${project}`;

function readStoredBoard(project: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(project));
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
}

export default function BoardView({ session, tasks, users, onOpenEdit, onTasksChanged, incomingFilter, onIncomingFilterTaken, refreshing }: Props) {
  const projectKey = session.project?.key ?? "";
  const cacheScope = viewCacheScope(session.site.cloudId, session.user.accountId, projectKey);
  const [boardId, setBoardId] = useState<number | null>(() => readStoredBoard(projectKey));
  // The last board this tab showed, so reopening it paints at once (viewCache.ts).
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(
    () => readViewCache<BoardSnapshot>(cacheScope, "board", String(readStoredBoard(projectKey))) ?? null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The tab the Scrum segmented control last chose. Not what is shown: a Kanban board has
  // no such control, so `view` below is only ever "board" there (see the comment on it).
  const [scrumView, setView] = useState<"board" | "backlog">("board");
  const [openFacet, setOpenFacet] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>(incomingFilter ?? EMPTY_FILTER);
  useEffect(() => {
    if (!incomingFilter) return;
    setFilter(incomingFilter);
    onIncomingFilterTaken();
  }, [incomingFilter, onIncomingFilterTaken]);
  const [swimlane, setSwimlane] = useState<Swimlane>("none");
  const [activeSprintId, setActiveSprintId] = useState<number | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [plan, setPlan] = useState<{ loading: boolean; data: SprintPlanProposal | null; error: string | null }>({
    loading: false,
    data: null,
    error: null,
  });
  const [insights, setInsights] = useState<Record<number, { loading: boolean; data: SprintInsight | null; error: string | null }>>({});
  const [suggestions, setSuggestions] = useState<Map<string, EstimateSuggestion>>(new Map());
  const [estimating, setEstimating] = useState(false);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const today = useMemo(() => todayIso(), []);
  const clock = () => ({ today: todayIso(), tzOffsetMinutes: tzOffsetMinutes() });

  // Staleness guard — see the component comment.
  const mutationSeq = useRef(0);
  const pending = useRef(0);

  function load(id: number | null) {
    const startedAt = mutationSeq.current;
    return api
      .getBoard(id)
      .then((s) => {
        if (pending.current > 0 || startedAt !== mutationSeq.current) return;
        setSnapshot(s);
        writeViewCache(cacheScope, "board", String(id), s);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }

  // Re-read when the board changes and whenever the workspace's tasks do — an
  // edit in the Gantt, the task modal or the assistant can move a card too.
  useEffect(() => {
    if (refreshing) return;
    load(boardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, tasks, refreshing]);

  // "/" jumps to search, as in Jira and most issue trackers.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function chooseBoard(id: number) {
    setBoardId(id);
    setSnapshot(null);
    setSuggestions(new Map());
    // A sprint id belongs to the board it came from.
    setActiveSprintId(null);
    try {
      localStorage.setItem(storageKey(projectKey), String(id));
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  }

  /**
   * One optimistic write: apply `optimistic` to the snapshot now, run `call`,
   * report a failure, and re-read Jira once nothing is in flight any more.
   */
  async function mutate(
    optimistic: ((s: BoardSnapshot) => BoardSnapshot) | null,
    call: () => Promise<unknown>,
    opts: { failure: string; touchesTasks?: boolean }
  ) {
    mutationSeq.current += 1;
    pending.current += 1;
    if (optimistic) setSnapshot((s) => (s ? optimistic(s) : s));
    let ok = true;
    try {
      await call();
    } catch (e) {
      ok = false;
      setNotice(`${opts.failure}: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
    } finally {
      pending.current -= 1;
    }
    if (pending.current === 0) {
      // Tasks changing re-reads the board through the effect above; otherwise read it here.
      if (opts.touchesTasks && ok) await onTasksChanged();
      else await load(snapshot?.board?.id ?? boardId);
    }
    return ok;
  }

  const patchIssues = (fn: (i: BoardIssue) => BoardIssue) => (s: BoardSnapshot) => ({ ...s, issues: s.issues.map(fn) });

  /* ------------------------------------------------------------ derived */

  const agile = snapshot?.mode === "agile";
  const scrum = agile && snapshot?.board?.type === "scrum";
  // Only a Scrum board has a Backlog tab. Leaving the state alone when switching to a Kanban
  // board used to strand it on "backlog": neither the board nor the backlog branch below
  // rendered, and the tab showed a blank page until a reload reset it.
  const view = scrum ? scrumView : "board";
  const unit = snapshot ? unitLabel(snapshot) : "việc";
  const activeSprints = snapshot?.sprints.filter((s) => s.state === "active") ?? [];
  const activeSprint = activeSprints.find((s) => s.id === activeSprintId) ?? activeSprints[0] ?? null;
  const taskByKey = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const scoped = useMemo(() => {
    if (!snapshot) return [];
    if (scrum) return activeSprint ? snapshot.issues.filter((i) => i.sprintId === activeSprint.id) : [];
    return snapshot.issues;
  }, [snapshot, scrum, activeSprint]);
  const shown = useMemo(() => scoped.filter((i) => matchesFilter(i, filter, today)), [scoped, filter, today]);
  const plannable = useMemo(
    () => (snapshot ? snapshot.issues.filter((i) => !i.subtask && matchesFilter(i, filter, today)) : []),
    [snapshot, filter, today]
  );

  // Offered on every filter dropdown, built from the whole board so an option
  // doesn't vanish the moment it is ticked.
  const filterOptions = useMemo(() => {
    const issues = snapshot?.issues ?? [];
    const plain = (vals: Iterable<string>): Option[] =>
      [...new Set(vals)].sort((a, b) => a.localeCompare(b, "vi")).map((v) => ({ value: v, label: v }));
    const epics = new Map<string, string>();
    for (const i of issues) if (i.epicKey) epics.set(i.epicKey, i.epicSummary ?? i.epicKey);
    const priorities = [...new Set(issues.map((i) => i.priority ?? "none"))].sort(
      (a, b) => priorityRank(a === "none" ? null : a) - priorityRank(b === "none" ? null : b) || a.localeCompare(b)
    );
    return {
      types: plain(issues.map((i) => i.issueType)),
      statuses: plain(issues.map((i) => i.statusName)),
      epics: [
        ...[...epics].sort((a, b) => a[1].localeCompare(b[1], "vi")).map(([value, label]) => ({ value, label: `${value} · ${label}` })),
        { value: "none", label: "Không thuộc Epic" },
      ],
      labels: plain(issues.flatMap((i) => i.labels)),
      priorities: priorities.map((p) => ({ value: p, label: p === "none" ? "Không đặt" : p })),
    };
  }, [snapshot]);

  // Types the quick-create box offers: what this project's board already uses,
  // minus sub-tasks (they need a parent), so a site that renamed "Task" still works.
  const createTypes = useMemo(() => {
    const seen = new Set((snapshot?.issues ?? []).filter((i) => !i.subtask).map((i) => i.issueType));
    return seen.size > 0 ? [...seen] : ["Task"];
  }, [snapshot]);
  const members = useMemo(() => users.map((u) => ({ accountId: u.accountId, displayName: u.displayName })), [users]);

  const people = useMemo(() => {
    const src = view === "backlog" ? plannable : scoped;
    const map = new Map<string, string>();
    for (const i of src) map.set(i.assigneeAccountId ?? "none", i.assigneeName ?? "Chưa gán");
    return [...map.entries()].sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : a[1].localeCompare(b[1], "vi")));
  }, [scoped, plannable, view]);

  const defaultWeeks = useMemo(() => {
    const v = snapshot?.velocity.at(-1);
    if (!v?.startDate || !v.completeDate) return 2;
    const days = (Date.parse(v.completeDate) - Date.parse(v.startDate)) / 86_400_000;
    return Math.min(4, Math.max(1, Math.round(days / 7)));
  }, [snapshot]);

  /* ------------------------------------------------------------ actions */

  function open(key: string) {
    const task = taskByKey.get(key);
    if (task) onOpenEdit(task);
    else window.open(`${session.site.url}/browse/${encodeURIComponent(key)}`, "_blank", "noopener");
  }

  const issueButton = (key: string) => (
    <button key={key} className="pr-issue" onClick={() => open(key)} title={snapshot?.issues.find((i) => i.key === key)?.summary}>
      {key}
    </button>
  );

  function moveCard(key: string, column: BoardColumn, beforeKey: string | null, laneAccountId: string | null | undefined) {
    if (!snapshot) return;
    const issue = snapshot.issues.find((i) => i.key === key);
    if (!issue) return;
    const statusChange = !column.statusIds.includes(issue.statusId);
    const target = snapshot.statuses.find((s) => s.id === column.statusIds[0]);
    const inColumn = shown.filter((i) => column.statusIds.includes(i.statusId));
    const rank = agile ? rankTarget(inColumn, new Set([key]), beforeKey) : undefined;
    const reassign = swimlane === "assignee" && laneAccountId !== undefined && laneAccountId !== issue.assigneeAccountId;
    if (!statusChange && !rank && !reassign) return;
    const person = reassign && laneAccountId ? users.find((u) => u.accountId === laneAccountId) : null;

    mutate(
      (s) => ({
        ...s,
        issues: reorder(
          s.issues.map((i) =>
            i.key !== key
              ? i
              : {
                  ...i,
                  ...(statusChange && target ? { statusId: target.id, statusName: target.name, statusCategory: target.category } : {}),
                  ...(reassign ? { assigneeAccountId: laneAccountId ?? null, assigneeName: person?.displayName ?? null } : {}),
                }
          ),
          [key],
          rank
        ),
      }),
      async () => {
        if (statusChange || rank) {
          await api.moveCard(key, { toStatusIds: statusChange ? column.statusIds : undefined, ...rank });
        }
        if (reassign) await api.updateTask(key, { assigneeAccountId: laneAccountId ?? null });
      },
      { failure: `Không chuyển được ${key}`, touchesTasks: statusChange || reassign }
    );
  }

  function moveIssues(keys: string[], to: SectionId, beforeKey: string | null) {
    if (!snapshot) return;
    const targetSprint = to === "backlog" ? null : to;
    const list = plannable.filter((i) => (targetSprint === null ? i.sprintId === null && i.statusCategory !== "done" : i.sprintId === targetSprint));
    const rank = rankTarget(list, new Set(keys), beforeKey);
    const sameSection = keys.every((k) => snapshot.issues.find((i) => i.key === k)?.sprintId === targetSprint);
    if (sameSection && !rank) return;
    const moved = new Set(keys);

    mutate(
      (s) => ({
        ...s,
        issues: reorder(
          // Sub-tasks travel with their parent in Jira; mirror that locally.
          s.issues.map((i) => (moved.has(i.key) || (i.parentKey && moved.has(i.parentKey)) ? { ...i, sprintId: targetSprint } : i)),
          keys,
          rank
        ),
      }),
      () =>
        sameSection
          ? api.rankIssues(keys, rank!)
          : targetSprint === null
            ? api.moveToBacklog(keys, rank)
            : api.moveToSprint(targetSprint, keys, rank),
      { failure: `Không chuyển được ${keys.length > 1 ? `${keys.length} việc` : keys[0]}` }
    );
  }

  function assignIssue(key: string, accountId: string | null) {
    const person = accountId ? users.find((u) => u.accountId === accountId) : null;
    // Through updateTask like every other assignment, so the Epic rule applies.
    return mutate(
      patchIssues((i) =>
        i.key === key ? { ...i, assigneeAccountId: accountId, assigneeName: person?.displayName ?? null } : i
      ),
      () => api.updateTask(key, { assigneeAccountId: accountId }),
      { failure: `Không đổi được người phụ trách của ${key}`, touchesTasks: true }
    );
  }

  async function quickCreate(summary: string, to: SectionId, opts: QuickOptions, column?: BoardColumn) {
    await mutate(
      null,
      async () => {
        const task = await api.createTask({
          summary,
          // Same fallback the pickers show when the remembered type is gone.
          issueType: (createTypes.includes(opts.issueType) ? opts.issueType : createTypes[0]) as TaskCreateInput["issueType"],
          ...(opts.assigneeAccountId ? { assigneeAccountId: opts.assigneeAccountId } : {}),
        });
        if (to !== "backlog") await api.moveToSprint(to, [task.id]);
        // Created from a column other than the first: a new issue always starts in its
        // workflow's first status, so carry it to the column the user asked for. The issue
        // already exists, so a workflow that has no such transition is a notice, not a failure.
        if (column && column.name !== snapshot?.columns[0]?.name) {
          try {
            await api.moveCard(task.id, { toStatusIds: column.statusIds });
          } catch (e) {
            setNotice(`Đã tạo ${task.id} nhưng không chuyển được sang cột "${column.name}": ${e instanceof Error ? e.message : "lỗi không rõ"}`);
          }
        }
      },
      { failure: "Không tạo được công việc", touchesTasks: true }
    );
  }

  async function createSprint() {
    if (!snapshot?.board) return;
    setBusy(true);
    await mutate(null, () => api.createSprint({ boardId: snapshot.board!.id, name: nextSprintName(snapshot, projectKey) }), {
      failure: "Không tạo được sprint",
    });
    setBusy(false);
  }

  function setEstimate(key: string, value: number | null) {
    if (!snapshot?.board || !snapshot.estimation) return;
    const boardIdNow = snapshot.board.id;
    const unitNow = snapshot.estimation.unit;
    setSuggestions((m) => {
      if (!m.has(key)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });
    return mutate(
      patchIssues((i) => (i.key === key ? { ...i, estimate: value } : i)),
      () => api.setEstimate(key, boardIdNow, value, unitNow),
      { failure: `Không lưu được ước lượng cho ${key}` }
    );
  }

  async function requestEstimates() {
    if (!snapshot?.board) return;
    setEstimating(true);
    try {
      const res = await api.estimateIssues(snapshot.board.id);
      setSuggestions(new Map(res.items.map((s) => [s.key, s])));
      if (res.items.length === 0) setNotice("AI chưa đưa ra được gợi ý ước lượng nào.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Không ước lượng được.");
    } finally {
      setEstimating(false);
    }
  }

  async function acceptAll() {
    for (const s of [...suggestions.values()]) await setEstimate(s.key, s.value);
  }

  async function openPlan(sprint: Sprint) {
    if (!snapshot?.board) return;
    setModal({ kind: "plan", sprint });
    setPlan({ loading: true, data: null, error: null });
    try {
      setPlan({ loading: false, data: await api.planSprint(snapshot.board.id, sprint.id, clock()), error: null });
    } catch (e) {
      setPlan({ loading: false, data: null, error: e instanceof Error ? e.message : "Không lập được kế hoạch." });
    }
  }

  async function applyPlan(sprint: Sprint, keys: string[], goal: string) {
    const inSprint = new Set(snapshot?.issues.filter((i) => i.sprintId === sprint.id).map((i) => i.key));
    const toMove = keys.filter((k) => !inSprint.has(k));
    // Thrown rather than swallowed, so the modal stays open with the error.
    if (goal && goal !== (sprint.goal ?? "")) await api.updateSprint(sprint.id, { goal });
    if (toMove.length > 0) await api.moveToSprint(sprint.id, toMove);
    await load(snapshot?.board?.id ?? boardId);
  }

  async function analyze(sprint: Sprint) {
    if (!snapshot?.board) return;
    setInsights((m) => ({ ...m, [sprint.id]: { loading: true, data: m[sprint.id]?.data ?? null, error: null } }));
    try {
      const data = await api.sprintInsight(snapshot.board.id, sprint.id, clock());
      setInsights((m) => ({ ...m, [sprint.id]: { loading: false, data, error: null } }));
    } catch (e) {
      setInsights((m) => ({
        ...m,
        [sprint.id]: { loading: false, data: m[sprint.id]?.data ?? null, error: e instanceof Error ? e.message : "Không phân tích được." },
      }));
    }
  }

  /* ------------------------------------------------------------ render */

  if (loadError && !snapshot) {
    return (
      <div className="bd-view">
        <div className="rv-notice rv-notice-error">Không tải được board: {loadError}</div>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="bd-view">
        <div className="pr-loading">
          <span className="chat-spinner" /> Đang tải board từ Jira...
        </div>
      </div>
    );
  }

  const boardUrl = snapshot.board ? `${session.site.url}/secure/RapidBoard.jspa?rapidView=${snapshot.board.id}` : null;
  // A project with only Kanban boards has no sprints to offer (see the ⓘ beside the kind badge).
  const kanbanOnly = agile && !snapshot.boards.some((b) => b.type === "scrum");

  // The value pickers behind the "Bộ lọc" panel. The board's columns already are statuses, so
  // that facet is left out there — and offered again on the Backlog, which has no columns, or
  // while a status filter is on (the assistant can set one) so it can still be seen and cleared.
  const facets: { key: "types" | "statuses" | "epics" | "labels" | "priorities"; label: string; options: Option[]; selected: Set<string> }[] = [
    { key: "types", label: "Loại", options: filterOptions.types, selected: filter.types },
    ...(view === "backlog" || filter.statuses.size > 0
      ? [{ key: "statuses" as const, label: "Trạng thái", options: filterOptions.statuses, selected: filter.statuses }]
      : []),
    { key: "epics", label: "Epic", options: filterOptions.epics, selected: filter.epics },
    { key: "labels", label: "Nhãn", options: filterOptions.labels, selected: filter.labels },
    { key: "priorities", label: "Ưu tiên", options: filterOptions.priorities, selected: filter.priorities },
  ];
  const facetsActive = facets.filter((f) => f.selected.size > 0).length;
  const chips = facets
    .filter((f) => f.selected.size > 0)
    .map((f) => {
      const labels = [...f.selected].map((v) => f.options.find((o) => o.value === v)?.label ?? v);
      return { key: f.key, name: f.label, text: `${f.label}: ${summarize(labels)}`, full: `${f.label}: ${labels.join(", ")}` };
    });

  const lastThroughput = snapshot.throughput.at(-1)?.count ?? 0;
  const avgThroughput = snapshot.throughput.length
    ? Math.round((snapshot.throughput.reduce((s, w) => s + w.count, 0) / snapshot.throughput.length) * 10) / 10
    : 0;

  return (
    <div className="bd-view">
      <div className="bd-top">
        <div className="bd-top-left">
          {agile ? (
            // One control for "which board" and "another board": it replaces the plain select
            // and the separate "+ Bảng" button that sat beside it.
            <Popover
              className="bd-switcher"
              role="menu"
              menuLabel="Chọn board"
              menuClassName="bd-switch-menu"
              title="Chuyển board hoặc tạo board mới"
              label={
                <>
                  <Icon name="columns" size={14} />
                  <span className="bd-switcher-name">{snapshot.board?.name ?? `Bảng ${projectKey}`}</span>
                </>
              }
            >
              {({ close }) => (
                <>
                  <div className="menu-heading">Board của dự án</div>
                  {snapshot.boards.map((b) => {
                    const current = b.id === snapshot.board?.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={current}
                        className="menu-item bd-switch-item"
                        onClick={() => {
                          close();
                          if (!current) chooseBoard(b.id);
                        }}
                      >
                        <span className="bd-switch-check">{current && <Icon name="check" size={14} />}</span>
                        <span className="bd-switch-name">{b.name}</span>
                        <span className={`bd-kind bd-kind-${b.type === "scrum" ? "scrum" : "kanban"}`}>{b.type === "scrum" ? "Scrum" : "Kanban"}</span>
                      </button>
                    );
                  })}
                  <div className="menu-sep" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      setModal({ kind: "createBoard", type: "scrum" });
                    }}
                  >
                    <Icon name="plus" size={14} />
                    Tạo board mới…
                  </button>
                </>
              )}
            </Popover>
          ) : (
            <b className="bd-boardname">{snapshot.board?.name ?? `Bảng ${projectKey}`}</b>
          )}
          <span className={`bd-kind bd-kind-${scrum ? "scrum" : "kanban"}`}>{scrum ? "Scrum" : agile ? "Kanban" : "Theo trạng thái"}</span>
          {/* Kanban-only project: sprints need a Scrum board, and saying so beats leaving the
              user to wonder where the Sprint tab went — but it is an explanation, not a
              permanent banner taking a row of the board's height. */}
          {kanbanOnly && (
            <Popover
              className="bd-info"
              caret={false}
              menuLabel="Về board Kanban"
              menuClassName="bd-info-menu"
              ariaLabel="Vì sao board này không có Sprint?"
              title="Vì sao board này không có Sprint?"
              label={<Icon name="info" size={14} />}
            >
              {({ close }) => (
                <div className="bd-info-body">
                  <p>Board này là Kanban nên không có Sprint — Jira chỉ gắn sprint với board Scrum.</p>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      close();
                      setModal({ kind: "createBoard", type: "scrum" });
                    }}
                  >
                    Tạo board Scrum cho dự án
                  </button>
                </div>
              )}
            </Popover>
          )}
          {scrum && (
            <div className="bd-seg" role="tablist">
              <button className={view === "board" ? "is-active" : ""} onClick={() => setView("board")} role="tab" aria-selected={view === "board"}>
                Sprint đang chạy
              </button>
              <button className={view === "backlog" ? "is-active" : ""} onClick={() => setView("backlog")} role="tab" aria-selected={view === "backlog"}>
                Backlog & kế hoạch
              </button>
            </div>
          )}
          {!agile && snapshot.fallback?.reason === "no_board" ? (
            <button className="bl-icon" onClick={() => setModal({ kind: "createBoard", type: "scrum" })} title="Tạo board mới">
              + Bảng
            </button>
          ) : null}
          {activeSprints.length > 1 && view === "board" && (
            <select className="bd-select" value={activeSprint?.id ?? ""} onChange={(e) => setActiveSprintId(Number(e.target.value))}>
              {activeSprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="bd-top-right">
          {!scrum && snapshot.throughput.length > 0 && (
            <span className="bd-muted" title="Số việc hoàn thành mỗi tuần, 6 tuần gần nhất">
              Hoàn thành: <b>{lastThroughput}</b> tuần này · TB {avgThroughput}/tuần
            </span>
          )}
          {/* No refresh button of its own: the header's "Đồng bộ từ Jira" reloads the tasks,
              and this board re-reads whenever they change. A second ↻ here read as a
              different action and left people unsure which one to press. */}
          {boardUrl && (
            <a className="bd-link" href={boardUrl} target="_blank" rel="noreferrer">
              Mở trên Jira
              <Icon name="external" size={12} />
            </a>
          )}
        </div>
      </div>

      {snapshot.fallback && (
        <div className="bd-fallback">
          ℹ {snapshot.fallback.message}
          {snapshot.fallback.reason === "no_board" && (
            <button className="text-btn" onClick={() => setModal({ kind: "createBoard", type: "scrum" })}>
              Tạo board Scrum
            </button>
          )}
        </div>
      )}
      {snapshot.truncated && <div className="bd-fallback">Board có quá nhiều việc — chỉ hiển thị 800 việc đầu theo thứ hạng.</div>}
      {notice && (
        <div className="notice notice-error bd-notice">
          <span>{notice}</span>
          <button className="link-btn" onClick={() => setNotice(null)}>Đóng</button>
        </div>
      )}

      <div className="bd-filters">
        <input
          ref={searchRef}
          className="bd-search"
          value={filter.text}
          placeholder="Tìm việc…  ( / )"
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
        <div className="bd-people">
          {people.map(([id, name]) => {
            const on = filter.people.has(id);
            return (
              <button
                key={id}
                className={`bd-avatar bd-person ${id === "none" ? "is-none" : ""} ${on ? "is-on" : ""}`}
                title={name}
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(filter.people);
                  if (on) next.delete(id);
                  else next.add(id);
                  setFilter({ ...filter, people: next });
                }}
              >
                {id === "none" ? "?" : initials(name)}
              </button>
            );
          })}
        </div>
        <button
          className={`bd-chipbtn ${filter.people.has(session.user.accountId) && filter.people.size === 1 ? "is-on" : ""}`}
          onClick={() =>
            setFilter({
              ...filter,
              people: filter.people.has(session.user.accountId) && filter.people.size === 1 ? new Set() : new Set([session.user.accountId]),
            })
          }
        >
          Của tôi
        </button>
        <button className={`bd-chipbtn ${filter.onlyBlocked ? "is-on" : ""}`} onClick={() => setFilter({ ...filter, onlyBlocked: !filter.onlyBlocked })}>
          <Icon name="lock" size={13} />
          Bị chặn
        </button>
        <button className={`bd-chipbtn ${filter.onlyOverdue ? "is-on" : ""}`} onClick={() => setFilter({ ...filter, onlyOverdue: !filter.onlyOverdue })}>
          Quá hạn
        </button>
        <Popover
          className="tf-btn tf-add"
          caret={false}
          active={facetsActive > 0}
          menuLabel="Bộ lọc"
          menuClassName="tf-menu tf-filter-menu"
          title="Lọc theo loại, Epic, nhãn, ưu tiên…"
          label={
            <>
              <Icon name="plus" size={14} />
              Bộ lọc
              {facetsActive > 0 && <span className="tf-badge">{facetsActive}</span>}
            </>
          }
        >
          <FacetAccordion
            facets={facets}
            openKey={openFacet}
            onOpenChange={setOpenFacet}
            onChange={(key, next) => setFilter({ ...filter, [key]: next })}
          />
        </Popover>
        <span className="bd-spacer" />
        {view === "board" && (
          <label className="bd-lanepick">
            Nhóm theo
            <select value={swimlane} onChange={(e) => setSwimlane(e.target.value as Swimlane)}>
              <option value="none">Không</option>
              <option value="assignee">Người phụ trách</option>
              <option value="epic">Epic</option>
            </select>
          </label>
        )}
        {/* Only present while something is filtering, so an idle board spends no row on it. */}
        {isFiltering(filter) && (
          <div className="tf-active">
            {chips.map((c) => (
              <span key={c.key} className="tf-chip" title={c.full}>
                <span className="tf-chip-label">{c.text}</span>
                <button
                  type="button"
                  className="tf-chip-x"
                  aria-label={`Bỏ lọc ${c.name}`}
                  onClick={() => setFilter({ ...filter, [c.key]: new Set<string>() })}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
            <span className="tf-count" role="status" aria-atomic="true">
              {shown.length}/{scoped.length} thẻ
            </span>
            <button type="button" className="text-btn tf-clear" onClick={() => setFilter(EMPTY_FILTER)}>
              Xoá lọc
            </button>
          </div>
        )}
      </div>

      {view === "board" && scrum && activeSprint && (
        <SprintHeader
          sprint={activeSprint}
          snapshot={snapshot}
          issues={scoped.filter((i) => !i.subtask)}
          today={today}
          unit={unit}
          canUseAi={session.staff}
          insight={insights[activeSprint.id] ?? { loading: false, data: null, error: null }}
          onAnalyze={() => analyze(activeSprint)}
          onComplete={() => setModal({ kind: "complete", sprint: activeSprint })}
          onEdit={() => setModal({ kind: "edit", sprint: activeSprint })}
          onDescope={(key) => moveIssues([key], "backlog", null)}
          issueButton={issueButton}
        />
      )}

      {view === "board" && isFiltering(filter) && scoped.length > 0 && shown.length === 0 && (
        <div className="bd-empty">
          <b>Không có thẻ nào khớp bộ lọc.</b>
          <button className="primary" onClick={() => setFilter(EMPTY_FILTER)}>Xoá lọc</button>
        </div>
      )}

      {view === "board" &&
        !(isFiltering(filter) && scoped.length > 0 && shown.length === 0) &&
        (scrum && !activeSprint ? (
          <div className="bd-empty">
            <b>Chưa có sprint nào đang chạy.</b>
            <p>Lên kế hoạch ở Backlog rồi bắt đầu sprint — AI có thể chọn việc giúp bạn.</p>
            <button className="primary" onClick={() => setView("backlog")}>Mở Backlog</button>
          </div>
        ) : (
          <KanbanBoard
            // Folded columns are remembered per board, so a board switch starts from its own.
            key={snapshot.board?.id ?? "status"}
            snapshot={snapshot}
            issues={shown}
            swimlane={swimlane}
            today={today}
            onMove={moveCard}
            onOpen={open}
            onQuickCreate={(summary, opts, column) => quickCreate(summary, scrum && activeSprint ? activeSprint.id : "backlog", opts, column)}
            members={members}
            createTypes={createTypes}
            onAssign={assignIssue}
          />
        ))}

      {view === "backlog" && scrum && (
        <BacklogView
          snapshot={snapshot}
          issues={plannable}
          unit={unit}
          canUseAi={session.staff}
          busy={busy}
          onOpen={open}
          onMove={moveIssues}
          onCreateSprint={createSprint}
          onStartSprint={(sprint) => setModal({ kind: "start", sprint })}
          onCompleteSprint={(sprint) => setModal({ kind: "complete", sprint })}
          onEditSprint={(sprint) => setModal({ kind: "edit", sprint })}
          onPlanSprint={openPlan}
          onSetEstimate={setEstimate}
          onQuickCreate={quickCreate}
          members={members}
          createTypes={createTypes}
          onAssign={assignIssue}
          suggestions={suggestions}
          estimating={estimating}
          onRequestEstimates={requestEstimates}
          onAcceptSuggestion={(key) => {
            const s = suggestions.get(key);
            if (s) setEstimate(key, s.value);
          }}
          onDismissSuggestion={(key) =>
            setSuggestions((m) => {
              const next = new Map(m);
              next.delete(key);
              return next;
            })
          }
          onAcceptAllSuggestions={acceptAll}
        />
      )}

      {modal?.kind === "createBoard" && (
        <CreateBoardModal
          projectKey={projectKey}
          defaultType={modal.type}
          onClose={() => setModal(null)}
          onSubmit={async (name, type) => {
            const board = await api.createBoard(name, type);
            chooseBoard(board.id);
            setView(type === "scrum" ? "backlog" : "board");
          }}
        />
      )}
      {modal && (modal.kind === "start" || modal.kind === "edit") && (
        <SprintFormModal
          mode={modal.kind}
          sprint={modal.sprint}
          today={today}
          defaultWeeks={defaultWeeks}
          onClose={() => setModal(null)}
          onSubmit={async (input) => {
            if (modal.kind === "start") {
              await api.startSprint(modal.sprint.id, {
                startDate: input.startDate!,
                endDate: input.endDate!,
                name: input.name,
                goal: input.goal,
              });
              setView("board");
            } else {
              await api.updateSprint(modal.sprint.id, input);
            }
            await load(snapshot.board?.id ?? boardId);
          }}
        />
      )}
      {modal?.kind === "complete" && (
        <CompleteSprintModal
          sprint={modal.sprint}
          snapshot={snapshot}
          issues={snapshot.issues.filter((i) => i.sprintId === modal.sprint.id && !i.subtask)}
          unit={unit}
          onClose={() => setModal(null)}
          onSubmit={async (moveTo) => {
            await api.completeSprint(modal.sprint.id, moveTo);
            // Straight to planning the next one — the natural next step after a close.
            setView("backlog");
            await load(snapshot.board?.id ?? boardId);
          }}
        />
      )}
      {modal?.kind === "plan" && (
        <SprintPlanModal
          sprint={modal.sprint}
          snapshot={snapshot}
          proposal={plan.data}
          loading={plan.loading}
          error={plan.error}
          unit={unit}
          issueButton={issueButton}
          onClose={() => setModal(null)}
          onApply={(keys, goal) => applyPlan(modal.sprint, keys, goal)}
        />
      )}
    </div>
  );
}
