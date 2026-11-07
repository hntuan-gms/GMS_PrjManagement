import { useEffect, useState } from "react";
import { api } from "../api";
import type { KbktKind, KbktMappedKind, KbktOptions, KbktSettings } from "../types";

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The per-project settings of the KBKT import (issue type names, statuses, Jira field map, severity → priority).
 * `SettingsForm` is the body, shared by the import dialog (inside its `.kb-settings` details) and by the
 * "Nhập KBKT" section of the project settings page (`KbktSettingsSection`, which loads what the form needs).
 */

const KIND_LABEL: Record<KbktKind, string> = { story: "Story", test: "Test case", bug: "Lỗi" };

/** Names offered for a select: the project's, plus the current value if the project lacks it (so it shows, flagged). */
function choices(available: string[], current: string): Array<{ value: string; label: string }> {
  const list = available.map((v) => ({ value: v, label: v }));
  if (current && !available.includes(current)) list.unshift({ value: current, label: `${current} (không có trong dự án)` });
  return list;
}

export function SettingsForm({
  initial,
  options,
  disabled,
  onSaved,
  embedded = false,
  onDirtyChange,
}: {
  initial: KbktSettings;
  options: KbktOptions;
  disabled: boolean;
  onSaved: (s: KbktSettings) => void;
  /** On the settings page: Save is at the foot of the section and enabled only when something changed, with a Huỷ that resets. */
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<KbktSettings>(initial);
  const [rows, setRows] = useState(() => Object.entries(initial.priority));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // What was last saved (or loaded), to know whether the form changed.
  const snap = (d: KbktSettings, r: Array<[string, string]>) => JSON.stringify({ d: { ...d, priority: null }, r });
  const [base, setBase] = useState(() => snap(initial, Object.entries(initial.priority)));
  const dirty = snap(draft, rows) !== base;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const reset = () => {
    setDraft(initial);
    setRows(Object.entries(initial.priority));
    setSaved(false);
    setError(null);
  };

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
      setBase(snap(draft, rows));
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

  // The project spells an issue type its own way ("Sub-Bug"); settings may say "Sub Bug".
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const typeKey = (name: string) => Object.keys(options.fields).find((k) => fold(k) === fold(name));
  const fieldsOf = (kind: KbktMappedKind) => {
    const key = typeKey(draft.issueTypes[kind]);
    return key ? options.fields[key] : [];
  };
  /** What applies now: the saved map, or until one is saved, the match by field name. */
  const effectiveMap = (d: KbktSettings, kind: KbktMappedKind) => {
    const key = typeKey(d.issueTypes[kind]);
    return d.fieldMap?.[kind] ?? (key ? options.autoFieldMaps[key]?.[kind] : undefined) ?? {};
  };
  const setField = (kind: KbktMappedKind, source: string, fieldId: string) =>
    set((d) => {
      const next = { ...effectiveMap(d, kind) };
      if (fieldId) next[source] = fieldId;
      else delete next[source];
      return { ...d, fieldMap: { ...d.fieldMap, [kind]: next } };
    });
  // Another issue type has other fields: its map starts again from the name match.
  const changeType = (kind: KbktMappedKind, v: string) =>
    set((d) => {
      const fieldMap = { ...d.fieldMap };
      delete fieldMap[kind];
      return { ...d, issueTypes: { ...d.issueTypes, [kind]: v }, fieldMap: Object.keys(fieldMap).length ? fieldMap : undefined };
    });

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
          {select(draft.issueTypes.test, choices(subtasks, draft.issueTypes.test), (v) => changeType("test", v))}
        </label>
        <label className="field">
          <span>Lỗi (sub-task)</span>
          {select(draft.issueTypes.bug, choices(subtasks, draft.issueTypes.bug), (v) => changeType("bug", v))}
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

      <h4>Trường của Jira</h4>
      <p className="kb-muted">
        Mỗi phần của test case / lỗi có thể vào một trường riêng của Jira (Module, Test Steps, Expected Result…); phần để
        "Trong Mô tả" vẫn nằm ở Mô tả như trước.{" "}
        {draft.fieldMap ? (
          <button
            className="link-btn"
            disabled={disabled}
            onClick={() => set((d) => ({ ...d, fieldMap: undefined }))}
          >
            Khớp lại theo tên trường
          </button>
        ) : (
          "Đang tự khớp theo tên trường."
        )}
      </p>
      {(["test", "bug"] as const).map((kind) => {
        const fields = fieldsOf(kind);
        const map = effectiveMap(draft, kind);
        return (
          <div key={kind} className="kb-fieldmap">
            <div className="kb-fieldmap-title">
              {kind === "test" ? "Test case" : "Lỗi"} ({draft.issueTypes[kind]})
            </div>
            {fields.length === 0 ? (
              <p className="kb-muted">
                Màn hình tạo {draft.issueTypes[kind]} không có trường nào điền được. Mọi nội dung để trong Mô tả.
              </p>
            ) : (
              <div className="kb-grid">
                {options.fieldSources[kind].map((source) => {
                  const value = map[source.key] ?? "";
                  const list = [
                    { value: "", label: "Trong Mô tả" },
                    ...fields.map((f) => ({ value: f.id, label: f.name })),
                  ];
                  if (value && !fields.some((f) => f.id === value)) {
                    list.push({ value, label: `${value} (không có trên màn hình tạo)` });
                  }
                  return (
                    <label key={source.key} className="field">
                      <span>{source.label}</span>
                      {select(value, list, (v) => setField(kind, source.key, v))}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

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

      {embedded ? (
        <div className="settings-foot">
          {saved && !dirty && <span className="kb-muted">Đã lưu</span>}
          <button onClick={reset} disabled={disabled || saving || !dirty}>
            Huỷ
          </button>
          <button className="primary" onClick={save} disabled={disabled || saving || !dirty}>
            {saving ? "Đang lưu…" : "Lưu cấu hình"}
          </button>
        </div>
      ) : (
        <div className="kb-settings-actions">
          <button className="primary" onClick={save} disabled={disabled || saving}>
            {saving ? "Đang lưu…" : "Lưu cấu hình"}
          </button>
          {saved && <span className="kb-muted">Đã lưu. Bấm Xem trước lại để áp dụng.</span>}
        </div>
      )}
    </div>
  );
}


export default function KbktSettingsSection({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [options, setOptions] = useState<KbktOptions | null>(null);
  const [settings, setSettings] = useState<KbktSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <div className="kb-settings is-embedded">
      {loadError && <div className="modal-error">{loadError}</div>}
      {settings && options ? (
        <SettingsForm initial={settings} options={options} disabled={false} embedded onDirtyChange={onDirtyChange} onSaved={setSettings} />
      ) : (
        !loadError && <p className="kb-muted">Đang tải…</p>
      )}
    </div>
  );
}
