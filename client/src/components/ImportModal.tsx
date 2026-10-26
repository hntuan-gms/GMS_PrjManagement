import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  buildRows,
  CHUNK_SIZE,
  detectMapping,
  FIELD_LABELS,
  FIELD_ORDER,
  looksLikeHeader,
  parseTable,
  prepareChunk,
  type Blocked,
  type ImportField,
} from "../csvImport";
import type { Task } from "../types";

interface Props {
  tasks: Task[];
  onClose: () => void;
  /** Something was created — the workspace reloads its tasks. */
  onImported: () => Promise<void> | void;
}

interface Outcome {
  created: number;
  /** Rows Jira or the server refused, with the sheet's own row numbers. */
  errors: Array<{ row: number; summary: string; message: string }>;
  /** Rows never sent: a cell that could not be read, or a parent that was not created. */
  blocked: Blocked[];
  warnings: string[];
}

const PREVIEW_ROWS = 8;
const MAX_ROWS = 200;

/**
 * Import a sheet: paste cells copied from Excel (they arrive tab-separated) or open a
 * CSV saved from it. Columns are matched to fields by their headers and can be
 * changed, the first rows are shown as they will be created, and a row that cannot be
 * read is named — never quietly dropped or guessed at. A real .xlsx is not read; see
 * csvImport.ts for why.
 */
export default function ImportModal({ tasks, onClose, onImported }: Props) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Array<ImportField | null>>([]);
  const [typeNames, setTypeNames] = useState<string[]>([]);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listIssueTypes()
      .then((t) => setTypeNames(t.map((x) => x.name)))
      .catch(() => {});
  }, []);

  const table = useMemo(() => parseTable(text), [text]);
  const columns = table.reduce((n, r) => Math.max(n, r.length), 0);

  // A new sheet gets a fresh guess (header or not, and which column is what); after that
  // the user's own choices stand.
  useEffect(() => {
    if (table.length === 0) {
      setMapping([]);
      return;
    }
    const header = looksLikeHeader(table[0]);
    setHasHeader(header);
    setMapping(header ? detectMapping(table[0]) : table[0].map((_, i) => (i === 0 ? "summary" : null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const built = useMemo(
    () => (mapping.includes("summary") ? buildRows(table, mapping, hasHeader, typeNames) : []),
    [table, mapping, hasHeader, typeNames]
  );
  const bad = built.filter((b) => b.problems.length > 0);
  const tooMany = built.length > MAX_ROWS;
  const headers = hasHeader ? (table[0] ?? []) : [];

  function setField(col: number, field: ImportField | "") {
    setMapping((prev) => {
      const next = [...prev];
      while (next.length < columns) next.push(null);
      // A field belongs to one column: picking it here frees it from where it was.
      if (field) for (let i = 0; i < next.length; i++) if (next[i] === field) next[i] = null;
      next[col] = field || null;
      return next;
    });
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setOutcome(null);
    try {
      setText(await file.text());
      setFileName(file.name);
    } catch {
      setError(`Không đọc được tệp "${file.name}".`);
    }
  }

  async function run() {
    setRunning({ done: 0, total: built.length });
    setError(null);
    const out: Outcome = { created: 0, errors: [], blocked: [], warnings: [] };
    const keyOfRow = new Map<number, string>();
    try {
      for (let from = 0; from < built.length; from += CHUNK_SIZE) {
        const { send, sentRows, blocked } = prepareChunk(built, from, CHUNK_SIZE, keyOfRow);
        out.blocked.push(...blocked);
        if (send.length > 0) {
          const r = await api.importTasks(send);
          out.created += r.created.length;
          out.warnings.push(...r.warnings);
          for (const [local, key] of Object.entries(r.rowKeys)) keyOfRow.set(sentRows[Number(local) - 1], key);
          // The piece numbered its rows from 1; the sheet's numbers are what the person sees.
          out.errors.push(...r.errors.map((e) => ({ ...e, row: sentRows[e.row - 1] ?? e.row })));
        }
        setRunning({ done: Math.min(from + CHUNK_SIZE, built.length), total: built.length });
      }
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Nhập bị gián đoạn."} Các dòng đã tạo trước đó vẫn còn trên Jira.`);
    } finally {
      setRunning(null);
      setOutcome(out);
      if (out.created > 0) await onImported();
    }
  }

  const ok = built.length - bad.length;

  return (
    <div className="modal-overlay" onClick={running ? undefined : onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-id">Nhập công việc</span>
          <button className="modal-close" onClick={onClose} disabled={!!running}>
            ✕
          </button>
        </div>

        {outcome ? (
          <div className="import-result">
            <p>
              <b>Đã tạo {outcome.created} công việc</b> trên Jira
              {outcome.errors.length + outcome.blocked.length > 0 ? `, ${outcome.errors.length + outcome.blocked.length} dòng chưa nhập được:` : "."}
            </p>
            {outcome.errors.length + outcome.blocked.length > 0 && (
              <ul className="import-problems">
                {[...outcome.blocked, ...outcome.errors]
                  .sort((a, b) => a.row - b.row)
                  .map((p, i) => (
                    <li key={i}>
                      <b>Dòng {p.row}</b>
                      {p.summary ? ` · ${p.summary.slice(0, 50)}` : ""} — {p.message}
                    </li>
                  ))}
              </ul>
            )}
            {outcome.warnings.length > 0 && <p className="field-note">{outcome.warnings.join(" ")}</p>}
            {error && <div className="modal-error">{error}</div>}
            <div className="modal-footer">
              <div className="spacer" />
              <button className="primary" onClick={onClose}>
                Đóng
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <span>Dán từ Excel, hoặc mở tệp CSV</span>
              <textarea
                rows={5}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName(null);
                }}
                placeholder={"Tên\tLoại\tNgười phụ trách\tBắt đầu\tSố ngày\tViệc cha\nGiai đoạn 1\tEpic\nKhảo sát\tStory\tLan\t05/11/2026\t3\t1"}
                spellCheck={false}
              />
              <div className="import-file">
                <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => void openFile(e.target.files?.[0])} />
                {fileName && <small>Đã đọc: {fileName}</small>}
              </div>
              <small className="field-note">
                Tệp Excel (.xlsx) chưa đọc trực tiếp: hãy chọn “Lưu thành CSV UTF-8”, hoặc bôi đen các ô rồi dán vào ô trên. “Việc cha” có thể là mã
                (ABC-12) hoặc số dòng trong bảng (ví dụ 1 = dòng đầu tiên), nên một bảng có thể mô tả cả cây công việc.
              </small>
            </div>

            {table.length > 0 && (
              <>
                <label className="field-check">
                  <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> Dòng đầu là tiêu đề cột
                </label>

                <div className="import-map">
                  {Array.from({ length: columns }, (_, i) => (
                    <label key={i} className="field">
                      <span>{headers[i] || `Cột ${i + 1}`}</span>
                      <select value={mapping[i] ?? ""} onChange={(e) => setField(i, e.target.value as ImportField | "")}>
                        <option value="">— Bỏ qua —</option>
                        {FIELD_ORDER.map((f) => (
                          <option key={f} value={f}>
                            {FIELD_LABELS[f]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                {!mapping.includes("summary") ? (
                  <div className="modal-error">Chọn cột nào là “Tên công việc”.</div>
                ) : (
                  <>
                    <div className="import-preview">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Tên</th>
                            <th>Loại</th>
                            <th>Người</th>
                            <th>Bắt đầu</th>
                            <th>Ngày</th>
                            <th>Cha</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {built.slice(0, PREVIEW_ROWS).map((b) => (
                            <tr key={b.row} className={b.problems.length > 0 ? "is-bad" : ""}>
                              <td>{b.row}</td>
                              <td>{b.value.summary || "—"}</td>
                              <td>{b.value.issueType ?? "Task"}</td>
                              <td>{b.value.assignee ?? "—"}</td>
                              <td>{b.value.startDate ?? "—"}</td>
                              <td>{b.value.durationDays ?? "—"}</td>
                              <td>{b.value.parent ?? "—"}</td>
                              <td className="import-why">{b.problems[0] ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {built.length > PREVIEW_ROWS && <small>… và {built.length - PREVIEW_ROWS} dòng nữa.</small>}
                    </div>
                    <p className="field-note">
                      {built.length} dòng · {ok} sẽ được tạo
                      {bad.length > 0 ? ` · ${bad.length} dòng có lỗi sẽ bị bỏ qua (và các việc con của chúng)` : ""}.
                      {tooMany ? ` Tối đa ${MAX_ROWS} dòng mỗi lần — hãy chia nhỏ.` : ""} Mã dự án: {tasks[0]?.id.split("-")[0] ?? "—"}.
                    </p>
                  </>
                )}
              </>
            )}

            {running && (
              <div className="field-note" role="status">
                Đang nhập {running.done}/{running.total}… (đừng đóng cửa sổ này)
              </div>
            )}
            {error && <div className="modal-error">{error}</div>}

            <div className="modal-footer">
              <div className="spacer" />
              <button onClick={onClose} disabled={!!running}>
                Huỷ
              </button>
              <button className="primary" onClick={run} disabled={!!running || ok === 0 || tooMany || !mapping.includes("summary")}>
                {running ? "Đang nhập…" : `Nhập ${ok} công việc`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
