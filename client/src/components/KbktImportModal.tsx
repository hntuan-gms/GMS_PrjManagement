import { useEffect, useMemo, useRef, useState } from "react";
import { api, kbktApply } from "../api";
import { nextWeekSunday, storyKeyFromFileName, storyParam, supersededBy } from "../kbktFiles";
import { todayIso } from "../resourceAllocation";
import type {
  KbktAction,
  KbktKind,
  KbktLogLine,
  KbktOptions,
  KbktPreview,
  KbktResult,
  KbktRunParams,
  KbktSettings,
} from "../types";

interface Props {
  projectKey: string;
  onClose: () => void;
  /** After a run wrote to Jira, so the workspace reloads its tasks. */
  onApplied: () => void | Promise<void>;
}

/**
 * Import KBKT test-case workbooks into Jira — the site's jira_sync.py.
 *
 * Two steps, like running the script without and then with --apply: "Xem
 * trước" asks the server what it would do (nothing is written), "Áp dụng"
 * does it, streaming each Jira write as it happens. Changing anything that
 * shapes the run (a Story, the Epic, the due date, the project settings)
 * throws the preview away, so what is applied is always what was last shown.
 */

interface Entry {
  id: string;
  file: File;
  /** Story key in the file name, when it belongs to this project. */
  fromName: string | null;
  /** Story key in the file name that belongs to another project. */
  foreignKey: string | null;
  story: string;
  preview?: KbktPreview;
  previewError?: string;
  log?: KbktLogLine[];
  result?: KbktResult;
  applyError?: string;
}

const ACTION_LABEL: Record<KbktAction, string> = {
  CREATE: "Tạo mới",
  UPDATE: "Cập nhật",
  MOVE: "Chuyển trạng thái",
  "NO-MOVE": "Không chuyển được",
  LINK: "Liên kết",
  ATTACH: "Đính kèm",
  SKIP: "Bỏ qua",
  WARN: "Cảnh báo",
  ERROR: "Lỗi",
  INFO: "Thông tin",
};
const CHIP_ORDER: KbktAction[] = ["CREATE", "UPDATE", "MOVE", "LINK", "ATTACH", "SKIP", "NO-MOVE", "WARN", "ERROR"];

let nextId = 0;

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Actions that write to Jira; warnings and skips are reports, not changes. */
const WRITE_ACTIONS: KbktAction[] = ["CREATE", "UPDATE", "MOVE", "LINK", "ATTACH"];
const writeCount = (stats: Partial<Record<KbktAction, number>>) => WRITE_ACTIONS.reduce((n, a) => n + (stats[a] ?? 0), 0);

function Chips({ stats }: { stats: Partial<Record<KbktAction, number>> }) {
  const shown = CHIP_ORDER.filter((a) => stats[a]);
  return (
    <div className="kb-chips">
      {writeCount(stats) === 0 && <span className="kb-muted">Không có gì cần ghi lên Jira.</span>}
      {shown.map((a) => (
        <span key={a} className={`kb-chip kb-chip-${a.toLowerCase()}`}>
          {ACTION_LABEL[a]} <strong>{stats[a]}</strong>
        </span>
      ))}
    </div>
  );
}

function LogList({ lines }: { lines: KbktLogLine[] }) {
  return (
    <ol className="kb-log">
      {lines.map((l, i) => (
        <li key={i} className={`kb-log-${l.action.toLowerCase()}`}>
          <span className="kb-log-action">{ACTION_LABEL[l.action]}</span>
          <span>{l.message}</span>
        </li>
      ))}
    </ol>
  );
}

export default function KbktImportModal({ projectKey, onClose, onApplied }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [epic, setEpic] = useState("");
  const [dueDate, setDueDate] = useState(() => nextWeekSunday(todayIso()));
  const [force, setForce] = useState(false);
  const [phase, setPhase] = useState<"idle" | "previewing" | "applying">("idle");
  const [options, setOptions] = useState<KbktOptions | null>(null);
  const [settings, setSettings] = useState<KbktSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getKbktOptions(), api.getKbktSettings()])
      .then(([o, s]) => {
        if (cancelled) return;
        setOptions(o);
        setSettings(s);
      })
      .catch((e) => !cancelled && setLoadError(errorText(e, "Không tải được cấu hình nhập KBKT.")));
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = phase !== "idle";
  const close = () => {
    if (phase === "applying" && !window.confirm("Đang ghi lên Jira. Dừng lại và đóng?")) return;
    abortRef.current?.abort();
    onClose();
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "applying") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, onClose]);

  /** A new preview is needed: something that shapes the run changed. */
  function invalidate(list = entries): Entry[] {
    return list.map(({ preview: _p, previewError: _e, log: _l, result: _r, applyError: _a, ...rest }) => rest);
  }

  function addFiles(files: FileList | File[]) {
    const added: Entry[] = [];
    for (const file of Array.from(files)) {
      if (!/\.xlsx$/i.test(file.name) || file.name.startsWith("~$")) continue;
      if (entries.some((e) => e.file.name === file.name) || added.some((e) => e.file.name === file.name)) continue;
      const key = storyKeyFromFileName(file.name);
      const own = key && key.startsWith(`${projectKey}-`) ? key : null;
      added.push({ id: String(nextId++), file, fromName: own, foreignKey: key && !own ? key : null, story: own ?? "" });
    }
    if (added.length) setEntries([...invalidate(), ...added]);
  }

  const superseded = useMemo(
    () =>
      supersededBy(
        entries.map((e) => ({ id: e.id, name: e.file.name, code: e.preview?.code ?? null, lastModified: e.file.lastModified }))
      ),
    [entries]
  );

  const params = (e: Entry): KbktRunParams => ({
    epic: epic || undefined,
    story: storyParam(e.story, e.fromName),
    dueDate: dueDate || undefined,
    force,
  });

  async function previewAll() {
    setPhase("previewing");
    let list = invalidate();
    setEntries(list);
    for (const e of list) {
      let patch: Partial<Entry>;
      try {
        patch = { preview: await api.previewKbkt(e.file, params(e)) };
      } catch (err) {
        patch = { previewError: errorText(err, "Không xem trước được file này.") };
      }
      list = list.map((x) => (x.id === e.id ? { ...x, ...patch } : x));
      setEntries(list);
    }
    setPhase("idle");
  }

  /** A file the apply will run: previewed, not superseded, not stopped by an error, and with something to write. */
  const runnable = (e: Entry) =>
    !!e.preview && e.preview.storyKey !== null && !superseded.has(e.id) && !e.result && writeCount(e.preview.stats) > 0;
  const previewed = entries.length > 0 && entries.every((e) => e.preview || e.previewError);
  const toApply = entries.filter(runnable);

  async function applyAll() {
    const targets = entries.filter(runnable);
    if (targets.length === 0) return;
    const creates = targets.reduce((n, e) => n + (e.preview!.stats.CREATE ?? 0), 0);
    if (!window.confirm(`Ghi ${targets.length} file lên Jira dự án ${projectKey}${creates ? ` (tạo ${creates} issue)` : ""}?`)) return;
    setPhase("applying");
    const abort = new AbortController();
    abortRef.current = abort;
    let wrote = false;
    let list = entries;
    const patch = (id: string, fn: (e: Entry) => Entry) => {
      list = list.map((x) => (x.id === id ? fn(x) : x));
      setEntries(list);
    };
    try {
      for (const e of targets) {
        patch(e.id, (x) => ({ ...x, log: [], applyError: undefined }));
        try {
          for await (const ev of kbktApply(e.file, params(e), abort.signal)) {
            if (ev.type === "log") {
              if (["CREATE", "UPDATE", "MOVE", "LINK", "ATTACH"].includes(ev.action)) wrote = true;
              patch(e.id, (x) => ({ ...x, log: [...(x.log ?? []), { action: ev.action, message: ev.message }] }));
            } else if (ev.type === "done") {
              const { type: _t, ...result } = ev;
              patch(e.id, (x) => ({ ...x, result }));
            } else if (ev.type === "error") {
              patch(e.id, (x) => ({ ...x, applyError: ev.message }));
            }
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            patch(e.id, (x) => ({ ...x, applyError: "Đã dừng. Phần đã ghi vẫn giữ — áp dụng lại cùng file sẽ làm tiếp phần còn lại." }));
            break;
          }
          patch(e.id, (x) => ({ ...x, applyError: errorText(err, "Không ghi được lên Jira.") }));
        }
      }
    } finally {
      abortRef.current = null;
      setPhase("idle");
      if (wrote) await onApplied();
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && close()}>
      <div className="modal kb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <h2 className="modal-id">Nhập kịch bản kiểm thử (KBKT)</h2>
            <p className="modal-subtitle">
              Mỗi file tạo/cập nhật một Story, một sub-task cho mỗi test case và một sub-task cho mỗi lỗi trong dự án{" "}
              {projectKey}. Nhập lại cùng file chỉ cập nhật phần thay đổi.
            </p>
          </div>
          <button className="modal-close" onClick={close} aria-label="Đóng">
            ✕
          </button>
        </div>

        {loadError && <div className="modal-error">{loadError}</div>}

        <div
          className={`kb-drop${dragging ? " kb-drop-active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) addFiles(e.dataTransfer.files);
          }}
        >
          <span>Kéo thả file .xlsx vào đây, hoặc</span>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            Chọn file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="kb-params">
          <label className="field">
            <span>Epic cho Story mới</span>
            <select
              value={epic}
              disabled={busy}
              onChange={(e) => {
                setEpic(e.target.value);
                setEntries(invalidate());
              }}
            >
              <option value="">— Giữ Epic của lần nhập trước / của Story có sẵn —</option>
              {options?.epics.map((ep) => (
                <option key={ep.key} value={ep.key}>
                  {ep.key} — {ep.summary}
                </option>
              ))}
            </select>
          </label>
          <label className="field kb-field-narrow">
            <span>Hạn hoàn thành (issue mới)</span>
            <input
              type="date"
              value={dueDate}
              disabled={busy}
              onChange={(e) => {
                setDueDate(e.target.value);
                setEntries(invalidate());
              }}
            />
          </label>
        </div>
        <label className="kb-check">
          <input
            type="checkbox"
            checked={force}
            disabled={busy}
            onChange={(e) => {
              setForce(e.target.checked);
              setEntries(invalidate());
            }}
          />
          Bỏ qua kiểm tra lệch dòng (khi nhiều test case đổi tên vì đã chèn/xoá dòng trong file)
        </label>

        {entries.length > 0 && (
          <div className="kb-files">
            {entries.map((e) => {
              const winner = superseded.get(e.id);
              const errors = e.preview?.log.filter((l) => l.action === "ERROR") ?? [];
              const warns = e.preview?.log.filter((l) => l.action === "WARN" || l.action === "SKIP") ?? [];
              return (
                <div key={e.id} className="kb-file">
                  <div className="kb-file-head">
                    <div className="kb-file-name">
                      <strong>{e.file.name}</strong>
                      {e.preview && (
                        <span className="kb-muted">
                          {e.preview.code} · {e.preview.cases} test case · {e.preview.bugs} lỗi
                        </span>
                      )}
                    </div>
                    <button
                      className="link-btn"
                      disabled={busy}
                      onClick={() => setEntries(invalidate(entries.filter((x) => x.id !== e.id)))}
                    >
                      Bỏ
                    </button>
                  </div>

                  <label className="kb-story">
                    <span>Story chứa test case</span>
                    <input
                      value={e.story}
                      disabled={busy}
                      placeholder="Để trống = tạo Story mới trong Epic đã chọn"
                      onChange={(ev) => {
                        const story = ev.target.value;
                        setEntries(invalidate(entries.map((x) => (x.id === e.id ? { ...x, story } : x))));
                      }}
                    />
                  </label>
                  {e.foreignKey && !e.story && (
                    <p className="kb-muted">
                      Tên file trỏ tới {e.foreignKey}, thuộc dự án khác — sẽ tạo Story mới trong {projectKey}. Muốn dùng{" "}
                      {e.foreignKey} thì chuyển sang dự án đó rồi nhập lại.
                    </p>
                  )}

                  {e.previewError && <div className="modal-error">{e.previewError}</div>}
                  {winner && (
                    <div className="notice notice-warn">
                      Bản cũ của {e.preview?.code} — bỏ qua, dùng {winner}.
                    </div>
                  )}

                  {e.preview && !winner && !e.log && (
                    <>
                      <Chips stats={e.preview.stats} />
                      {errors.length > 0 && (
                        <div className="modal-error">
                          {errors.map((l, i) => (
                            <div key={i}>{l.message}</div>
                          ))}
                        </div>
                      )}
                      {warns.length > 0 && (
                        <div className="notice notice-warn">
                          <ul>
                            {warns.map((l, i) => (
                              <li key={i}>{l.message}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <details className="kb-details">
                        <summary>Chi tiết ({e.preview.log.length} dòng)</summary>
                        <LogList lines={e.preview.log} />
                      </details>
                    </>
                  )}

                  {e.log && (
                    <>
                      {e.result ? (
                        <div className={`notice ${e.result.storyKey ? "kb-notice-ok" : "notice-error"}`}>
                          {e.result.storyKey ? `Xong — Story ${e.result.storyKey}.` : "Dừng vì lỗi, xem chi tiết."}
                        </div>
                      ) : (
                        !e.applyError && <p className="kb-muted">Đang ghi lên Jira… ({e.log.length})</p>
                      )}
                      {e.result && <Chips stats={e.result.stats} />}
                      {e.result?.noTransition.map((n, i) => (
                        <div key={i} className="notice notice-warn">
                          {n.count} issue không chuyển được "{n.from}" → "{n.to}": cần thêm trạng thái / bước chuyển đó vào
                          workflow của dự án (nhãn result-* vẫn đánh dấu kết quả).
                        </div>
                      ))}
                      {e.applyError && <div className="modal-error">{e.applyError}</div>}
                      <details className="kb-details" open={!e.result}>
                        <summary>Nhật ký ({e.log.length} dòng)</summary>
                        <LogList lines={e.log} />
                      </details>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <details className="kb-settings" open={showSettings} onToggle={(e) => setShowSettings(e.currentTarget.open)}>
          <summary>Cấu hình dự án (dùng chung cho cả nhóm)</summary>
          {settings && options ? (
            <SettingsForm
              initial={settings}
              options={options}
              disabled={busy}
              onSaved={(s) => {
                setSettings(s);
                setEntries(invalidate());
              }}
            />
          ) : (
            !loadError && <p className="kb-muted">Đang tải…</p>
          )}
        </details>

        <div className="modal-footer">
          <span className="footer-summary">
            {previewed && toApply.length > 0
              ? `${toApply.length} file sẵn sàng ghi lên Jira.`
              : entries.length > 0 && !previewed
                ? "Bấm Xem trước để biết sẽ thay đổi gì."
                : previewed && phase === "idle" && entries.some((e) => e.preview && !e.result)
                  ? "Không có file nào cần ghi lên Jira."
                  : ""}
          </span>
          <span className="spacer" />
          {phase === "applying" ? (
            <button onClick={() => abortRef.current?.abort()}>Dừng</button>
          ) : (
            <button onClick={close}>Đóng</button>
          )}
          <button onClick={previewAll} disabled={busy || entries.length === 0}>
            {phase === "previewing" ? "Đang xem trước…" : "Xem trước"}
          </button>
          <button className="primary" onClick={applyAll} disabled={busy || !previewed || toApply.length === 0}>
            {phase === "applying" ? "Đang ghi…" : "Áp dụng lên Jira"}
          </button>
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<KbktKind, string> = { story: "Story", test: "Test case", bug: "Lỗi" };

/** Names offered for a select: the project's, plus the current value if the project lacks it (so it shows, flagged). */
function choices(available: string[], current: string): Array<{ value: string; label: string }> {
  const list = available.map((v) => ({ value: v, label: v }));
  if (current && !available.includes(current)) list.unshift({ value: current, label: `${current} (không có trong dự án)` });
  return list;
}

function SettingsForm({
  initial,
  options,
  disabled,
  onSaved,
}: {
  initial: KbktSettings;
  options: KbktOptions;
  disabled: boolean;
  onSaved: (s: KbktSettings) => void;
}) {
  const [draft, setDraft] = useState<KbktSettings>(initial);
  const [rows, setRows] = useState(() => Object.entries(initial.priority));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const standard = options.issueTypes.filter((t) => !t.subtask).map((t) => t.name);
  const subtasks = options.issueTypes.filter((t) => t.subtask).map((t) => t.name);
  const allStatuses = [...new Set(Object.values(options.statuses).flat())];
  const statusesOf = (type: string) => options.statuses[type] ?? allStatuses;

  const set = (fn: (d: KbktSettings) => KbktSettings) => {
    setDraft(fn);
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const priority = Object.fromEntries(rows.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v]));
      const result = await api.saveKbktSettings({ ...draft, priority });
      setSaved(true);
      onSaved(result);
    } catch (e) {
      setError(errorText(e, "Không lưu được cấu hình."));
    } finally {
      setSaving(false);
    }
  }

  const select = (value: string, list: Array<{ value: string; label: string }>, onChange: (v: string) => void) => (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {list.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );

  const statusFields: Array<[keyof KbktSettings["status"], string, string]> = [
    ["pass", "Đạt (P)", draft.issueTypes.test],
    ["fail", "Không đạt (F)", draft.issueTypes.test],
    ["pending", "Đang xem xét (PE)", draft.issueTypes.test],
    ["notrun", "Chưa thực hiện", draft.issueTypes.test],
    ["bugOpen", "Lỗi đang mở", draft.issueTypes.bug],
    ["bugClosed", "Lỗi đã đóng", draft.issueTypes.bug],
  ];

  return (
    <div className="kb-settings-body">
      {error && <div className="modal-error">{error}</div>}
      <h4>Loại issue</h4>
      <div className="kb-grid">
        <label className="field">
          <span>Story</span>
          {select(draft.issueTypes.story, choices(standard, draft.issueTypes.story), (v) =>
            set((d) => ({ ...d, issueTypes: { ...d.issueTypes, story: v } }))
          )}
        </label>
        <label className="field">
          <span>Test case (sub-task)</span>
          {select(draft.issueTypes.test, choices(subtasks, draft.issueTypes.test), (v) =>
            set((d) => ({ ...d, issueTypes: { ...d.issueTypes, test: v } }))
          )}
        </label>
        <label className="field">
          <span>Lỗi (sub-task)</span>
          {select(draft.issueTypes.bug, choices(subtasks, draft.issueTypes.bug), (v) =>
            set((d) => ({ ...d, issueTypes: { ...d.issueTypes, bug: v } }))
          )}
        </label>
      </div>

      <h4>Trạng thái</h4>
      <div className="kb-grid">
        {statusFields.map(([k, labelText, type]) => (
          <label key={k} className="field">
            <span>{labelText}</span>
            {select(draft.status[k], choices(statusesOf(type), draft.status[k]), (v) =>
              set((d) => ({ ...d, status: { ...d.status, [k]: v } }))
            )}
          </label>
        ))}
      </div>

      <h4>Mức độ lỗi → Ưu tiên</h4>
      <div className="kb-priority">
        {rows.map(([sev, prio], i) => (
          <div key={i} className="kb-priority-row">
            <input
              value={sev}
              disabled={disabled}
              placeholder="Mức độ trong file (vd. Cao)"
              aria-label="Mức độ"
              onChange={(e) => {
                setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)));
                setSaved(false);
              }}
            />
            <span aria-hidden="true">→</span>
            {select(prio, choices(options.priorities, prio), (v) => {
              setRows(rows.map((r, j) => (j === i ? [r[0], v] : r)));
              setSaved(false);
            })}
            <button
              className="link-btn"
              disabled={disabled}
              onClick={() => {
                setRows(rows.filter((_, j) => j !== i));
                setSaved(false);
              }}
            >
              Xoá
            </button>
          </div>
        ))}
        <button
          className="link-btn"
          disabled={disabled}
          onClick={() => {
            setRows([...rows, ["", options.priorities[0] ?? ""]]);
            setSaved(false);
          }}
        >
          + Thêm mức độ
        </button>
      </div>

      <div className="kb-grid">
        <label className="field">
          <span>Kiểu liên kết test case ↔ lỗi</span>
          {select(draft.linkType, choices(options.linkTypes, draft.linkType), (v) => set((d) => ({ ...d, linkType: v })))}
        </label>
        <div className="field">
          <span>Đặt hạn hoàn thành cho issue mới</span>
          <div className="kb-inline-checks">
            {(Object.keys(KIND_LABEL) as KbktKind[]).map((k) => (
              <label key={k} className="kb-check">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={draft.dueDateOn.includes(k)}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      dueDateOn: e.target.checked ? [...d.dueDateOn, k] : d.dueDateOn.filter((x) => x !== k),
                    }))
                  }
                />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="kb-settings-actions">
        <button className="primary" onClick={save} disabled={disabled || saving}>
          {saving ? "Đang lưu…" : "Lưu cấu hình"}
        </button>
        {saved && <span className="kb-muted">Đã lưu. Bấm Xem trước lại để áp dụng.</span>}
      </div>
    </div>
  );
}
