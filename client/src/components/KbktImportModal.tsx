import { useEffect, useMemo, useRef, useState } from "react";
import { api, kbktApply } from "../api";
import { nextWeekSunday, storyKeyFromFileName, supersededBy } from "../kbktFiles";
import { todayIso } from "../resourceAllocation";
import { useDialogs } from "./dialogContext";
import DateField from "./DateField";
import { SettingsForm } from "./KbktSettings";
import type {
  KbktAction,
  KbktLogLine,
  KbktOptions,
  KbktPreview,
  KbktResult,
  KbktRunParams,
  KbktSettings,
  KbktStory,
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
  /**
   * Where the test cases go. "existing": under `story`, a Story already in Jira —
   * it is never moved or renamed. "own": under the file's own Story, created in
   * the chosen Epic on the first import and found again by label afterwards.
   */
  mode: "existing" | "own";
  story: KbktStory | null;
  /** The file name's key is being looked up in Jira. */
  checking?: boolean;
  /** Why the dialog picked the mode it did, when that isn't obvious. */
  note?: string;
  /** Story key in the file name that belongs to another project. */
  foreignKey: string | null;
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
  const dialogs = useDialogs();
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
  const close = async () => {
    if (phase === "applying" && !(await dialogs.confirm({ message: "Đang ghi lên Jira. Dừng lại và đóng?", confirmLabel: "Dừng và đóng", cancelLabel: "Tiếp tục ghi" }))) return;
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

  function patchEntry(id: string, fn: (e: Entry) => Entry) {
    // Functional: lookups resolve after other edits, and must not undo them.
    setEntries((list) => list.map((x) => (x.id === id ? fn(x) : x)));
  }

  function addFiles(files: FileList | File[]) {
    const added: Entry[] = [];
    for (const file of Array.from(files)) {
      if (!/\.xlsx$/i.test(file.name) || file.name.startsWith("~$")) continue;
      if (entries.some((e) => e.file.name === file.name) || added.some((e) => e.file.name === file.name)) continue;
      const key = storyKeyFromFileName(file.name);
      const ownProject = !!key && key.startsWith(`${projectKey}-`);
      added.push({
        id: String(nextId++),
        file,
        mode: ownProject ? "existing" : "own",
        story: ownProject ? { key: key!, summary: "", type: "", status: "" } : null,
        checking: ownProject,
        foreignKey: key && !ownProject ? key : null,
      });
    }
    if (!added.length) return;
    setEntries([...invalidate(), ...added]);
    // "AI-33_….xlsx" names its Story; confirm it exists (and is Story level)
    // before offering it, so a typo'd or deleted key falls back visibly.
    for (const e of added) {
      if (!e.checking || !e.story) continue;
      const key = e.story.key;
      api
        .searchKbktStories(key)
        .then((hits) => hits.find((h) => h.key === key) ?? null)
        .catch(() => null)
        .then((hit) =>
          patchEntry(e.id, (x) =>
            !x.checking
              ? x
              : hit
                ? { ...x, checking: false, story: hit }
                : {
                    ...x,
                    checking: false,
                    mode: "own",
                    story: null,
                    note: `Tên file trỏ tới ${key} nhưng ${key} không có trong dự án hoặc không phải Story. Dùng Story riêng của file.`,
                  }
          )
        );
    }
  }

  function setTarget(id: string, patch: Partial<Entry>) {
    setEntries(invalidate(entries.map((x) => (x.id === id ? { ...x, checking: false, note: undefined, ...patch } : x))));
  }

  const superseded = useMemo(
    () =>
      supersededBy(
        entries.map((e) => ({ id: e.id, name: e.file.name, code: e.preview?.code ?? null, lastModified: e.file.lastModified }))
      ),
    [entries]
  );

  // The Epic goes only with a file's own Story. Sent with an existing Story, the
  // server would move that Story into the Epic — not what "put these test cases
  // under AI-33" means.
  const params = (e: Entry): KbktRunParams =>
    e.mode === "existing"
      ? { story: e.story?.key, dueDate: dueDate || undefined, force }
      : { story: "new", epic: epic || undefined, dueDate: dueDate || undefined, force };

  async function previewAll() {
    setPhase("previewing");
    let list = invalidate();
    setEntries(list);
    for (const e of list) {
      let patch: Partial<Entry>;
      if (e.mode === "existing" && !e.story) {
        patch = { previewError: "Chưa chọn Story có sẵn cho file này." };
      } else {
        try {
          patch = { preview: await api.previewKbkt(e.file, params(e)) };
        } catch (err) {
          patch = { previewError: errorText(err, "Không xem trước được file này.") };
        }
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
    const proceed = await dialogs.confirm({
      title: "Ghi lên Jira",
      message: `Ghi ${targets.length} file lên Jira dự án ${projectKey}${creates ? ` (tạo ${creates} issue)` : ""}?`,
      confirmLabel: "Ghi lên Jira",
    });
    if (!proceed) return;
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
            patch(e.id, (x) => ({ ...x, applyError: "Đã dừng. Áp dụng lại cùng file để làm tiếp." }));
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
            <span>Epic cho Story riêng của file</span>
            <select
              value={epic}
              // Only a file's own Story goes into the Epic; an existing Story stays put.
              disabled={busy || (entries.length > 0 && entries.every((x) => x.mode === "existing"))}
              onChange={(e) => {
                setEpic(e.target.value);
                setEntries(invalidate());
              }}
            >
              <option value="">Giữ Epic lần trước</option>
              {options?.epics.map((ep) => (
                <option key={ep.key} value={ep.key}>
                  {ep.key} · {ep.summary}
                </option>
              ))}
            </select>
          </label>
          <label className="field kb-field-narrow">
            <span>Hạn hoàn thành (issue mới)</span>
            <DateField
              value={dueDate}
              ariaLabel="Hạn hoàn thành"
              disabled={busy}
              onChange={(iso) => {
                setDueDate(iso);
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

                  <div className="kb-target" role="radiogroup" aria-label="Đưa test case và lỗi vào">
                    <span className="kb-target-label">Đưa test case và lỗi vào</span>
                    <label className="kb-check">
                      <input
                        type="radio"
                        name={`kb-target-${e.id}`}
                        checked={e.mode === "existing"}
                        disabled={busy}
                        onChange={() => setTarget(e.id, { mode: "existing" })}
                      />
                      Story có sẵn
                    </label>
                    <label className="kb-check">
                      <input
                        type="radio"
                        name={`kb-target-${e.id}`}
                        checked={e.mode === "own"}
                        disabled={busy}
                        onChange={() => setTarget(e.id, { mode: "own" })}
                      />
                      Story riêng của file (tạo lần đầu trong Epic ở trên, các lần sau dùng lại)
                    </label>
                  </div>
                  {e.mode === "existing" &&
                    (e.checking ? (
                      <p className="kb-muted">Đang kiểm tra {e.story?.key} trên Jira…</p>
                    ) : (
                      <StoryPicker
                        value={e.story}
                        disabled={busy}
                        onPick={(story) => setTarget(e.id, { story })}
                      />
                    ))}
                  {e.note && <p className="kb-muted">{e.note}</p>}
                  {e.foreignKey && e.mode === "own" && (
                    <p className="kb-muted">
                      Tên file trỏ tới {e.foreignKey}, thuộc dự án khác. Sẽ tạo Story mới trong {projectKey}. Muốn dùng{" "}
                      {e.foreignKey} thì chuyển sang dự án đó rồi nhập lại.
                    </p>
                  )}

                  {e.previewError && <div className="modal-error">{e.previewError}</div>}
                  {winner && (
                    <div className="notice notice-warn">
                      Bản cũ của {e.preview?.code}, dùng {winner}.
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
                          {e.result.storyKey ? `Xong: ${e.result.storyKey}` : "Dừng vì lỗi, xem chi tiết."}
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
          <button onClick={previewAll} disabled={busy || entries.length === 0 || entries.some((x) => x.checking)}>
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

/**
 * Pick the Story the test cases go under, by key ("AI-33", "33") or by words of
 * its title. Searched on the server as you type: a project can hold thousands
 * of Stories, so they are never all loaded. Empty box → the recently touched ones.
 */
function StoryPicker({
  value,
  disabled,
  onPick,
}: {
  value: KbktStory | null;
  disabled: boolean;
  onPick: (story: KbktStory | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KbktStory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searching = !value;

  useEffect(() => {
    if (!searching) return;
    let stale = false;
    const timer = setTimeout(() => {
      setHits(null);
      setError(null);
      api
        .searchKbktStories(query.trim())
        .then((h) => !stale && setHits(h))
        .catch((e) => !stale && setError(errorText(e, "Không tìm được Story.")));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, searching]);

  if (value) {
    return (
      <div className="kb-picked">
        <span>
          <strong>{value.key}</strong> · {value.summary || "(không có tên)"}
          {value.type && (
            <span className="kb-muted">
              {" "}
              · {value.type}
              {value.status && ` · ${value.status}`}
            </span>
          )}
        </span>
        <button className="link-btn" disabled={disabled} onClick={() => onPick(null)}>
          Đổi
        </button>
      </div>
    );
  }

  return (
    <div className="kb-picker">
      <input
        value={query}
        disabled={disabled}
        placeholder="Tìm Story theo mã (vd. 33) hoặc tên"
        aria-label="Tìm Story có sẵn"
        onChange={(e) => setQuery(e.target.value)}
      />
      {error ? (
        <div className="modal-error">{error}</div>
      ) : hits === null ? (
        <p className="kb-muted">Đang tìm…</p>
      ) : hits.length === 0 ? (
        <p className="kb-muted">Không có Story nào khớp trong dự án này.</p>
      ) : (
        <ul className="kb-picker-list" role="listbox" aria-label="Story trong dự án">
          {hits.map((h) => (
            <li key={h.key}>
              <button type="button" role="option" aria-selected={false} disabled={disabled} onClick={() => onPick(h)}>
                <strong>{h.key}</strong> {h.summary}
                <span className="kb-muted">
                  {" "}
                  · {h.type} · {h.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
