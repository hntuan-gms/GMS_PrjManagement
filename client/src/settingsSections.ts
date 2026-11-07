export type SettingsSection = "calendar" | "sla" | "kbkt";

/**
 * The sections of the project settings page. The board's card options are not here: they live in the
 * board's own "Hiển thị" menu, per board in localStorage (cardOptions.ts), and need the board that is open.
 */
export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "calendar", label: "Lịch làm việc" },
  { id: "sla", label: "SLA" },
  { id: "kbkt", label: "Nhập KBKT" },
];
