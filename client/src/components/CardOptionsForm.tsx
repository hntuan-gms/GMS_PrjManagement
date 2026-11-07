import { CARD_FIELDS, COLOR_SCHEMES, type CardOptions } from "../cardOptions";

/**
 * What a board card shows and how it is tinted: one list of checkboxes and one of colour schemes, drawn by
 * the board's "Thẻ" menu and by the "Thẻ trên board" section of the project settings, so the two cannot differ.
 */
export default function CardOptionsForm({ options, onChange, name = "bd-card-color" }: { options: CardOptions; onChange: (next: CardOptions) => void; name?: string }) {
  return (
    <div className="bd-card-opts">
      <div className="menu-heading">Hiện trên thẻ</div>
      {CARD_FIELDS.map((f) => (
        <label key={f.id} className="bd-card-opt">
          <input
            type="checkbox"
            checked={options.fields[f.id]}
            onChange={(e) => onChange({ ...options, fields: { ...options.fields, [f.id]: e.target.checked } })}
          />
          {f.label}
        </label>
      ))}
      <label className="bd-card-opt">
        <input type="checkbox" checked={options.mergeSubtasks} onChange={(e) => onChange({ ...options, mergeSubtasks: e.target.checked })} />
        Gộp sub-task vào thẻ cha
      </label>
      <div className="menu-sep" role="separator" />
      <div className="menu-heading">Màu thẻ</div>
      {COLOR_SCHEMES.map((c) => (
        <label key={c.id} className="bd-card-opt">
          <input type="radio" name={name} checked={options.colorBy === c.id} onChange={() => onChange({ ...options, colorBy: c.id })} />
          {c.label}
        </label>
      ))}
    </div>
  );
}
