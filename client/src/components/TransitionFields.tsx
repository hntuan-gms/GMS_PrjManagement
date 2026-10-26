import { useState } from "react";
import { missingFields } from "../transitionFields";
import type { TransitionField } from "../types";

interface FormProps {
  fields: TransitionField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  /** Where to finish in Jira what cannot be filled here. */
  jiraUrl?: string;
}

/** The boxes a workflow wants filled before an issue may move, one control per kind of field. */
export function TransitionFieldsForm({ fields, values, onChange, jiraUrl }: FormProps) {
  const set = (id: string, v: string) => onChange({ ...values, [id]: v });
  return (
    <div className="tfield-list">
      {fields.map((f) => (
        <label key={f.id} className="field">
          <span>
            {f.name}{" "}
            {f.optional ? (
              <em className="tfield-opt">(có thể là ô này)</em>
            ) : (
              <b className="tfield-req" title="Bắt buộc">
                *
              </b>
            )}
          </span>
          {f.kind === "textarea" ? (
            <textarea rows={3} value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} />
          ) : f.kind === "select" ? (
            <select value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)}>
              <option value="">— Chọn —</option>
              {(f.options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.kind === "unsupported" ? (
            <span className="field-note">
              Trường này chưa nhập được ở đây.{" "}
              {jiraUrl && (
                <a href={jiraUrl} target="_blank" rel="noreferrer">
                  Mở trên Jira để điền ↗
                </a>
              )}
            </span>
          ) : (
            <input
              type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
              value={values[f.id] ?? ""}
              onChange={(e) => set(f.id, e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

interface DialogProps {
  title: string;
  /** Why we are asking — Jira's own sentence, or what the move needs. */
  message: string;
  fields: TransitionField[];
  applyLabel?: string;
  onApply: (values: Record<string, string>) => void;
  onCancel: () => void;
}

/** The same form as a window of its own, for a move started somewhere with no room for it (the bulk bar). */
export function TransitionFieldsDialog({ title, message, fields, applyLabel = "Áp dụng", onApply, onCancel }: DialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const blocked = missingFields(fields, values).length > 0;
  return (
    <div className="dlg-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tfd-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onApply(values);
        }}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <h2 id="tfd-title" className="dlg-title">
          {title}
        </h2>
        <p className="dlg-body">{message}</p>
        <TransitionFieldsForm fields={fields} values={values} onChange={setValues} />
        <div className="dlg-actions">
          <button type="button" onClick={onCancel}>
            Huỷ
          </button>
          <button type="submit" className="primary" disabled={blocked}>
            {applyLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
