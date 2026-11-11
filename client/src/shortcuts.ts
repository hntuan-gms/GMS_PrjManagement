import { isOpen as layersOpen } from "./layers";
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
  group: "Chung" | "Đi tới" | "Danh sách" | "Việc đang chọn" | "List" | "Lọc";
}

export const SHORTCUTS: Shortcut[] = [
  { id: "command", keys: "Ctrl K", label: "Ô lệnh: tìm, tạo, hỏi trợ lý", group: "Chung" },
  { id: "projects", keys: "Ctrl P", label: "Chuyển dự án", group: "Chung" },
  { id: "assistant", keys: "Ctrl J", label: "Mở / đóng trợ lý", group: "Chung" },
  { id: "help", keys: "?", label: "Bảng phím tắt", group: "Chung" },
  { id: "create", keys: "C", label: "Tạo việc nhanh", group: "Chung" },
  { id: "search", keys: "/", label: "Tìm / lọc trong màn hiện tại", group: "Chung" },
  { id: "sync", keys: "Shift R", label: "Đọc lại từ Jira", group: "Chung" },
  { id: "undo", keys: "Ctrl Z", label: "Hoàn tác thao tác kéo thả", group: "Chung" },
  { id: "escape", keys: "Esc", label: "Đóng lớp trên cùng, rồi bỏ chọn", group: "Chung" },
  { id: "go-today", keys: "G H", label: "Hôm nay", group: "Đi tới" },
  { id: "go-booking", keys: "G B", label: "Booking", group: "Đi tới" },
  { id: "go-time", keys: "G T", label: "Clockwork (giờ đã ghi)", group: "Đi tới" },
  { id: "lens-1", keys: "1", label: "List", group: "Đi tới" },
  { id: "lens-2", keys: "2", label: "Board", group: "Đi tới" },
  { id: "lens-3", keys: "3", label: "Resource", group: "Đi tới" },
  { id: "lens-4", keys: "4", label: "Report", group: "Đi tới" },
  { id: "go-settings", keys: "G S", label: "Cài đặt dự án", group: "Đi tới" },
  { id: "next", keys: "J  ↓", label: "Dòng sau", group: "Danh sách" },
  { id: "prev", keys: "K  ↑", label: "Dòng trước", group: "Danh sách" },
  { id: "open", keys: "Enter", label: "Mở chi tiết (Booking: mở / đóng người)", group: "Danh sách" },
  { id: "book-new", keys: "N", label: "Booking: book người đang chọn", group: "Danh sách" },
  { id: "select-all", keys: "Ctrl A", label: "Chọn tất cả (đang lọc)", group: "Danh sách" },
  { id: "status", keys: "S", label: "Đổi trạng thái", group: "Việc đang chọn" },
  { id: "assign", keys: "A", label: "Giao người", group: "Việc đang chọn" },
  { id: "assign-me", keys: "I", label: "Giao cho tôi", group: "Việc đang chọn" },
  { id: "shift-back", keys: "Alt ←", label: "Dời lùi 1 ngày", group: "Việc đang chọn" },
  { id: "shift-fwd", keys: "Alt →", label: "Dời tới 1 ngày", group: "Việc đang chọn" },
  { id: "card-column", keys: "Shift H  Shift L", label: "Board: chuyển thẻ sang cột trái, phải", group: "Việc đang chọn" },
  { id: "copy-key", keys: "Ctrl .", label: "Sao chép mã", group: "Việc đang chọn" },
  { id: "delete", keys: "Delete", label: "Xoá (có hỏi lại)", group: "Việc đang chọn" },
  { id: "today", keys: "T", label: "Cuộn tới hôm nay", group: "List" },
  { id: "draft", keys: "Shift D", label: "Bật / tắt bản nháp kế hoạch", group: "List" },
  { id: "log-time", keys: "L", label: "Hôm nay: ghi giờ", group: "Chung" },
  { id: "mine", keys: "M", label: "Lọc: của tôi", group: "Lọc" },
  { id: "overdue", keys: "O", label: "Lọc: quá hạn", group: "Lọc" },
  { id: "clear-filter", keys: "Shift F", label: "Xoá mọi lọc", group: "Lọc" },
];

/**
 * Ids no key matcher reaches because the thing that owns the list handles them where it has focus
 * (Today's rows, the board's cards), or a layer of its own does (Esc: layers.ts; Ctrl Z: the undo listener).
 */
export const LOCAL_SHORTCUTS: ReadonlySet<string> = new Set(["undo", "escape", "open", "card-column"]);

/** Two-key sequences; the workspace feeds them to `createSequence`. */
export const SEQUENCES: Record<string, string> = { "g h": "go-today", "g b": "go-booking", "g t": "go-time", "g s": "go-settings" };

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The shortcut a key press means, or null. Pure, so a test can feed every id in SHORTCUTS and fail on one
 * that nothing dispatches (the "?" sheet once listed S, A, Alt ←/→, Ctrl . and Ctrl A with no handler).
 * Sequences ("G H") go through `createSequence` instead, and LOCAL_SHORTCUTS are handled where they apply.
 */
export function shortcutIdFor(e: KeyLike): string | null {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (mod && !e.altKey && !e.shiftKey) {
    const l = k.toLowerCase();
    if (l === "k") return "command";
    if (l === "p") return "projects";
    if (l === "j") return "assistant";
    if (l === "a") return "select-all";
    if (k === ".") return "copy-key";
    return null;
  }
  if (e.altKey && !mod && !e.shiftKey) {
    if (k === "ArrowLeft") return "shift-back";
    if (k === "ArrowRight") return "shift-fwd";
    return null;
  }
  if (mod || e.altKey) return null;
  if (e.shiftKey) {
    if (k === "R") return "sync";
    if (k === "D") return "draft";
    if (k === "F") return "clear-filter";
    if (k === "?") return "help";
    return null;
  }
  switch (k) {
    case "?": return "help";
    case "c": return "create";
    case "/": return "search";
    case "1": return "lens-1";
    case "2": return "lens-2";
    case "3": return "lens-3";
    case "4": return "lens-4";
    case "j": return "next";
    case "k": return "prev";
    case "s": return "status";
    case "a": return "assign";
    case "i": return "assign-me";
    case "t": return "today";
    case "m": return "mine";
    case "o": return "overdue";
    case "l": return "log-time";
    case "n": return "book-new";
    case "Delete": return "delete";
    default: return null;
  }
}

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
  // layers.ts is the owner; the selector list still catches a modal that has not registered yet.
  return layersOpen() || !!document.querySelector(".modal-overlay, .dlg-overlay, .cmdk-overlay, .popover-menu, .shortcut-sheet, .side-sheet");
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
