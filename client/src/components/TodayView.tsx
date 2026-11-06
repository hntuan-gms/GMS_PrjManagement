import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { formatDayMonth, formatWeekdayDayMonth, WEEKDAY_LONG } from "../humanDate";
import { suggestWorklogs, type LogSuggestion } from "../logSuggest";
import { buildToday } from "../today";
import { toast } from "../toast";
import type { Session, Task, TaskUpdateInput } from "../types";
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
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // My open work that no section above claims and that has no dates: it is still mine, and the page is
  // where I should notice it has no plan yet.
  const unscheduled = useMemo(() => {
    const listed = new Set([
      ...data.waitingOnMe.map((w) => w.task.id),
      ...data.overdue.map((t) => t.id),
      ...data.today.map((t) => t.id),
      ...data.upcoming.flatMap((g) => g.tasks.map((t) => t.id)),
    ]);
    return tasks.filter(
      (t) => t.assigneeAccountId === me && t.statusCategory !== "done" && t.issueType !== "Epic" && !t.startDate && !t.dueDate && !listed.has(t.id)
    );
  }, [tasks, me, data]);

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
      toast(e instanceof Error ? e.message : `Không chuyển được ${t.id}.`, { tone: "error" });
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }
  }

  // j/k/Enter/X inside the page — the same keys as every list in the app.
  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "j" || k === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(order.length - 1, c + 1));
    } else if (k === "k" || k === "ArrowUp") {
      e.preventDefault();
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
        className={`today-row${i === cursor ? " is-cursor" : ""}${done ? " is-done" : ""}${extra ? ` ${extra}` : ""}`}
        data-today-row={i}
        onClick={() => {
          setCursor(i);
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
          <dl className="today-counts">
            <div>
              <dt>Đang làm</dt>
              <dd>{data.counts.doing}</dd>
            </div>
            <div>
              <dt>Đến hạn tuần này</dt>
              <dd>{data.counts.dueThisWeek}</dd>
            </div>
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
                <span className="today-day-label">{formatWeekdayDayMonth(g.date, today)}</span>
                <ul>{g.tasks.map((t) => row(t, due(t)))}</ul>
              </div>
            ))}
          </section>
        )}

        {unscheduled.length > 0 && (
          <section className="today-section">
            <h2>Chưa xếp lịch</h2>
            <ul>{unscheduled.map((t) => row(t, "chưa có ngày"))}</ul>
          </section>
        )}

        {nothing && (
          <p className="today-empty">
            Không có việc nào đang giao cho bạn trong dự án này. Bấm <kbd>C</kbd> để tạo việc, hoặc <kbd>1</kbd> để mở kế hoạch.
          </p>
        )}
      </div>

      <div className="today-log-strip">
        <span>
          <Icon name="clock" size={15} />
          Ghi giờ hôm nay
        </span>
        <button type="button" className="primary" onClick={() => setLogOpen(true)}>
          Ghi giờ
          <kbd>G T</kbd>
        </button>
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
  const [logged, setLogged] = useState<number | null>(null);
  const [rows, setRows] = useState<Array<LogSuggestion & { done?: boolean }>>([]);
  const [sending, setSending] = useState(false);

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
      toast(`Đã ghi ${ok} mục giờ làm hôm nay.`, { tone: "success" });
      onLogged();
      onClose();
    }
  }

  return (
    <aside className="side-sheet" role="dialog" aria-label="Ghi giờ hôm nay" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <header className="side-sheet-head">
        <h2>Ghi giờ hôm nay</h2>
        <span className="muted">
          năng lực {capacityHours}h{logged ? ` · đã ghi ${logged}h` : ""}
        </span>
        <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <div className="side-sheet-body">
        {logged === null ? (
          <p className="muted">Đang xem bạn đã ghi gì hôm nay…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Không có việc nào đang làm để gợi ý. Mở một việc và dùng “+ Ghi giờ” trong đó.</p>
        ) : (
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
        <p className="log-note">Gợi ý dựa trên việc bạn đang làm, không phải đo thời gian thật. Giờ được ghi bằng tài khoản Jira của bạn.</p>
      </div>
      <footer className="side-sheet-foot">
        <span>
          Tổng <b>{total}h</b> / {capacityHours}h
        </span>
        <button type="button" className="primary" onClick={send} disabled={sending || total <= 0}>
          {sending ? "Đang ghi…" : "Ghi tất cả"}
        </button>
      </footer>
    </aside>
  );
}
