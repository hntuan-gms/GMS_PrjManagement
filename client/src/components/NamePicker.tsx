interface Props {
  value: string[];
  /** Names the project defines; ones already picked are left out of the list. */
  options: string[];
  onChange: (next: string[]) => void;
  /** First, disabled entry of the list ("+ Thêm thành phần…"). */
  placeholder: string;
  /** Shown instead of the list when the project defines none. */
  emptyHint?: string;
}

/**
 * Components and fix versions: chips for what is set, and a list of what the project
 * offers. Unlike labels these are NOT free-form in Jira — a name the project does not
 * define is refused — so there is no typing, only picking.
 */
export default function NamePicker({ value, options, onChange, placeholder, emptyHint }: Props) {
  const left = options.filter((o) => !value.includes(o));
  // Nothing set and nothing to choose from: a quiet line, not a box that looks fillable but is not.
  if (options.length === 0 && value.length === 0) return <span className="td-value-text muted">{emptyHint ?? "Dự án chưa định nghĩa mục nào."}</span>;
  return (
    <div className="labels-input name-picker">
      {value.map((v) => (
        <span key={v} className="label-chip">
          {v}
          <button type="button" aria-label={`Gỡ ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      {left.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
          }}
          aria-label={placeholder}
        >
          <option value="">{placeholder}</option>
          {left.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
