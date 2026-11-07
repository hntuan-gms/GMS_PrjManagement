import type { ResourceMode } from "../lenses";

const MODES: Array<{ id: ResourceMode; label: string }> = [
  { id: "load", label: "Mức tải" },
  { id: "ts", label: "Giờ đã ghi" },
  { id: "skills", label: "Kỹ năng" },
];

/**
 * Three ways to look at the same people: planned load, hours logged, skills. Someone who may not see the
 * member list has one mode only, so there is nothing to switch and nothing is drawn.
 */
export default function ResourceModes({ mode, onChange, canPlan }: { mode: ResourceMode; onChange: (m: ResourceMode) => void; canPlan: boolean }) {
  if (!canPlan) return null;
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
