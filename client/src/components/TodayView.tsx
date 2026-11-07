import { useEffect, useMemo, useRef, useState } from "react";
import { useLayer } from "../useLayer";
import DateField from "./DateField";
import TaskPicker from "./TaskPicker";
import { api } from "../api";
import { formatDayMonth, WEEKDAY_LONG } from "../humanDate";
import { suggestWorklogs } from "../logSuggest";
import { buildToday, upcomingHeading } from "../today";
import { toast } from "../toast";
import { neededFieldsFrom } from "../transitionFields";
import { isAssignableType, type Session, type Task, type TaskUpdateInput } from "../types";
import { isoWeekday } from "../workCalendar";
import { useWorkCalendar } from "./workCalendarContext";
import { Icon } from "./Icons";
import StatusGlyph from "./StatusGlyph";

interface Props {
  session: Session;
  tasks: Task[];
  today: string;
  /** Hours a day this person has (resource profile), 8 when unknown. */
  capacityHours: number;
  onOpenTask: (task: Task) => void;
  onUpdateTask: (id: string, patch: TaskUpdateInput) => Promise<void>;
  onQuickCreate: (text: string) => Promise<void>;
  onWorkLogged: () => void;
}

const firstName = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;

/**
 * "Hôm nay" — the home page (plan §6.5): what to do now and who is waiting on me, computed from the
 * tasks the workspace already holds (today.ts), so it costs no extra request. Each row is a plan row:
 * click or Enter opens it, the circle at the end finishes it.
 */
export default function TodayView({ session, tasks, today, capacityHours, onOpenTask, onUpdateTask, onQuickCreate, onWorkLogged }: Props) {
  const calendar = useWorkCalendar();
  const me = session.user.accountId;
  const data = useMemo(() => buildToday(tasks, me, today, calendar), [tasks, me, today, calendar]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // Rows just finished stay a moment (faded) so "Hoàn tác" has something to point at.
  const [justDone, setJustDone] = useState<Map<string, Task>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  // The first row is not drawn as selected on arrival: only after J / K or a click moved the cursor.
  const [cursorShown, setCursorShown] = useState(false);
  // "L" from the workspace's keyboard layer.
  useEffect(() => {
    const open = () => setLogOpen(true);
    window.addEventListener("gms:log-time", open);
    return () => window.removeEventListener("gms:log-time", open);
  }, []);
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // My open work with no dates: it is still mine, and the page is where I should notice it has no plan yet.
  const unscheduled = data.unscheduled;
  // The row whose "Xếp lịch" date box is open.
  const [scheduling, setScheduling] = useState<string | null>(null);

  const order: Task[] = useMemo(
    () => [
      ...data.waitingOnMe.map((w) => w.task),
      ...data.overdue,
      ...data.today,
      ...data.upcoming.flatMap((g) => g.tasks),
      ...unscheduled,
    ],
    [data, unscheduled]
  );

  async function finish(t: Task) {
    if (busy.has(t.id)) return;
    setBusy((s) => new Set(s).add(t.id));
    try {
      const transitions = await api.getTaskTransitions(t.id);
      const done = transitions.find((x) => x.toCategory === "done" && x.fields.every((f) => f.optional)) ?? transitions.find((x) => x.toCategory === "done");
      if (!done) {
        toast(`Quy trình của ${t.id} không có bước chuyển sang Xong từ “${t.statusName}”.`, { tone: "error" });
        return;
      }
      if (done.fields.some((f) => !f.optional)) {
        // The move needs a field filled in: the detail window asks for it (TransitionFields).
        toast(`Chuyển ${t.id} sang ${done.toStatusName} cần nhập: ${done.fields.map((f) => f.name).join(", ")}.`, { tone: "info" });
        onOpenTask(t);
        return;
      }
      setJustDone((m) => new Map(m).set(t.id, t));
      window.setTimeout(() => setJustDone((m) => {
        const n = new Map(m);
        n.delete(t.id);
        return n;
      }), 1600);
      await onUpdateTask(t.id, { statusTransition: done.id });
      const before = t.statusName;
      toast(`Đã chuyển ${t.id} sang ${done.toStatusName}.`, {
        tone: "success",
        action: {
          label: "Hoàn tác",
          run: async () => {
            try {
              const back = (await api.getTaskTransitions(t.id)).find((x) => x.toStatusName === before);
              if (!back) {
                toast(`Không hoàn tác được: quy trình không cho quay lại “${before}”.`, { tone: "error" });
                return;
              }
              await onUpdateTask(t.id, { statusTransition: back.id });
            } catch (e) {
              toast(e instanceof Error ? e.message : "Không hoàn tác được.", { tone: "error" });
            }
          },
        },
      });
    } catch (e) {
      setJustDone((m) => {
        const n = new Map(m);
        n.delete(t.id);
        return n;
      });
      // A validator the workflow's screen did not show: the detail window asks for what is missing.
      const need = neededFieldsFrom(e);
      if (need) {
        toast(`Chuyển ${t.id} sang ${need.toStatusName ?? "Xong"} cần nhập: ${need.fields.map((f) => f.name).join(", ")}.`, { tone: "info" });
        onOpenTask(t);
      } else {
        toast(e instanceof Error ? e.message : `Không chuyển được ${t.id}.`, { tone: "error" });
      }
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }
  }

  async function schedule(t: Task, startDate: string) {
    setScheduling(null);
    try {
      await onUpdateTask(t.id, { startDate });
      toast(`Đã xếp lịch ${t.id} từ ${formatDayMonth(startDate, today)}.`, { tone: "success" });
    } catch (e) {
      toast(e instanceof Error ? e.message : `Không xếp lịch được ${t.id}.`, { tone: "error" });
    }
  }

  // j/k/Enter/X inside the page — the same keys as every list in the app.
  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    // Enter on a button inside a row is that button's own click, not "open the row under the cursor".
    if (e.key === "Enter" && target.closest("button")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "j" || k === "ArrowDown") {
      e.preventDefault();
      setCursorShown(true);
      setCursor((c) => Math.min(order.length - 1, c + 1));
    } else if (k === "k" || k === "ArrowUp") {
      e.preventDefault();
      setCursorShown(true);
      setCursor((c) => Math.max(0, c - 1));
    } else if (k === "Enter" && order[cursor]) {
      e.preventDefault();
      onOpenTask(order[cursor]);
    } else if ((k === "x" || k === "X") && order[cursor]) {
      e.preventDefault();
      void finish(order[cursor]);
    }
  }

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>(`[data-today-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  useEffect(() => {
    if (scheduling) rootRef.current?.querySelector<HTMLInputElement>(".today-schedule input[type=text]")?.focus();
  }, [scheduling]);

  const index = new Map(order.map((t, i) => [t.id, i]));
  const weekday = WEEKDAY_LONG[isoWeekday(today)];
  const [y, m, d] = today.split("-").map(Number);
  const nothing = order.length === 0 && justDone.size === 0;

  const row = (t: Task, meta: React.ReactNode, extra?: string) => {
    const i = index.get(t.id) ?? -1;
    const done = justDone.has(t.id);
    return (
      <li
        key={t.id}
        className={`today-row${cursorShown && i === cursor ? " is-cursor" : ""}${done ? " is-done" : ""}${extra ? ` ${extra}` : ""}`}
        data-today-row={i}
        onClick={() => {
          setCursor(i);
          setCursorShown(true);
          onOpenTask(t);
        }}
      >
        <StatusGlyph category={done ? "done" : t.statusCategory} percent={t.percentComplete} />
        <span className="today-key">{t.id}</span>
        <span className="today-title">{t.summary}</span>
        <span className="today-meta">{meta}</span>
        <button
          type="button"
          className={`today-check${done ? " is-on" : ""}`}
          aria-label={`Đánh dấu ${t.id} là xong`}
          title="Xong (X)"
          disabled={busy.has(t.id) || done}
          onClick={(e) => {
            e.stopPropagation();
            void finish(t);
          }}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            <path d="M6.4 10.3l2.5 2.5 4.8-5" />
          </svg>
        </button>
      </li>
    );
  };

  const due = (t: Task) => (t.dueDate ? `hạn ${t.dueDate === today ? "hôm nay" : formatDayMonth(t.dueDate, today)}` : "");

  return (
    <div className="today-view" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="today-inner">
        <header className="today-head">
          <div>
            <p className="today-date">
              {weekday}, {d} tháng {m}
              {y !== new Date().getFullYear() ? `, ${y}` : ""}
            </p>
            <h1 className="today-greeting">
              Chào {firstName(session.user.displayName)}. <span>{data.greeting}</span>
            </h1>
          </div>
          <button type="button" className="today-log-btn" onClick={() => setLogOpen(true)}>
            <Icon name="clock" size={14} />
            Ghi giờ
            <kbd>L</kbd>
          </button>
          <dl className="today-counts">
            {data.counts.doing > 0 && (
              <div>
                <dt>Đang làm</dt>
                <dd>{data.counts.doing}</dd>
              </div>
            )}
            {data.counts.dueThisWeek > 0 && (
              <div>
                <dt>Đến hạn tuần này</dt>
                <dd>{data.counts.dueThisWeek}</dd>
              </div>
            )}
          </dl>
        </header>

        {data.waitingOnMe.length > 0 && (
          <section className="today-section is-waiting">
            <h2>Đang chờ bạn</h2>
            <ul>
              {data.waitingOnMe.map(({ task, waiters }) =>
                row(
                  task,
                  <>
                    {due(task)}
                    <span
                      className="today-waiters"
                      title={
                        waiters
                          .filter((w) => w.slipDaysIfLate > 0)
                          .map((w) => `${w.task.id} trễ ${w.slipDaysIfLate} ngày nếu việc này trễ`)
                          .join("\n") || undefined
                      }
                    >
                      {waiters.map((w) => `${firstName(w.assigneeName)} chờ`).join(", ")}
                    </span>
                  </>
                )
              )}
            </ul>
          </section>
        )}

        {data.overdue.length > 0 && (
          <section className="today-section is-overdue">
            <h2>Quá hạn</h2>
            <ul>{data.overdue.map((t) => row(t, <span className="today-late">{due(t)}</span>))}</ul>
          </section>
        )}

        <section className="today-section">
          <h2>Hôm nay</h2>
          <ul>
            {data.today.map((t) => row(t, t.statusCategory === "indeterminate" ? "đang làm" : due(t) || "bắt đầu hôm nay"))}
            {[...justDone.values()]
              .filter((t) => !order.some((o) => o.id === t.id))
              .map((t) => row(t, "xong", "is-done"))}
          </ul>
          <form
            className="today-add"
            onSubmit={async (e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              setDraft("");
              // Added from "Hôm nay": mine, starting today, unless the line says otherwise.
              const withMe = /(^|\s)@\S/.test(text) ? text : `${text} @tôi`;
              await onQuickCreate(/(^|\s)(hôm nay|mai|t[2-7]|cn|\d{1,2}\/\d{1,2})(\s|$)/i.test(withMe) ? withMe : `${withMe} hôm nay`);
            }}
          >
            <Icon name="plus" size={15} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Thêm việc cho hôm nay…"
              aria-label="Thêm việc cho hôm nay"
            />
          </form>
        </section>

        {data.upcoming.length > 0 && (
          <section className="today-section">
            <h2>Sắp tới</h2>
            {data.upcoming.map((g) => (
              <div key={g.date} className="today-day">
                <span className="today-day-label">{upcomingHeading(g.date, today)}</span>
                <ul>{g.tasks.map((t) => row(t, due(t)))}</ul>
              </div>
            ))}
          </section>
        )}

        {unscheduled.length > 0 && (
          <section className="today-section">
            <h2>Chưa xếp lịch</h2>
            <ul>
              {unscheduled.map((t) =>
                row(
                  t,
                  scheduling === t.id ? (
                    <span className="today-schedule" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setScheduling(null))}>
                      <DateField value="" ariaLabel={`Ngày bắt đầu ${t.id}`} onChange={(iso) => void schedule(t, iso)} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-btn today-schedule-btn"
                      aria-label={`Xếp lịch ${t.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setScheduling(t.id);
                      }}
                    >
                      Xếp lịch
                    </button>
                  )
                )
              )}
            </ul>
          </section>
        )}

        {nothing && (
          <p className="today-empty">
            Không có việc nào đang giao cho bạn trong dự án này. Bấm <kbd>C</kbd> để tạo việc, hoặc <kbd>1</kbd> để mở kế hoạch.
          </p>
        )}
      </div>

      {logOpen && (
        <LogSheet
          tasks={tasks}
          byId={byId}
          me={me}
          today={today}
          capacityHours={capacityHours}
          onClose={() => setLogOpen(false)}
          onLogged={onWorkLogged}
        />
      )}
    </div>
  );
}

/** "Ghi giờ hôm nay" (plan §6.9): a first draft of today's worklogs, checked and sent in one go. */
function LogSheet({
  tasks,
  byId,
  me,
  today,
  capacityHours,
  onClose,
  onLogged,
}: {
  tasks: Task[];
  byId: Map<string, Task>;
  me: string;
  today: string;
  capacityHours: number;
  onClose: () => void;
  onLogged: () => void;
}) {
  useLayer("log-sheet", true, { onEscape: onClose, dismissOnNav: true });
  const [logged, setLogged] = useState<number | null>(null);
  // "thêm" = a row the person added with "+ Việc khác", not one the page suggested.
  const [rows, setRows] = useState<Array<{ taskId: string; hours: number; reason: string; done?: boolean }>>([]);
  const [sending, setSending] = useState(false);
  const [pickAt, setPickAt] = useState<DOMRect | null>(null);
  // The picker is a layer of its own: Esc closes it first, not the sheet under it.
  useLayer("log-picker", pickAt !== null, { onEscape: () => setPickAt(null) });

  useEffect(() => {
    let alive = true;
    api
      .getTimesheet(today, today)
      .then((ts) => {
        if (!alive) return;
        const already = ts.entries.filter((e) => e.mine && e.date === today).reduce((s, e) => s + e.hours, 0);
        setLogged(already);
        setRows(suggestWorklogs(tasks, me, today, capacityHours, already, new Set()));
      })
      .catch(() => {
        if (!alive) return;
        setLogged(0);
        setRows(suggestWorklogs(tasks, me, today, capacityHours, 0, new Set()));
      });
    return () => {
      alive = false;
    };
    // Built once when the sheet opens; edits are the person's from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = rows.reduce((s, r) => s + (r.hours || 0), 0);
  function addOther(t: Task) {
    setPickAt(null);
    setRows((rs) => (rs.some((r) => r.taskId === t.id) ? rs : [...rs, { taskId: t.id, hours: Math.max(0.5, Math.floor((capacityHours - (logged ?? 0) - total) * 2) / 2), reason: "thêm" }]));
  }
  const set = (id: string, hours: number) => setRows((rs) => rs.map((r) => (r.taskId === id ? { ...r, hours: Math.max(0, Math.round(hours * 2) / 2) } : r)));

  async function send() {
    setSending(true);
    let ok = 0;
    for (const r of rows) {
      if (r.done || r.hours <= 0) continue;
      try {
        await api.logWork({ issueKey: r.taskId, date: today, hours: r.hours });
        ok++;
        setRows((rs) => rs.map((x) => (x.taskId === r.taskId ? { ...x, done: true } : x)));
      } catch (e) {
        toast(`${r.taskId}: ${e instanceof Error ? e.message : "không ghi được"}`, { tone: "error" });
      }
    }
    setSending(false);
    if (ok > 0) {
      toast(`Đã ghi ${ok} mục giờ hôm nay.`, { tone: "success" });
      onLogged();
      onClose();
    }
  }

  return (
    <aside className="side-sheet" role="dialog" aria-label="Ghi giờ hôm nay" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <header className="side-sheet-head">
        <h2>Ghi giờ hôm nay</h2>
        <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <div className="side-sheet-body">
        {logged === null ? (
          <p className="muted">Đang tải…</p>
        ) : (
          <>
            {rows.length > 0 && (
              <ul className="log-rows">
                {rows.map((r) => {
                  const t = byId.get(r.taskId);
                  return (
                    <li key={r.taskId} className={r.done ? "is-done" : ""}>
                      <span className="today-key">{r.taskId}</span>
                      <span className="log-title">
                        {t?.summary ?? ""}
                        <small>{r.reason}</small>
                      </span>
                      <span className="log-hours">
                        <button type="button" className="icon-btn" aria-label="Bớt nửa giờ" onClick={() => set(r.taskId, r.hours - 0.5)} disabled={r.done}>
                          −
                        </button>
                        <input
                          inputMode="decimal"
                          value={String(r.hours)}
                          disabled={r.done}
                          aria-label={`Số giờ cho ${r.taskId}`}
                          onChange={(e) => {
                            const v = Number(e.target.value.replace(",", "."));
                            if (Number.isFinite(v)) set(r.taskId, v);
                          }}
                        />
                        <button type="button" className="icon-btn" aria-label="Thêm nửa giờ" onClick={() => set(r.taskId, r.hours + 0.5)} disabled={r.done}>
                          +
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" className="log-other" onClick={(e) => setPickAt(e.currentTarget.getBoundingClientRect())}>
              <Icon name="plus" size={14} />
              Việc khác
            </button>
          </>
        )}
        {pickAt && (
          <TaskPicker
            anchor={pickAt}
            tasks={tasks}
            exclude={rows.map((r) => r.taskId)}
            filter={(t) => isAssignableType(t.issueType)}
            onPick={addOther}
            onClose={() => setPickAt(null)}
          />
        )}
      </div>
      <footer className="side-sheet-foot">
        <span>
          {capacityHours > 0 ? (
            <>
              Đã ghi <b>{logged ?? 0}h</b> · thêm <b>{total}h</b> / {capacityHours}h
            </>
          ) : (
            <>
              Đã ghi <b>{logged ?? 0}h</b> · thêm <b>{total}h</b>
            </>
          )}
        </span>
        <button type="button" className="primary" onClick={send} disabled={sending || total <= 0}>
          {sending ? "Đang ghi…" : "Ghi tất cả"}
        </button>
      </footer>
    </aside>
  );
}
