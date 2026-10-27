import { useMemo, useState } from "react";
import { api } from "../api";
import { buildSkillMatrix, filterRows, normalizeSkills, skillKey, toggleSkill } from "../skillMatrix";
import type { ResourceProfile } from "../types";

interface Props {
  users: Array<{ accountId: string; displayName: string; avatarUrl?: string | null }>;
  profiles: ResourceProfile[];
  onProfileSaved: (profile: ResourceProfile) => void;
}

/**
 * Who can do what. A cell is a switch: clicking it adds or removes that skill on
 * the person's profile — the same `resource_profile.skills` the AI planner reads
 * when it proposes an assignee, so filling this in directly improves "ai nên làm
 * việc này". Nothing here is computed from Jira; it is only what the team says.
 */
export default function SkillMatrixView({ users, profiles, onProfileSaved }: Props) {
  const [query, setQuery] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matrix = useMemo(() => buildSkillMatrix(users, profiles, extra), [users, profiles, extra]);
  const rows = useMemo(() => filterRows(matrix.rows, query), [matrix.rows, query]);
  const nameOf = useMemo(() => new Map(users.map((u) => [u.accountId, u.displayName])), [users]);

  async function toggle(accountId: string, label: string) {
    const row = matrix.rows.find((r) => r.accountId === accountId);
    if (!row) return;
    const cell = `${accountId}|${skillKey(label)}`;
    setSaving(cell);
    setError(null);
    try {
      const saved = await api.saveResourceProfile(accountId, {
        displayName: nameOf.get(accountId) ?? accountId,
        skills: toggleSkill(row.skills, label),
      });
      onProfileSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được kỹ năng.");
    } finally {
      setSaving(null);
    }
  }

  function addColumn() {
    const [label] = normalizeSkills([newSkill]);
    if (label) setExtra((cur) => normalizeSkills([...cur, label]));
    setNewSkill("");
  }

  return (
    <div className="sm-view">
      <div className="sm-toolbar">
        <input
          type="search"
          className="rv-search"
          value={query}
          placeholder="Tìm người hoặc kỹ năng…"
          aria-label="Tìm người hoặc kỹ năng"
          onChange={(e) => setQuery(e.target.value)}
        />
        <form
          className="sm-add"
          onSubmit={(e) => {
            e.preventDefault();
            addColumn();
          }}
        >
          <input value={newSkill} placeholder="Thêm cột kỹ năng" aria-label="Thêm cột kỹ năng" onChange={(e) => setNewSkill(e.target.value)} />
          <button type="submit" disabled={!newSkill.trim()}>
            Thêm
          </button>
        </form>
        <span className="bd-muted sm-note">
          {matrix.withoutSkills > 0 ? `${matrix.withoutSkills}/${matrix.rows.length} người chưa có kỹ năng nào. ` : ""}
          Bấm vào ô để bật/tắt.
        </span>
      </div>
      {error && <div className="rv-notice rv-notice-error">{error}</div>}

      {matrix.columns.length === 0 ? (
        <div className="empty-state">
          Chưa có kỹ năng nào. Thêm một cột ở trên rồi bấm vào ô của người có kỹ năng đó — trợ lý AI sẽ dùng thông tin này khi gợi ý người làm.
        </div>
      ) : (
        <div className="sm-scroll">
          <table className="sm-table">
            <thead>
              <tr>
                <th className="sm-person">Thành viên</th>
                {matrix.columns.map((c) => (
                  <th key={c.key} title={`${c.count} người`}>
                    <span className="sm-col-label">{c.label}</span>
                    <span className="sm-col-count">{c.count}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId}>
                  <th className="sm-person" scope="row">
                    <b>{r.displayName}</b>
                    {r.role && <small>{r.role}</small>}
                  </th>
                  {matrix.columns.map((c) => {
                    const on = r.has.has(c.key);
                    const busy = saving === `${r.accountId}|${c.key}`;
                    return (
                      <td key={c.key}>
                        <button
                          type="button"
                          className={`sm-cell ${on ? "is-on" : ""}`}
                          aria-pressed={on}
                          aria-label={`${r.displayName} — ${c.label}`}
                          disabled={busy}
                          onClick={() => toggle(r.accountId, c.label)}
                        >
                          {on ? "✓" : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={matrix.columns.length + 1} className="bd-muted">
                    Không có ai khớp.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
