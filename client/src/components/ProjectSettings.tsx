import { useCallback, useRef } from "react";
import Spinner from "./Spinner";
import { SETTINGS_SECTIONS, type SettingsSection } from "../settingsSections";
import type { SlaSettingsResponse, WorkCalendarSettings } from "../types";
import { useDialogs } from "./dialogContext";
import BoardCardSettings from "./BoardCardSettings";
import KbktSettingsSection from "./KbktSettings";
import SlaSettingsModal from "./SlaSettingsModal";
import WorkCalendarModal from "./WorkCalendarModal";

interface Props {
  projectKey: string;
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  /** The policy the workspace holds (it also carries the calendar). Null until the first read answers. */
  sla: SlaSettingsResponse | null;
  onSlaSaved: (saved: SlaSettingsResponse) => void;
  onCalendarSaved: (calendar: Required<WorkCalendarSettings>) => void;
  /** Name of the lens the page was opened from ("Kế hoạch"). */
  backLabel: string;
  onBack: () => void;
}

/**
 * Cài đặt dự án: a menu on the left, one section on the right. Each section is the body of a dialog the app
 * already had, drawn with `embedded` (no overlay; "Lưu" at the foot of the section, on only when something
 * changed; "Huỷ" puts the saved values back). Anyone can read; only a project admin can save (the section
 * says so in one line, the server checks again).
 */
export default function ProjectSettings({ projectKey, section, onSectionChange, sla, onSlaSaved, onCalendarSaved, backLabel, onBack }: Props) {
  const { confirm } = useDialogs();
  // Whether the section on screen has edits not saved; reset when the section changes (it is remounted).
  const dirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  async function leave(go: () => void) {
    if (dirty.current && !(await confirm({ message: "Bỏ các thay đổi chưa lưu?", confirmLabel: "Bỏ thay đổi", cancelLabel: "Tiếp tục sửa", tone: "danger" }))) return;
    dirty.current = false;
    go();
  }

  const title = SETTINGS_SECTIONS.find((s) => s.id === section)?.label ?? "";

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Cài đặt dự án">
        <button type="button" className="settings-back" onClick={() => void leave(onBack)}>
          <span aria-hidden="true">←</span> Về {backLabel}
        </button>
        <div className="settings-nav-title">Cài đặt dự án</div>
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`settings-nav-item${s.id === section ? " active" : ""}`}
            aria-current={s.id === section ? "page" : undefined}
            data-section={s.id}
            onClick={() => s.id !== section && void leave(() => onSectionChange(s.id))}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <main className="settings-body">
        <h2 className="settings-title">{title}</h2>
        {section === "calendar" && (
          <WorkCalendarModal
            embedded
            initial={sla?.settings ?? null}
            canEdit={sla?.canEdit ?? false}
            onSaved={onCalendarSaved}
            onDirtyChange={onDirtyChange}
          />
        )}
        {section === "sla" &&
          (sla ? (
            <SlaSettingsModal
              embedded
              current={sla}
              onSaved={onSlaSaved}
              onDirtyChange={onDirtyChange}
              onOpenCalendar={() => void leave(() => onSectionChange("calendar"))}
            />
          ) : (
            <Spinner block />
          ))}
        {section === "kbkt" && <KbktSettingsSection onDirtyChange={onDirtyChange} />}
        {section === "board" && <BoardCardSettings projectKey={projectKey} />}
      </main>
    </div>
  );
}
