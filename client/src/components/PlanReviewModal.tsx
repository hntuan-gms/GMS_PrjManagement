import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { JiraUser, PlanResponse } from "../types";

interface Props {
  /** The staged plan to review, produced by the assistant's create_plan tool. */
  runId: string;
  users: JiraUser[];
  onClose: () => void;
  /** Called after issues are created, so the workspace can reload from Jira. */
  onApplied: () => void | Promise<void>;
}

/**
 * The human check between a generated plan and real Jira issues.
 *
 * Opened from the table card the assistant drops into the chat. Everything here
 * is still staging: durations, assignees and rows can all be changed, and only
 * "Duyệt & tạo" writes anything. The dates shown are recomputed server-side from
 * durations and the dependency graph on every edit, so changing one task's
 * length visibly moves everything downstream of it before anything is committed.
 */
export default function PlanReviewModal({ runId, users, onClose, onApplied }: Props) {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState<"loading" | "saving" | "applying" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: string[];
    errors: Array<{ summary: string; message: string }>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPlan(runId)
      .then((p) => {
        if (!cancelled) setPlan(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Không tải được kế hoạch.");
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Children indented under their parent, so a forty-row WBS reads as a tree
  // rather than a flat list.
  const depthOf = useMemo(() => {
    const byTempId = new Map((plan?.items ?? []).map((i) => [i.tempId, i]));
    const cache = new Map<string, number>();
    const walk = (tempId: string, guard = new Set<string>()): number => {
      if (cache.has(tempId)) return cache.get(tempId)!;
      const item = byTempId.get(tempId);
      if (!item?.parentTempId || guard.has(tempId)) return 0;
      guard.add(tempId);
      const d = walk(item.parentTempId, guard) + 1;
      cache.set(tempId, d);
      return d;
    };
    return (tempId: string) => walk(tempId);
  }, [plan]);

  async function patchItem(itemId: string, patch: Parameters<typeof api.updatePlanItem>[2]) {
    if (!plan) return;
    setBusy("saving");
    try {
      setPlan(await api.updatePlanItem(plan.run.id, itemId, patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được thay đổi.");
    } finally {
      setBusy(null);
    }
  }

  async function removeItem(itemId: string) {
    if (!plan) return;
    setBusy("saving");
    try {
      setPlan(await api.deletePlanItem(plan.run.id, itemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được dòng này.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy("applying");
    setError(null);
    try {
      const startDate = plan.items[0]?.startDate ?? new Date().toISOString().slice(0, 10);
      setResult(await api.applyPlan(plan.run.id, startDate));
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không áp dụng được kế hoạch.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Kiểm tra kế hoạch trước khi tạo</h2>
          <button className="link-btn" onClick={onClose}>
            Đóng
          </button>
        </div>

        {error && <div className="notice notice-error">{error}</div>}

        {result ? (
          <div className="ai-result">
            <p>
              Đã tạo <strong>{result.created.length}</strong> task trong Jira
              {result.created.length > 0 && `: ${result.created.join(", ")}`}
            </p>
            {result.errors.length > 0 && (
              <div className="notice notice-warn">
                <div>
                  <strong>{result.errors.length} dòng lỗi</strong> — các dòng còn lại đã tạo xong, kế hoạch
                  vẫn giữ để bạn thử lại:
                  <ul>
                    {result.errors.map((e, i) => (
                      <li key={i}>
                        {e.summary}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="modal-footer">
              <button onClick={onClose}>Xong</button>
            </div>
          </div>
        ) : !plan ? (
          <div className="ai-review">
            <p className="ai-hint">Đang tải kế hoạch...</p>
          </div>
        ) : (
          <div className="ai-review">
            {plan.warnings && plan.warnings.length > 0 && (
              <div className="notice notice-warn">
                <div>
                  <strong>AI đề xuất vài chỗ không hợp lệ, đã tự sửa:</strong>
                  <ul>
                    {plan.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="ai-table-wrap">
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>Công việc</th>
                    <th>Loại</th>
                    <th>Số ngày</th>
                    <th>Phụ trách</th>
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                    <th>Phụ thuộc</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plan.items.map((item) => (
                    <tr key={item.id} className={item.appliedIssueKey ? "ai-row-applied" : ""}>
                      <td
                        style={{ paddingLeft: 8 + depthOf(item.tempId) * 18 }}
                        title={item.rationale ?? ""}
                      >
                        {item.summary}
                        {item.appliedIssueKey && (
                          <span className="ai-applied-key"> {item.appliedIssueKey}</span>
                        )}
                      </td>
                      <td>{item.issueType}</td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          value={item.durationDays}
                          disabled={!!item.appliedIssueKey}
                          onChange={(e) =>
                            setPlan({
                              ...plan,
                              items: plan.items.map((i) =>
                                i.id === item.id ? { ...i, durationDays: Number(e.target.value) } : i
                              ),
                            })
                          }
                          onBlur={(e) => patchItem(item.id, { durationDays: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <select
                          value={item.assigneeAccountId ?? ""}
                          disabled={!!item.appliedIssueKey}
                          onChange={(e) => patchItem(item.id, { assigneeAccountId: e.target.value || null })}
                        >
                          <option value="">— chưa gán —</option>
                          {users.map((u) => (
                            <option key={u.accountId} value={u.accountId}>
                              {u.displayName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{item.startDate}</td>
                      <td>{item.dueDate}</td>
                      <td className="ai-deps">
                        {item.dependencies.length === 0
                          ? "—"
                          : item.dependencies
                              .map(
                                (d) =>
                                  `${d.type} ${
                                    plan.items.find((i) => i.tempId === d.tempId)?.summary ?? d.tempId
                                  }`
                              )
                              .join("; ")}
                      </td>
                      <td>
                        {!item.appliedIssueKey && (
                          <button className="link-btn" onClick={() => removeItem(item.id)} title="Bỏ dòng này">
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="ai-hint">
              {plan.items.length} công việc · ngày do hệ thống tính từ số ngày và quan hệ phụ thuộc (AI không
              tự đặt ngày), tính lại mỗi khi bạn sửa số ngày.
              {plan.run.model && <> · mô hình: {plan.run.model}</>}
            </p>

            <div className="modal-footer">
              <button onClick={onClose}>Để sau</button>
              <button
                className="primary"
                onClick={apply}
                disabled={busy !== null || plan.items.length === 0}
              >
                {busy === "applying" ? "Đang tạo task..." : `Duyệt & tạo ${plan.items.length} task`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
