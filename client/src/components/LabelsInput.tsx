import { useState } from "react";
import SuggestInput from "./SuggestInput";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Labels already used on the site, offered as completions. */
  suggestions?: string[];
  placeholder?: string;
}

/**
 * Jira labels: free-form tags that cannot contain spaces, so a space (or comma,
 * or Enter) ends the current one instead of becoming part of it. Backspace on an
 * empty box removes the last chip.
 */
export default function LabelsInput({ value, onChange, suggestions = [], placeholder = "Thêm nhãn…" }: Props) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft("");
  }

  return (
    <div className="labels-input">
      {value.map((l) => (
        <span key={l} className="label-chip">
          {l}
          <button type="button" aria-label={`Gỡ nhãn ${l}`} onClick={() => onChange(value.filter((x) => x !== l))}>
            ×
          </button>
        </span>
      ))}
      <SuggestInput
        value={draft}
        suggestions={suggestions.filter((s) => !value.includes(s)).slice(0, 200).map((s) => ({ value: s }))}
        onPick={(v) => commit(v)}
        placeholder={value.length === 0 ? placeholder : ""}
        onChange={(v) => {
          // A typed space or comma ends the label; anything else keeps building it.
          if (/[\s,]$/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
