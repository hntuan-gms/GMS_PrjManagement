/**
 * The keyboard layer: one list of every shortcut, so the "?" sheet, the hints in the command
 * bar and the tooltips all say the same thing (plan §7). Pure data and pure matching — the
 * listener lives in ProjectWorkspace, which owns the state the keys act on.
 */

export interface Shortcut {
  /** Stable id the workspace dispatches on. */
  id: string;
  /** Display form, e.g. "G H", "Ctrl K", "Shift D". */
  keys: string;
  label: string;
  group: "Chung" | "Đi tới" | "Danh sách" | "Việc đang chọn" | "Kế hoạch" | "Lọc";
}

export const SHORTCUTS: Shortcut[] = [
  { id: "command", keys: "Ctrl K", label: "Ô lệnh: tìm, tạo, hỏi trợ lý", group: "Chung" },
  { id: "projects", keys: "Ctrl P", label: "Chuyển dự án", group: "Chung" },
  { id: "help", keys: "?", label: "Bảng phím tắt", group: "Chung" },
  { id: "create", keys: "C", label: "Tạo việc nhanh", group: "Chung" },
  { id: "search", keys: "/", label: "Tìm / lọc trong màn hiện tại", group: "Chung" },
  { id: "sync", keys: "Shift R", label: "Đọc lại từ Jira", group: "Chung" },
  { id: "undo", keys: "Ctrl Z", label: "Hoàn tác thao tác kéo thả", group: "Chung" },
  { id: "escape", keys: "Esc", label: "Đóng lớp trên cùng, rồi bỏ chọn", group: "Chung" },
  { id: "go-today", keys: "G H", label: "Hôm nay", group: "Đi tới" },
  { id: "go-time", keys: "G T", label: "Giờ làm", group: "Đi tới" },
  { id: "lens-1", keys: "1", label: "Kế hoạch", group: "Đi tới" },
  { id: "lens-2", keys: "2", label: "Bảng", group: "Đi tới" },
  { id: "lens-3", keys: "3", label: "Nhân lực", group: "Đi tới" },
  { id: "lens-4", keys: "4", label: "Nhịp dự án", group: "Đi tới" },
  { id: "go-settings", keys: "G S", label: "Cài đặt dự án", group: "Đi tới" },
  { id: "next", keys: "J  ↓", label: "Dòng sau", group: "Danh sách" },
  { id: "prev", keys: "K  ↑", label: "Dòng trước", group: "Danh sách" },
  { id: "open", keys: "Enter", label: "Mở chi tiết", group: "Danh sách" },
  { id: "select-all", keys: "Ctrl A", label: "Chọn tất cả (đang lọc)", group: "Danh sách" },
  { id: "status", keys: "S", label: "Đổi trạng thái", group: "Việc đang chọn" },
  { id: "assign", keys: "A", label: "Giao người", group: "Việc đang chọn" },
  { id: "assign-me", keys: "I", label: "Giao cho tôi", group: "Việc đang chọn" },
  { id: "shift-back", keys: "Alt ←", label: "Dời lùi 1 ngày", group: "Việc đang chọn" },
  { id: "shift-fwd", keys: "Alt →", label: "Dời tới 1 ngày", group: "Việc đang chọn" },
  { id: "copy-key", keys: "Ctrl .", label: "Sao chép mã", group: "Việc đang chọn" },
  { id: "delete", keys: "Delete", label: "Xoá (có hỏi lại)", group: "Việc đang chọn" },
  { id: "today", keys: "T", label: "Cuộn tới hôm nay", group: "Kế hoạch" },
  { id: "mine", keys: "M", label: "Lọc: của tôi", group: "Lọc" },
  { id: "overdue", keys: "O", label: "Lọc: quá hạn", group: "Lọc" },
  { id: "clear-filter", keys: "Shift F", label: "Xoá mọi lọc", group: "Lọc" },
];

export const shortcutKeys = (id: string): string | undefined => SHORTCUTS.find((s) => s.id === id)?.keys;

/** True while the person is typing somewhere — single-letter shortcuts must not fire then. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes(type);
  }
  return false;
}

/** A dialog, modal or open menu is on screen: letter shortcuts stand down so they never act behind it. */
export function overlayOpen(): boolean {
  return !!document.querySelector(".modal-overlay, .dlg-overlay, .cmdk-overlay, .popover-menu, .shortcut-sheet, .side-sheet");
}

/**
 * Two-key sequences ("G H"). `feed` returns the completed sequence id, `"pending"` while the
 * first key waits for its partner (800 ms), or null.
 */
export function createSequence(map: Record<string, string>, timeoutMs = 800) {
  let first: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    first = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    get pending() {
      return first;
    },
    reset,
    feed(key: string): string | "pending" | null {
      const k = key.toLowerCase();
      if (first) {
        const id = map[`${first} ${k}`] ?? null;
        reset();
        return id;
      }
      if (Object.keys(map).some((seq) => seq.startsWith(k + " "))) {
        first = k;
        timer = setTimeout(reset, timeoutMs);
        return "pending";
      }
      return null;
    },
  };
}
