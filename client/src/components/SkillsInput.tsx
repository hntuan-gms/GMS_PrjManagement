import { useState } from "react";
import { normalizeSkills } from "../skillMatrix";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Skills already used in the team, offered as one-click additions. */
  suggestions?: string[];
  placeholder?: string;
}

/**
 * Skills as chips. Unlike LabelsInput a space is part of the name ("Kiểm thử",
 * "React Native"), so only Enter or a comma ends one; Backspace on an empty box
 * removes the last chip.
 */
export default function SkillsInput({ value, onChange, suggestions = [], placeholder = "Thêm kỹ năng…" }: Props) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) onChange(normalizeSkills([...value, ...parts]));
    setDraft("");
  }

  const open = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);

  return (
    <div className="skills-input">
      <div className="labels-input">
        {value.map((s) => (
          <span key={s} className="label-chip">
            {s}
            <button type="button" aria-label={`Gỡ kỹ năng ${s}`} onClick={() => onChange(value.filter((x) => x !== s))}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={value.length === 0 ? placeholder : ""}
          aria-label="Thêm kỹ năng"
          onChange={(e) => (e.target.value.endsWith(",") ? commit(e.target.value) : setDraft(e.target.value))}
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
      {open.length > 0 && (
        <div className="skills-suggest">
          {open.map((s) => (
            <button key={s} type="button" className="text-btn" onClick={() => onChange(normalizeSkills([...value, s]))}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
