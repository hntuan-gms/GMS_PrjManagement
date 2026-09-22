import { useMemo, useState } from "react";
import { api } from "../api";
import type { JiraUser, PlanResponse } from "../types";

interface Props {
  users: JiraUser[];
  onClose: () => void;
  /** Called after issues are created, so the workspace can reload from Jira. */
  onApplied: () => void | Promise<void>;
}

/** Today in the browser's own timezone — this is a date the user picks, not server math. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EXAMPLE =
  "Làm app thương mại điện tử bằng Flutter: giỏ hàng, thanh toán VNPay, đăng nhập OTP. " +
  "Backend dùng FastAPI + PostgreSQL. Cần cả kiểm thử và triển khai. Deadline 2 tháng.";

/**
 * Two steps, deliberately: describe, then review.
 *
 * The model's output never reaches Jira on its own — it lands in a staging table
 * and this screen is where a human edits durations, reassigns work and deletes
 * whatever it invented, before anything is created. "Duyệt & tạo" is the only
 * button that writes.
 */
export default function AiPlannerModal({ users, onClose, onApplied }: Props) {
  const [brief, setBrief] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState<"generating" | "applying" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: string[]; errors: Array<{ summary: string; message: string }> } | null>(
    null
  );

  const userNames = useMemo(() => new Map(users.map((u) => [u.accountId, u.displayName])), [users]);
  // Children are shown indented under their parent, so the WBS the model built is
  // legible at a glance rather than a flat list of forty rows.
  const depthOf = useMemo(() => {
    const byTempId = new Map((plan?.items ?? []).map((i) => [i.tempId, i]));
    const depth = new Map<string, number>();
    const walk = (tempId: string, guard = new Set<string>()): number => {
      if (depth.has(tempId)) return depth.get(tempId)!;
      const item = byTempId.get(tempId);
      if (!item?.parentTempId || guard.has(tempId)) return 0;
      guard.add(tempId);
      const d = walk(item.parentTempId, guard) + 1;
      depth.set(tempId, d);
      return d;
    };
    return (tempId: string) => walk(tempId);
  }, [plan]);

  async function generate() {
    setBusy("generating");
    setError(null);
    try {
      setPlan(await api.generatePlan(brief.trim(), startDate));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được kế hoạch.");
    } finally {
      setBusy(null);
    }
  }

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
      const res = await api.applyPlan(plan.run.id, startDate);
      setResult(res);
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không áp dụng được kế hoạch.");
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (plan) await api.discardPlan(plan.run.id).catch(() => {});
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Lập kế hoạch bằng AI</h2>
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
                  <strong>{result.errors.length} dòng lỗi</strong> (các dòng còn lại đã tạo xong, kế hoạch vẫn
                  giữ lại để bạn thử áp dụng tiếp):
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
          <div className="ai-compose">
            <label>
              Mô tả dự án
              <textarea
                rows={7}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={EXAMPLE}
                autoFocus
              />
            </label>
            <p className="ai-hint">
              Càng nêu rõ công nghệ, tính năng và deadline thì AI chia việc càng sát. Kế hoạch sinh ra sẽ
              hiện ở bước sau để bạn sửa — <strong>chưa</strong> có gì được ghi vào Jira.
            </p>
            <label className="ai-inline">
              Ngày bắt đầu dự án
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <div className="modal-footer">
              <button onClick={onClose}>Huỷ</button>
              <button className="primary" onClick={generate} disabled={brief.trim().length < 20 || busy !== null}>
                {busy === "generating" ? "Đang phân tích..." : "Tạo kế hoạch"}
              </button>
            </div>
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
                      <td style={{ paddingLeft: 8 + depthOf(item.tempId) * 18 }} title={item.rationale ?? ""}>
                        {item.summary}
                        {item.appliedIssueKey && <span className="ai-applied-key"> {item.appliedIssueKey}</span>}
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
                              .map((d) => `${d.type} ${plan.items.find((i) => i.tempId === d.tempId)?.summary ?? d.tempId}`)
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
              {plan.items.length} công việc · ngày giờ ở trên do hệ thống tự tính từ số ngày và quan hệ phụ
              thuộc (AI không tự đặt ngày), và sẽ tính lại mỗi khi bạn sửa số ngày.
              {plan.run.model && <> · mô hình: {plan.run.model}</>}
            </p>

            <div className="modal-footer">
              <button onClick={discard}>Bỏ kế hoạch</button>
              <button onClick={() => setPlan(null)} disabled={busy !== null}>
                Viết lại mô tả
              </button>
              <button className="primary" onClick={apply} disabled={busy !== null || plan.items.length === 0}>
                {busy === "applying" ? "Đang tạo task..." : `Duyệt & tạo ${plan.items.length} task`}
              </button>
            </div>
            <p className="ai-hint">
              Nhấn "Duyệt & tạo" sẽ tạo issue thật trong Jira — {userNames.size > 0 ? "kèm người phụ trách," : ""} kèm
              ngày và quan hệ phụ thuộc đã duyệt.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
