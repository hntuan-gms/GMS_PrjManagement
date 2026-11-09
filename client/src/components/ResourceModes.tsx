import type { ResourceMode } from "../lenses";

const MODES: Array<{ id: ResourceMode; label: string }> = [
  { id: "load", label: "Mức tải" },
  { id: "skills", label: "Kỹ năng" },
];

/** Two ways to look at the same people: planned load and skills (the hours logged are Clockwork, on the rail). */
export default function ResourceModes({ mode, onChange }: { mode: ResourceMode; onChange: (m: ResourceMode) => void }) {
  return (
    <div className="segmented-control rv-modes" role="tablist" aria-label="Kiểu xem nguồn lực">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          data-mode={m.id}
          aria-selected={mode === m.id}
          className={`segmented-btn ${mode === m.id ? "active" : ""}`}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
