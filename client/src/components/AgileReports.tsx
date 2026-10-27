import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { shortDate, tzOffsetMinutes, unitLabel } from "../boardModel";
import { todayIso } from "../resourceAllocation";
import type { BoardSnapshot, FlowReport, SprintReport, SprintReportLine } from "../types";
import { readViewCache, writeViewCache } from "../viewCache";
import { BurnupChart, CfdChart, ControlChart, CreatedResolvedChart, VelocityChart } from "./AgileCharts";

interface Props {
  /** Site + account + project — keys the last board snapshot shown (viewCache.ts). */
  cacheScope: string;
  projectKey: string;
  /** Opens a task from a sprint-report row, when it is one the workspace holds. */
  issueLink: (key: string) => React.ReactNode;
}

type Tab = "velocity" | "sprint" | "cfd" | "control" | "created";

const TABS: Array<{ id: Tab; label: string; needsBoard: boolean }> = [
  { id: "velocity", label: "Vận tốc", needsBoard: true },
  { id: "sprint", label: "Sprint & burnup", needsBoard: true },
  { id: "cfd", label: "Luồng công việc", needsBoard: false },
  { id: "control", label: "Thời gian xử lý", needsBoard: false },
  { id: "created", label: "Tạo và xong", needsBoard: false },
];

const FLOW_DAYS: Array<30 | 60 | 90> = [30, 60, 90];

const boardStorageKey = (project: string) => `gms.board.${project}`;

function storedBoardId(project: string): number | null {
  try {
    return Number(localStorage.getItem(boardStorageKey(project))) || null;
  } catch {
    return null;
  }
}

/** One request's outcome, tagged with what it answered so a late reply to an older question is ignored. */
interface Answer<T> {
  key: string;
  data?: T;
  error?: string;
}

/**
 * The Agile charts, below the report page's measured numbers: velocity, a sprint's report and
 * burnup, then the flow charts (cumulative flow, time to finish, created vs resolved).
 *
 * Folded away until opened: the flow charts read every issue's changelog from Jira, and a report
 * page that does that on every visit would be slow for people who only wanted the health verdict.
 * Nothing here is AI — each figure is counted from Jira's own data.
 */
export default function AgileReports({ cacheScope, projectKey, issueLink }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("velocity");
  const [days, setDays] = useState<30 | 60 | 90>(60);
  const [metric, setMetric] = useState<"cycle" | "lead">("cycle");
  const [sprintId, setSprintId] = useState<number | null>(null);
  const today = useMemo(() => todayIso(), []);

  const needsBoard = TABS.find((t) => t.id === tab)!.needsBoard;

  /* ------------------------------------------------------------ board */
  const [board, setBoard] = useState<Answer<BoardSnapshot> | null>(null);
  const boardId = storedBoardId(projectKey);
  useEffect(() => {
    if (!open || !needsBoard) return;
    let alive = true;
    api
      .getBoard(boardId)
      .then((data) => {
        writeViewCache(cacheScope, "board", String(boardId), data);
        if (alive) setBoard({ key: "board", data });
      })
      .catch((e: Error) => alive && setBoard({ key: "board", error: e.message }));
    return () => {
      alive = false;
    };
  }, [open, needsBoard, boardId, cacheScope]);
  // The last board this browser saw paints at once while the fresh read is on its way (viewCache.ts).
  const snapshot = board?.data ?? (open && needsBoard ? readViewCache<BoardSnapshot>(cacheScope, "board", String(boardId)) : null) ?? null;
  const agile = snapshot?.mode === "agile";

  /* ----------------------------------------------------- sprint choice */
  const sprintChoices = useMemo(() => {
    if (!snapshot) return [];
    const running = snapshot.sprints.filter((s) => s.state === "active").map((s) => ({ id: s.id, label: `${s.name} (đang chạy)` }));
    const closed = [...snapshot.velocity].reverse().map((v) => ({ id: v.sprintId, label: v.name }));
    return [...running, ...closed];
  }, [snapshot]);
  const chosenSprint = sprintId ?? sprintChoices[0]?.id ?? null;

  const [sprintAnswer, setSprintAnswer] = useState<Answer<SprintReport> | null>(null);
  const sprintKey = `sprint:${chosenSprint}`;
  useEffect(() => {
    if (!open || tab !== "sprint" || chosenSprint === null) return;
    let alive = true;
    api
      .getSprintReport(chosenSprint, { today, tzOffsetMinutes: tzOffsetMinutes() })
      .then((data) => alive && setSprintAnswer({ key: sprintKey, data }))
      .catch((e: Error) => alive && setSprintAnswer({ key: sprintKey, error: e.message }));
    return () => {
      alive = false;
    };
  }, [open, tab, chosenSprint, sprintKey, today]);

  /* ------------------------------------------------------------- flow */
  const [flowAnswer, setFlowAnswer] = useState<Answer<FlowReport> | null>(null);
  const flowKey = `flow:${days}`;
  const needsFlow = tab === "cfd" || tab === "control" || tab === "created";
  useEffect(() => {
    if (!open || !needsFlow) return;
    let alive = true;
    api
      .getFlow(days, today)
      .then((data) => alive && setFlowAnswer({ key: flowKey, data }))
      .catch((e: Error) => alive && setFlowAnswer({ key: flowKey, error: e.message }));
    return () => {
      alive = false;
    };
  }, [open, needsFlow, days, flowKey, today]);
  const flowLoading = needsFlow && flowAnswer?.key !== flowKey;
  const flow = flowAnswer?.key === flowKey ? flowAnswer : null;

  const unit = snapshot ? unitLabel(snapshot) : "việc";

  return (
    <section className="pr-card pr-agile">
      <button className="ag-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`bd-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
        <h3>Báo cáo Agile</h3>
        <span className="pr-muted">vận tốc · sprint và burnup · luồng công việc · thời gian xử lý</span>
      </button>

      {open && (
        <div className="ag-body">
          <div className="bd-seg ag-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {needsBoard && !snapshot && !board?.error && (
            <div className="pr-loading">
              <span className="chat-spinner" /> Đang đọc board từ Jira...
            </div>
          )}
          {needsBoard && board?.error && !snapshot && <div className="rv-notice rv-notice-error">Không tải được board: {board.error}</div>}
          {needsBoard && snapshot && !agile && (
            <p className="pr-muted">{snapshot.fallback?.message ?? "Cần một board Jira Software (Scrum) để xem vận tốc và báo cáo sprint."}</p>
          )}

          {tab === "velocity" && agile && (
            <VelocityChart points={snapshot!.velocity} unit={unit} byCount={!snapshot!.estimation} />
          )}

          {tab === "sprint" && agile && (
            <>
              {sprintChoices.length === 0 ? (
                <p className="pr-muted">Board này chưa có sprint đang chạy hoặc đã hoàn thành.</p>
              ) : (
                <label className="pr-filter ag-pick">
                  Sprint
                  <select value={chosenSprint ?? ""} onChange={(e) => setSprintId(Number(e.target.value))}>
                    {sprintChoices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {chosenSprint !== null && sprintAnswer?.key !== sprintKey && (
                <div className="pr-loading">
                  <span className="chat-spinner" /> Đang dựng báo cáo sprint từ lịch sử thay đổi...
                </div>
              )}
              {sprintAnswer?.key === sprintKey && sprintAnswer.error && <div className="rv-notice rv-notice-error">{sprintAnswer.error}</div>}
              {sprintAnswer?.key === sprintKey && sprintAnswer.data && (
                <SprintReportBody report={sprintAnswer.data} unit={unit} issueLink={issueLink} />
              )}
            </>
          )}

          {needsFlow && (
            <>
              <div className="ag-flow-tools">
                <label className="pr-filter">
                  Khoảng thời gian
                  <select value={days} onChange={(e) => setDays(Number(e.target.value) as 30 | 60 | 90)}>
                    {FLOW_DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d} ngày gần nhất
                      </option>
                    ))}
                  </select>
                </label>
                {tab === "control" && (
                  <div className="bd-seg" role="tablist" aria-label="Thước đo">
                    <button role="tab" aria-selected={metric === "cycle"} className={metric === "cycle" ? "is-active" : ""} onClick={() => setMetric("cycle")} title="Từ lúc chuyển sang “đang làm” tới lúc xong">
                      Cycle time
                    </button>
                    <button role="tab" aria-selected={metric === "lead"} className={metric === "lead" ? "is-active" : ""} onClick={() => setMetric("lead")} title="Từ lúc tạo việc tới lúc xong">
                      Lead time
                    </button>
                  </div>
                )}
              </div>
              {flowLoading && (
                <div className="pr-loading">
                  <span className="chat-spinner" /> Đang đọc lịch sử trạng thái từ Jira (có thể mất vài giây)...
                </div>
              )}
              {flow?.error && <div className="rv-notice rv-notice-error">{flow.error}</div>}
              {flow?.data && (
                <>
                  {flow.data.truncated && (
                    <div className="bd-fallback">Dự án có hơn 1000 việc nên chỉ đọc 1000 việc mới tạo nhất — số liệu có thể thiếu việc cũ còn mở.</div>
                  )}
                  {tab === "cfd" && (
                    <>
                      <CfdChart cfd={flow.data.cfd} />
                      <p className="pr-muted ag-note">
                        Mỗi dải là số việc đang ở một trạng thái vào cuối ngày. Dải “Đang làm” phình ra nghĩa là việc đang ùn lại. Chỉ tính việc còn mở hoặc vừa xong trong
                        kỳ, nên dải “Xong” bắt đầu từ số việc xong trong kỳ chứ không phải cả vòng đời dự án.
                      </p>
                    </>
                  )}
                  {tab === "control" && (
                    <>
                      <ControlChart report={flow.data.control} metric={metric} />
                      <p className="pr-muted ag-note">Dựa trên lịch sử đổi trạng thái; Jira chỉ trả tối đa 100 thay đổi gần nhất của mỗi việc.</p>
                    </>
                  )}
                  {tab === "created" && <CreatedResolvedChart data={flow.data.created} />}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ sprint report */

function SprintReportBody({ report, unit, issueLink }: { report: SprintReport; unit: string; issueLink: (key: string) => React.ReactNode }) {
  const t = report.totals;
  const lines = (list: SprintReportLine[]) =>
    list.length === 0 ? (
      <li className="pr-muted">Không có.</li>
    ) : (
      list.map((l) => (
        <li key={l.key}>
          {issueLink(l.key)}
          <span className="ag-line-summary" title={l.summary}>
            {l.summary}
          </span>
          <span className={`bl-status bl-status-${l.statusCategory}`}>{l.statusName}</span>
          <b>{l.weight > 0 ? `${l.weight} ${unit}` : "—"}</b>
        </li>
      ))
    );
  return (
    <div className="ag-sprint">
      <p className="pr-muted">
        {report.sprint.name} · {shortDate(report.start)} → {shortDate(report.end)}
        {report.sprint.state === "active" ? " · đang chạy" : ""}
      </p>
      <div className="ag-tiles">
        <div className="ag-tile">
          <b>{t.committed}</b>
          <span>Cam kết lúc bắt đầu ({unit})</span>
        </div>
        <div className="ag-tile">
          <b>+{t.added}</b>
          <span>Thêm giữa sprint</span>
        </div>
        <div className="ag-tile ag-tile-good">
          <b>{t.completed}</b>
          <span>Đã hoàn thành</span>
        </div>
        <div className="ag-tile ag-tile-warn">
          <b>{t.notCompleted}</b>
          <span>Chưa xong</span>
        </div>
      </div>
      <BurnupChart series={report.burnup} unit={unit} />
      <div className="ag-lists">
        <div>
          <h4>Hoàn thành ({report.completed.length})</h4>
          <ul className="ag-lines">{lines(report.completed)}</ul>
        </div>
        <div>
          <h4>Chưa xong ({report.notCompleted.length})</h4>
          <ul className="ag-lines">{lines(report.notCompleted)}</ul>
        </div>
        <div>
          <h4>Thêm sau khi sprint bắt đầu ({report.added.length})</h4>
          <ul className="ag-lines">{lines(report.added)}</ul>
        </div>
      </div>
      {report.churned.length > 0 && (
        <p className="pr-muted ag-note">
          {report.churned.length} việc đã rời sprint rồi quay lại: {report.churned.join(", ")}.
        </p>
      )}
      <p className="pr-muted ag-note">
        Dựng lại từ lịch sử thay đổi trường Sprint của từng việc. Điểm của mỗi việc là điểm <b>hiện tại</b> (việc ước lượng lại giữa sprint không được tính lại); việc bị gỡ khỏi sprint
        và không quay lại thì Jira không còn trả về nên không có trong danh sách.
      </p>
    </div>
  );
}
