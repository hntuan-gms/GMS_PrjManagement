import { useRef, useState } from "react";
import { formatDateInput, parseDateInput } from "../dateInput";
import { todayIso } from "../resourceAllocation";
import { Icon } from "./Icons";

/**
 * The app's date box: always DD/MM/YYYY whatever language the browser speaks, and it takes words
 * ("t6", "mai", "+3n", "15/11"). The calendar button still opens the platform's picker (a hidden
 * native date input) — choosing from a calendar is the one thing the browser does well here.
 */
export default function DateField({
  value,
  onChange,
  ariaLabel,
  base,
  className,
  disabled,
}: {
  value: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
  /** What "+3n" counts from (e.g. the start date for an end date); today when absent. */
  base?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const shown = draft ?? formatDateInput(value);

  function commit() {
    if (draft === null) return;
    const iso = parseDateInput(draft, todayIso(), base);
    if (iso === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(null);
    if (iso !== value) onChange(iso);
  }

  return (
    <span className={`date-field${bad ? " is-bad" : ""}${className ? ` ${className}` : ""}`}>
      <input
        type="text"
        inputMode="text"
        value={shown}
        placeholder="dd/mm/yyyy"
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        title={bad ? "Không đọc được ngày. Gõ 15/11, t6, mai hoặc +3n." : "Gõ 15/11, t6, mai, +3n… hoặc chọn trên lịch"}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape" && draft !== null) {
            e.stopPropagation();
            setDraft(null);
            setBad(false);
          }
        }}
      />
      <button
        type="button"
        className="date-field-pick"
        aria-label="Chọn trên lịch"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => {
          const el = pickerRef.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
      >
        <Icon name="calendar" size={14} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="date-field-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={(e) => {
          setDraft(null);
          setBad(false);
          if (e.target.value !== value) onChange(e.target.value);
        }}
      />
    </span>
  );
}
