import { useState } from "react";
import { readCardOptions, readLastCardScope, readRememberedBoards, writeCardOptions, type CardOptions } from "../cardOptions";
import CardOptionsForm from "./CardOptionsForm";

/**
 * "Thẻ trên board" in the project settings: the card options of the board last drawn in the Bảng tab (the
 * same per-board localStorage entry the board's "Thẻ" menu writes). A view preference, so a change applies at once; there is no Save to wait for.
 */
export default function BoardCardSettings({ projectKey }: { projectKey: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const scope = picked ?? readLastCardScope(projectKey);
  const boards = readRememberedBoards(projectKey);
  const [options, setOptions] = useState<CardOptions>(() => readCardOptions(scope ?? ""));
  if (scope === null) return <p className="sla-muted">Chưa mở tab Bảng.</p>;
  const current = boards.find((b) => b.scope === scope);
  const KIND = { scrum: "Scrum", kanban: "Kanban", status: "Theo trạng thái" } as const;
  return (
    <div className="board-card-settings">
      {/* Which board these cards are: the settings are per board, and the page used to not say. */}
      {boards.length > 1 ? (
        <label className="bcs-board">
          <select
            value={scope}
            onChange={(e) => {
              setPicked(e.target.value);
              setOptions(readCardOptions(e.target.value));
            }}
            aria-label="Board"
          >
            {boards.map((b) => (
              <option key={b.scope} value={b.scope}>
                {b.name} · {KIND[b.kind]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        current && <p className="bcs-board-name">{current.name} · {KIND[current.kind]}</p>
      )}
      <CardOptionsForm
        name="settings-card-color"
        options={options}
        onChange={(next) => {
          setOptions(next);
          writeCardOptions(scope, next);
        }}
      />
    </div>
  );
}
