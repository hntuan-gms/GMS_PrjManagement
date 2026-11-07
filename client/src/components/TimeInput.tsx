import { useState, type InputHTMLAttributes } from "react";
import { parseTime } from "../timeInput";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  /** "HH:mm", 24h. */
  value: string;
  onChange: (value: string) => void;
};

/**
 * A time of day as a text box, always 24h "HH:mm" whatever the operating system's language
 * (`<input type="time">` showed "08:00 AM"). It takes "8", "8h", "8:30", "0830", "20h". The text is a
 * draft: it is committed on Enter or when the box loses focus, written back as HH:mm, and put back
 * to the last good value when it is not a time. While it cannot be read the box is marked invalid.
 * `aria-label`, `id` and the rest pass through to the input.
 */
export default function TimeInput({ value, onChange, onBlur, onKeyDown, className, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const invalid = draft.trim() !== "" && parseTime(draft) === null;

  function commit() {
    const t = parseTime(draft);
    if (t === null) {
      setDraft(value);
      return;
    }
    setDraft(t);
    if (t !== value) onChange(t);
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={rest.placeholder ?? "HH:mm"}
      className={`time-input${invalid ? " is-invalid" : ""}${className ? ` ${className}` : ""}`}
      value={draft}
      aria-invalid={invalid || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        onKeyDown?.(e);
      }}
    />
  );
}
