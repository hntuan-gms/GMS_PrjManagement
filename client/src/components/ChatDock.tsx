import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { streamChat } from "../chatStream";
import type { ChatMessage, ChatSessionSummary, UsageStats } from "../types";

interface Props {
  /**
   * Where this account's current conversation id is remembered in this browser.
   * Keyed by site + account + project, never one key per machine: a session is
   * private to the person who started it.
   */
  storageKey: string;
  /** Opens the human-check table for a plan the assistant produced. */
  onOpenPlan: (runId: string) => void;
  /** Switches the workspace to the Báo cáo tab showing this report. */
  onOpenReport: (reportId: string) => void;
  /**
   * The assistant's write tools (create_task, assign_task) change Jira behind
   * the workspace's back, so it has to reload — nothing else in the app knows
   * a task appeared or changed owner.
   */
  onProjectChanged: () => void;
}

/** A turn being streamed right now — not yet in the persisted transcript. */
interface LiveTurn {
  thinking: string;
  text: string;
  toolLabel: string | null;
  planRunId: string | null;
  planItemCount: number;
  report: { id: string; headline: string; health: string } | null;
}

const EMPTY_LIVE: LiveTurn = {
  thinking: "",
  text: "",
  toolLabel: null,
  planRunId: null,
  planItemCount: 0,
  report: null,
};

const HEALTH_TEXT: Record<string, string> = {
  on_track: "Đúng tiến độ",
  at_risk: "Có rủi ro",
  off_track: "Chậm tiến độ",
};
/** The old single key, shared by everyone on the machine — cleared, never read. */
const LEGACY_SESSION_KEY = "gms.chat.sessionId";

function readStored(key: string): string | null {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private mode: the conversation still works, it just isn't reopened next visit.
  }
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * The project assistant, docked bottom-right.
 *
 * Collapsed to a pill by default and expanded on click: the Gantt chart is the
 * thing people came for, and a panel that permanently covers the right-hand
 * quarter of it would be closed within a day.
 *
 * Reasoning is rendered as it streams, above the answer. The first token of a
 * real answer can be ten seconds away when the model is thinking or building a
 * plan, and an empty panel for that long reads as a hang.
 */
export default function ChatDock({ storageKey, onOpenPlan, onOpenReport, onProjectChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(() => readStored(storageKey));
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [projectUsage, setProjectUsage] = useState<UsageStats | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the transcript only when the panel is first opened: nobody needs a
  // chat history fetched on every page load of a Gantt chart.
  useEffect(() => {
    if (!open || messages.length > 0) return;
    const id = sessionId;
    if (!id) return;
    api
      .getChat(id)
      .then((res) => {
        setMessages(res.messages);
        setUsage(res.usage);
      })
      .catch(() => {
        // Deleted, or not this account's: start fresh rather than show an error.
        writeStored(storageKey, null);
        setSessionId(null);
      });
  }, [open, sessionId, messages.length, storageKey]);

  useEffect(() => {
    if (!showUsage) return;
    api
      .getUsage(sessionId)
      .then((res) => {
        setProjectUsage(res.project);
        setModel(res.model);
        if (res.session) setUsage(res.session);
      })
      .catch(() => {});
  }, [showUsage, sessionId]);

  // The list is fetched when opened, and again after each turn (a new
  // conversation gets its title from its first question).
  useEffect(() => {
    if (!showSessions) return;
    api
      .listChatSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [showSessions]);

  function refreshSessions() {
    if (showSessions) api.listChatSessions().then(setSessions).catch(() => {});
  }

  function newChat() {
    abortRef.current?.abort();
    setLive(null);
    setMessages([]);
    setUsage(null);
    setError(null);
    setSessionId(null);
    writeStored(storageKey, null);
    setShowSessions(false);
  }

  function openSession(id: string) {
    if (id === sessionId) return setShowSessions(false);
    abortRef.current?.abort();
    setLive(null);
    setError(null);
    setUsage(null);
    // Emptying the list is what makes the transcript effect load the new one.
    setMessages([]);
    setSessionId(id);
    writeStored(storageKey, id);
    setShowSessions(false);
  }

  async function renameSession(id: string, title: string) {
    setRenaming(null);
    const clean = title.trim();
    if (!clean) return;
    setSessions((prev) => prev?.map((x) => (x.id === id ? { ...x, title: clean } : x)) ?? prev);
    await api.renameChatSession(id, clean).catch((e: Error) => setError(e.message));
  }

  async function deleteSession(id: string) {
    if (!window.confirm("Xoá cuộc trò chuyện này? Bạn sẽ không mở lại được.")) return;
    setSessions((prev) => prev?.filter((x) => x.id !== id) ?? prev);
    await api.deleteChatSession(id).catch((e: Error) => setError(e.message));
    if (id === sessionId) {
      newChat();
      setShowSessions(true);
    }
  }

  const currentTitle =
    sessions?.find((x) => x.id === sessionId)?.title ??
    messages.find((m) => m.role === "user")?.content.slice(0, 60) ??
    "Cuộc trò chuyện mới";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live]);

  async function send() {
    const text = input.trim();
    if (!text || live) return;
    setInput("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: text,
        thinking: null,
        planRunId: null,
        model: null,
        usage: { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 },
        createdAt: new Date().toISOString(),
      },
    ]);
    setLive({ ...EMPTY_LIVE });

    const controller = new AbortController();
    abortRef.current = controller;
    let turn = { ...EMPTY_LIVE };

    try {
      for await (const event of streamChat(text, sessionId, controller.signal)) {
        if (event.type === "session") {
          setSessionId(event.sessionId);
          writeStored(storageKey, event.sessionId);
        } else if (event.type === "thinking") {
          turn = { ...turn, thinking: turn.thinking + event.text };
        } else if (event.type === "text") {
          turn = { ...turn, text: turn.text + event.text };
        } else if (event.type === "tool") {
          turn = { ...turn, toolLabel: event.label };
        } else if (event.type === "plan") {
          turn = { ...turn, planRunId: event.runId, planItemCount: event.itemCount, toolLabel: null };
        } else if (event.type === "mutated") {
          onProjectChanged();
        } else if (event.type === "report") {
          turn = {
            ...turn,
            report: { id: event.reportId, headline: event.headline, health: event.health },
            toolLabel: null,
          };
        } else if (event.type === "done") {
          setUsage(event.usage);
        } else if (event.type === "error") {
          setError(event.message);
        }
        setLive({ ...turn });
      }

      // The streamed turn becomes a normal message once it is complete, so it
      // renders identically whether it just arrived or came back from the DB.
      setMessages((prev) => [
        ...prev,
        {
          id: `model-${Date.now()}`,
          role: "model",
          content: turn.text,
          thinking: turn.thinking || null,
          planRunId: turn.planRunId,
          reportId: turn.report?.id ?? null,
          reportHeadline: turn.report?.headline ?? null,
          reportHealth: turn.report?.health ?? null,
          model: null,
          usage: { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 },
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "Trợ lý gặp lỗi.");
      }
    } finally {
      setLive(null);
      abortRef.current = null;
      refreshSessions();
    }
  }

  function stop() {
    abortRef.current?.abort();
    setLive(null);
  }

  if (!open) {
    return (
      <button className="chat-pill" onClick={() => setOpen(true)} title="Trợ lý dự án">
        <span className="chat-pill-dot" />
        Trợ lý dự án
        {usage && <span className="chat-pill-tokens">{formatTokens(usage.totalTokens)}</span>}
      </button>
    );
  }

  return (
    <div className="chat-dock">
      <div className="chat-dock-header">
        <button
          className={`chat-session-btn ${showSessions ? "is-open" : ""}`}
          onClick={() => setShowSessions((v) => !v)}
          title="Các cuộc trò chuyện của bạn"
          aria-expanded={showSessions}
        >
          <span aria-hidden="true">☰</span>
          <span className="chat-session-title">{currentTitle}</span>
        </button>
        <div className="chat-dock-header-actions">
          <button className="chat-icon-btn" onClick={newChat} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">
            ＋
          </button>
          <button className="chat-icon-btn" onClick={() => setShowUsage((v) => !v)} title="Thống kê token">
            ◷
          </button>
          <button className="chat-icon-btn" onClick={() => setOpen(false)} title="Thu gọn">
            ▾
          </button>
        </div>
      </div>

      {showSessions && (
        <div className="chat-sessions">
          <button className="chat-sessions-new" onClick={newChat}>
            ＋ Cuộc trò chuyện mới
          </button>
          {sessions === null ? (
            <div className="chat-sessions-empty">
              <span className="chat-spinner" /> Đang tải...
            </div>
          ) : sessions.length === 0 ? (
            <div className="chat-sessions-empty">Chưa có cuộc trò chuyện nào.</div>
          ) : (
            <ul>
              {sessions.map((x) => (
                <li key={x.id} className={x.id === sessionId ? "is-current" : ""}>
                  {renaming === x.id ? (
                    <input
                      autoFocus
                      defaultValue={x.title}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameSession(x.id, (e.target as HTMLInputElement).value);
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      onBlur={(e) => renameSession(x.id, e.target.value)}
                    />
                  ) : (
                    <button className="chat-sessions-item" onClick={() => openSession(x.id)}>
                      <span className="chat-sessions-name">{x.title}</span>
                      <span className="chat-sessions-meta">
                        {relativeTime(x.updatedAt)} · {Math.ceil(x.messageCount / 2)} lượt
                      </span>
                    </button>
                  )}
                  <button className="chat-icon-btn" onClick={() => setRenaming(x.id)} title="Đổi tên" aria-label="Đổi tên">
                    ✎
                  </button>
                  <button className="chat-icon-btn" onClick={() => deleteSession(x.id)} title="Xoá" aria-label="Xoá">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="chat-sessions-note">Chỉ bạn thấy các cuộc trò chuyện này.</p>
        </div>
      )}

      {showUsage && (
        <div className="chat-usage-panel">
          <div className="chat-usage-grid">
            <span>Phiên này</span>
            <span />
            <span>Input</span>
            <b>{formatTokens(usage?.promptTokens ?? 0)}</b>
            <span>Output</span>
            <b>{formatTokens(usage?.outputTokens ?? 0)}</b>
            <span title="Token model dùng để suy luận, tính phí riêng với output">Suy nghĩ</span>
            <b>{formatTokens(usage?.thoughtTokens ?? 0)}</b>
            <span title="Phần input được cache, rẻ hơn input thường">Cache</span>
            <b>{formatTokens(usage?.cachedTokens ?? 0)}</b>
            <span>Lượt hỏi</span>
            <b>{usage?.messages ?? 0}</b>
          </div>
          <div className="chat-usage-grid chat-usage-total">
            <span>Cả dự án</span>
            <b>{formatTokens(projectUsage?.totalTokens ?? 0)}</b>
            <span>Lượt hỏi</span>
            <b>{projectUsage?.messages ?? 0}</b>
          </div>
          {model && <p className="chat-usage-model">Mô hình: {model}</p>}
        </div>
      )}

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !live && (
          <div className="chat-empty">
            <p>Hỏi về tiến độ, hoặc bảo tôi lập kế hoạch.</p>
            <ul>
              <li>"Dự án đang trễ những task nào?"</li>
              <li>"Ai đang nhận nhiều việc nhất?"</li>
              <li>"Lập kế hoạch làm app bán hàng Flutter, backend FastAPI, 2 tháng"</li>
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            {m.thinking && <ThinkingBlock text={m.thinking} />}
            {m.content && <div className="chat-bubble">{m.content}</div>}
            {m.reportId && (
              <button className="chat-plan-card chat-report-card" onClick={() => onOpenReport(m.reportId!)}>
                <span className="chat-plan-icon">▤</span>
                <span>
                  <strong>Báo cáo tiến độ · {HEALTH_TEXT[m.reportHealth ?? ""] ?? ""}</strong>
                  <br />
                  {m.reportHeadline}
                </span>
              </button>
            )}
            {m.planRunId && (
              <button className="chat-plan-card" onClick={() => onOpenPlan(m.planRunId!)}>
                <span className="chat-plan-icon">▦</span>
                <span>
                  <strong>Kế hoạch đã sẵn sàng</strong>
                  <br />
                  Bấm để kiểm tra trước khi tạo trên Jira
                </span>
              </button>
            )}
          </div>
        ))}

        {live && (
          <div className="chat-msg chat-msg-model">
            {live.thinking && <ThinkingBlock text={live.thinking} live />}
            {live.toolLabel && (
              <div className="chat-tool-status">
                <span className="chat-spinner" /> {live.toolLabel}
              </div>
            )}
            {live.text && <div className="chat-bubble">{live.text}</div>}
            {live.report && (
              <button className="chat-plan-card chat-report-card" onClick={() => onOpenReport(live.report!.id)}>
                <span className="chat-plan-icon">▤</span>
                <span>
                  <strong>Báo cáo tiến độ · {HEALTH_TEXT[live.report.health ?? ""] ?? ""}</strong>
                  <br />
                  {live.report.headline}
                </span>
              </button>
            )}
            {live.planRunId && (
              <button className="chat-plan-card" onClick={() => onOpenPlan(live.planRunId!)}>
                <span className="chat-plan-icon">▦</span>
                <span>
                  <strong>{live.planItemCount} công việc đã dựng</strong>
                  <br />
                  Bấm để kiểm tra trước khi tạo trên Jira
                </span>
              </button>
            )}
            {!live.text && !live.thinking && !live.toolLabel && (
              <div className="chat-tool-status">
                <span className="chat-spinner" /> Đang đọc dữ liệu dự án...
              </div>
            )}
          </div>
        )}

        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-input-row">
        <textarea
          rows={1}
          value={input}
          placeholder="Hỏi về dự án, hoặc yêu cầu lập kế hoạch..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {live ? (
          <button className="chat-send" onClick={stop} title="Dừng">
            ■
          </button>
        ) : (
          <button className="chat-send primary" onClick={send} disabled={!input.trim()}>
            ➤
          </button>
        )}
      </div>

      {/* Token spend sits on the dock's own edge, always visible while chatting
          rather than hidden behind a settings screen nobody opens. */}
      <button className="chat-token-strip" onClick={() => setShowUsage((v) => !v)}>
        <span>
          Phiên: <b>{formatTokens(usage?.totalTokens ?? 0)}</b> token
        </span>
        <span className="chat-token-breakdown">
          in {formatTokens(usage?.promptTokens ?? 0)} · out {formatTokens(usage?.outputTokens ?? 0)} · nghĩ{" "}
          {formatTokens(usage?.thoughtTokens ?? 0)}
        </span>
      </button>
    </div>
  );
}

/** Collapsed by default while streaming so reasoning never pushes the answer off screen. */
function ThinkingBlock({ text, live = false }: { text: string; live?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
  return (
    <div className={`chat-thinking ${live ? "chat-thinking-live" : ""}`}>
      <button className="chat-thinking-toggle" onClick={() => setExpanded((v) => !v)}>
        {live && <span className="chat-spinner" />}
        {expanded ? "▾" : "▸"} Suy nghĩ
      </button>
      {expanded ? (
        <pre className="chat-thinking-full">{text}</pre>
      ) : (
        preview && <div className="chat-thinking-preview">{preview}</div>
      )}
    </div>
  );
}
