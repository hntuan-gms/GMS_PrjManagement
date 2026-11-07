import { useState } from "react";
import { readCardOptions, readLastCardScope, writeCardOptions, type CardOptions } from "../cardOptions";
import CardOptionsForm from "./CardOptionsForm";

/**
 * "Thẻ trên board" in the project settings: the card options of the board last drawn in the Bảng tab (the
 * same per-board localStorage entry the board's "Thẻ" menu writes). A view preference, so a change applies at once; there is no Save to wait for.
 */
export default function BoardCardSettings({ projectKey }: { projectKey: string }) {
  const scope = readLastCardScope(projectKey);
  const [options, setOptions] = useState<CardOptions>(() => readCardOptions(scope ?? ""));
  if (scope === null) return <p className="sla-muted">Chưa mở tab Bảng.</p>;
  return (
    <div className="board-card-settings">
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
