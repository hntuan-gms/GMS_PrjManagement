/**
 * What the browser says about the screen the question was asked on: which tab, and
 * which issues are selected. Sent with each request, never stored in the chat history,
 * and only a sentence in the system prompt — so "việc này" has something to point at.
 */

export interface ChatContext {
  view?: string;
  selected?: string[];
}

const VIEWS: Record<string, string> = {
  today: "Hôm nay",
  gantt: "Kế hoạch",
  board: "Bảng",
  resource: "Nhân lực",
  report: "Nhịp dự án",
  settings: "Cài đặt dự án",
};

const MAX_SELECTED = 20;
const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/** Untrusted body → a context holding only a known tab and keys of this project. */
export function sanitizeContext(raw: unknown, projectKey: string): ChatContext {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as { view?: unknown; selected?: unknown };
  const out: ChatContext = {};
  if (typeof r.view === "string" && Object.hasOwn(VIEWS, r.view)) out.view = r.view;
  if (Array.isArray(r.selected)) {
    const keys: string[] = [];
    for (const k of r.selected) {
      if (typeof k !== "string") continue;
      const key = k.trim().toUpperCase();
      if (KEY.test(key) && key.startsWith(`${projectKey.toUpperCase()}-`) && !keys.includes(key)) keys.push(key);
      if (keys.length >= MAX_SELECTED) break;
    }
    if (keys.length > 0) out.selected = keys;
  }
  return out;
}

/** The one prompt line, or null when there is nothing to say. */
export function contextLine(ctx: ChatContext | undefined): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.view && VIEWS[ctx.view]) parts.push(`Người dùng đang xem tab ${VIEWS[ctx.view]}`);
  if (ctx.selected && ctx.selected.length > 0) parts.push(`đang chọn: ${ctx.selected.join(", ")}`);
  if (parts.length === 0) return null;
  return `${parts.join("; ")}.${ctx.selected && ctx.selected.length > 0 ? " 'việc này' / 'các việc này' là các việc đó." : ""}`;
}
