import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Whole numbers only (a lag in days). */
  integer?: boolean;
  /** An empty field is a value (null) rather than "not finished typing". */
  allowEmpty?: boolean;
};

function parse(text: string, integer: boolean): number | null {
  // Vietnamese keyboards type the decimal separator as a comma.
  const t = text.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return null;
  return n;
}

function format(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * A number field the user can type into freely.
 *
 * The fields it replaces clamped on every keystroke — `Math.max(1, Number(v))`
 * — which was the "1.5 becomes 11.5" bug: clearing the box to retype snapped it
 * straight back to 1 with the caret after it, so the "1.5" typed next was
 * appended to that 1. Here the text is a draft: it is committed whenever it
 * parses and is in range, left alone while it doesn't (an empty box, "1."), and
 * put back to the last good value on blur.
 */
export default function NumberInput({ value, onChange, min, max, integer = false, allowEmpty = false, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState(format(value));
  // Follow a value changed from outside (a reset, a computed suggestion)
  // without fighting the draft that produced the current one.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parse(draft, integer) !== value) setDraft(format(value));
  }

  const inRange = (n: number) => (min === undefined || n >= min) && (max === undefined || n <= max);

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text.trim() === "") {
          if (allowEmpty) onChange(null);
          return;
        }
        const n = parse(text, integer);
        if (n !== null && inRange(n)) onChange(n);
      }}
      onBlur={(e) => {
        const n = parse(draft, integer);
        if (draft.trim() === "" ? !allowEmpty : n === null || !inRange(n)) setDraft(format(value));
        onBlur?.(e);
      }}
    />
  );
}
