import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { addFiles, encodeFile, formatSize } from "../chatAttachments";
import { atBottom, composeMessage, suggestionsFor, type AttachedTask, type ChatView } from "../chatCompose";
import { streamChat, type RetryMode } from "../chatStream";
import { fromTokens, toTokens, type Mentions } from "../mentions";
import { isTaskDrag, MAX_ATTACHED_TASKS, readTaskDrag, useTaskDragging } from "../taskDrag";
import { toast } from "../toast";
import { useFloatingWindow } from "../useFloatingWindow";
import { usePhone } from "../usePhone";
import type { ViewFilterSpec } from "../viewFilter";
import type { Edge } from "../windowGeometry";
import ChatComposer from "./ChatComposer";
import ChatMarkdown from "./ChatMarkdown";
import { ChoiceButtons, Receipts, Steps, ThinkingBlock, UserText } from "./ChatParts";
import { Icon } from "./Icons";
import Popover from "./Popover";
import { useDialogs } from "./dialogContext";
import type { ChatChoices, ChatMessage, ChatReceiptItem, ChatSessionSummary, JiraUser, Money, Task, TaskUpdateInput, UsageStats } from "../types";

interface Props {
  /**
   * Where this account's current conversation id is remembered in this browser.
   * Keyed by site + account + project, never one key per machine: a session is
   * private to the person who started it.
   */
  storageKey: string;
  /** The project's people, for the "@" menu. */
  users: JiraUser[];
  meId: string;
  /** The project's tasks: dragged work and issue keys are checked against them, and chips show their title. */
  tasks: Task[];
  /** The screen the person is on and what they have selected; sent with each question so "việc này" has a meaning. */
  view: ChatView;
  selectedKeys: string[];
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
  /** set_view_filter: filter the Gantt / heatmap / board the way the user could by hand. spec null clears. */
  onApplyFilter: (ev: { spec: ViewFilterSpec | null; view: "gantt" | "board" | null }) => void;
  onOpenIssue?: (key: string) => void;
  /**
   * Opens the window from outside (the rail's Trợ lý button, Ctrl J, Ctrl K → "Hỏi trợ lý"). A new nonce
   * is a new request; `text`, when given, is asked at once; `toggle` closes a window that is already open.
   */
  openRequest?: { nonce: number; text?: string; toggle?: boolean } | null;
  onOpenChange?: (open: boolean) => void;
  /** An answer finished while the window was closed. */
  onUnreadChange?: (unread: boolean) => void;
}

interface Step {
  label: string;
  done: boolean;
}

/** A turn being streamed right now — not yet in the persisted transcript. */
interface LiveTurn {
  thinking: string;
  text: string;
  steps: Step[];
  planRunId: string | null;
  planItemCount: number;
  report: { id: string; headline: string; health: string } | null;
  /** What set_view_filter applied this turn, in words. */
  filterNote: string | null;
  /** A tool wrote to Jira — this turn can no longer be regenerated. */
  mutated: boolean;
  choices: ChatChoices | null;
  receipts: ChatReceiptItem[];
}

const EMPTY_LIVE: LiveTurn = {
  thinking: "",
  text: "",
  steps: [],
  planRunId: null,
  planItemCount: 0,
  report: null,
  filterNote: null,
  mutated: false,
  choices: null,
  receipts: [],
};

const HEALTH_TEXT: Record<string, string> = {
  on_track: "Đúng tiến độ",
  at_risk: "Có rủi ro",
  off_track: "Chậm tiến độ",
};
/** The old single key, shared by everyone on the machine — cleared, never read. */
const LEGACY_SESSION_KEY = "gms.chat.sessionId";
const RESIZE_EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

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

/** "≈ $0.0123", or "≥ …" when some tokens had no price. Small amounts keep their significant digits. */
function formatMoney(m: Money): string {
  const digits = m.amount === 0 ? 0 : m.amount < 0.01 ? 5 : m.amount < 1 ? 4 : m.amount < 100 ? 2 : 0;
  let text: string;
  try {
    text = new Intl.NumberFormat("vi-VN", { style: "currency", currency: m.currency, minimumFractionDigits: 0, maximumFractionDigits: digits }).format(m.amount);
  } catch {
    // An unknown currency code from the server's config: show the plain number.
    text = `${m.amount.toFixed(digits)} ${m.currency}`;
  }
  return `${m.partial ? "≥" : "≈"} ${text}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const NO_USAGE = { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 };

/**
 * The project assistant: a window that floats over the app.
 *
 * It is dragged by its title bar and resized from any edge like a window of the operating system, and
 * it remembers where it was left. It takes no room from the plan (it used to push the page aside); the
 * person puts it where it does not hide what they are looking at. Closed, it is nothing at all.
 *
 * Work comes in by hand rather than by typing: rows from the plan, cards from the board, rows from
 * Today and the resource tab are dragged onto the window (one, or the whole selection), "@" lists the
 * project's people, and issue keys anywhere in the conversation open the task like they do in the app.
 *
 * Reasoning is never narrated while it streams (a turning dot, then a quiet link to read it): the steps
 * the assistant takes are shown instead, and fold into one line when the answer starts.
 */
export default function ChatDock({
  storageKey,
  users,
  meId,
  tasks,
  view,
  selectedKeys,
  onOpenPlan,
  onOpenReport,
  onProjectChanged,
  onApplyFilter,
  onOpenIssue,
  openRequest,
  onOpenChange,
  onUnreadChange,
}: Props) {
  const dialogs = useDialogs();
  const phone = usePhone();
  const win = useFloatingWindow(!phone);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(() => readStored(storageKey));
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [projectUsage, setProjectUsage] = useState<UsageStats | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [pricing, setPricing] = useState<{ configured: boolean; currency: string } | null>(null);
  // Files and work chosen for the NEXT message. Read and sent with it; nothing is uploaded before that.
  const [pending, setPending] = useState<File[]>([]);
  const [attached, setAttached] = useState<string[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // The last question being rewritten, in place.
  const [editing, setEditing] = useState<{ id: string; text: string; mentions: Mentions } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [jump, setJump] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastAskRef = useRef<{ text: string; files: File[] } | null>(null);
  const dragging = useTaskDragging();

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const knownKeys = useMemo(() => new Set(taskMap.keys()), [taskMap]);

  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);
  useEffect(() => onUnreadChange?.(unread), [unread, onUnreadChange]);

  // Load the transcript only when the window is first opened: nobody needs a
  // chat history fetched on every page load of a Gantt chart.
  useEffect(() => {
    if (!open || messages.length > 0) return;
    const id = sessionId;
    if (!id) return;
    api
      .getChat(id)
      .then((res) => {
        stickRef.current = true;
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
        setPricing(res.pricing);
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

  function resetComposerState() {
    setPending([]);
    setAttached([]);
    setAttachError(null);
    setEditing(null);
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
    resetComposerState();
    requestAnimationFrame(() => inputRef.current?.focus());
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
    resetComposerState();
  }

  async function renameSession(id: string, title: string) {
    setRenaming(null);
    const clean = title.trim();
    if (!clean) return;
    setSessions((prev) => prev?.map((x) => (x.id === id ? { ...x, title: clean } : x)) ?? prev);
    await api.renameChatSession(id, clean).catch((e: Error) => setError(e.message));
  }

  async function deleteSession(id: string) {
    if (!(await dialogs.confirm({ message: "Xoá cuộc trò chuyện này? Bạn sẽ không mở lại được.", tone: "danger" }))) return;
    setSessions((prev) => prev?.filter((x) => x.id !== id) ?? prev);
    await api.deleteChatSession(id).catch((e: Error) => setError(e.message));
    if (id === sessionId) {
      newChat();
      if (showSessions) setShowSessions(true);
    }
  }

  const currentTitle =
    sessions?.find((x) => x.id === sessionId)?.title ??
    messages.find((m) => m.role === "user")?.content.split("\n\n")[0].slice(0, 60) ??
    "Trợ lý";

  /* ---- scrolling: follow new text only while the reader is at the bottom ---- */

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = atBottom(el);
    if (stickRef.current) setJump(false);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
    else if (live) setJump(true);
  }, [messages, live]);

  function jumpToEnd() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  /* ---- opening, closing, focus ---- */

  const askRef = useRef<(text: string) => void>(() => {});
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.nonce === lastNonce.current) return;
    lastNonce.current = openRequest.nonce;
    if (openRequest.toggle && open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const text = openRequest.text?.trim();
    if (text) askRef.current(text);
  }, [openRequest, open]);

  useEffect(() => {
    if (!open) return;
    setUnread(false);
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  /* ---- what is in the next message ---- */

  function attachFiles(incoming: File[]) {
    const { files, error } = addFiles(pending, incoming);
    setPending(files);
    setAttachError(error);
  }

  const addTasks = useCallback(
    (keys: string[]) => {
      const known = keys.filter((k) => knownKeys.has(k));
      if (known.length === 0) return;
      setAttached((prev) => {
        const merged = [...new Set([...prev, ...known])];
        if (merged.length > MAX_ATTACHED_TASKS) {
          setAttachError(`Mỗi tin nhắn đính kèm tối đa ${MAX_ATTACHED_TASKS} việc.`);
          return merged.slice(0, MAX_ATTACHED_TASKS);
        }
        setAttachError(null);
        return merged;
      });
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [knownKeys]
  );

  /* ---- one turn ---- */

  function openIssue(key: string) {
    onOpenIssue?.(key);
    // The task panel docks on the right a moment later; step aside if it would sit on the window.
    window.setTimeout(win.stepAside, 80);
  }

  function submit(text: string, mentions: Mentions) {
    const atts: AttachedTask[] = attached.flatMap((k) => {
      const t = taskMap.get(k);
      return t ? [{ key: k, summary: t.summary }] : [];
    });
    const files = pending;
    const body = text || (files.length > 0 ? "Hãy đọc tệp đính kèm và cho tôi biết nội dung chính." : "");
    setPending([]);
    setAttached([]);
    setAttachError(null);
    void ask(composeMessage(body, atts, mentions), undefined, files);
  }

  /**
   * One turn. `retry` re-asks: "regenerate" answers the last question again,
   * "replace" swaps it for `text` — the old answer (and question) leave the screen
   * at once and come back if the server refuses (409: that answer wrote to Jira).
   */
  async function ask(text: string, retry?: RetryMode, files: File[] = []) {
    setError(null);
    lastAskRef.current = { text, files };
    let encoded;
    try {
      encoded = await Promise.all(files.map(encodeFile));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đọc được tệp đính kèm.");
      setPending(files);
      return;
    }
    const before = messages;
    const lastModel = messages.at(-1)?.role === "model";
    const kept = retry === "regenerate" ? (lastModel ? messages.slice(0, -1) : messages) : retry === "replace" ? (lastModel ? messages.slice(0, -2) : messages.slice(0, -1)) : messages;
    stickRef.current = true;
    setMessages(
      retry === "regenerate"
        ? kept
        : [
            ...kept,
            {
              id: `local-${Date.now()}`,
              role: "user",
              content: text || (encoded.length > 0 ? "Hãy đọc tệp đính kèm và cho tôi biết nội dung chính." : ""),
              attachments: encoded.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
              thinking: null,
              planRunId: null,
              model: null,
              usage: NO_USAGE,
              createdAt: new Date().toISOString(),
            },
          ]
    );
    setLive({ ...EMPTY_LIVE });

    const controller = new AbortController();
    abortRef.current = controller;
    let turn: LiveTurn = { ...EMPTY_LIVE };

    // The streamed turn becomes a normal message once it is complete, so it
    // renders identically whether it just arrived or came back from the DB. Also
    // used when the user presses Stop: what had streamed so far is kept, not
    // thrown away (the server saves the same partial answer).
    const commitTurn = () =>
      setMessages((prev) => [
        ...prev,
        {
          id: `model-${Date.now()}`,
          role: "model",
          content: turn.text,
          thinking: turn.thinking || null,
          planRunId: turn.planRunId,
          mutated: turn.mutated,
          filterNote: turn.filterNote,
          reportId: turn.report?.id ?? null,
          reportHeadline: turn.report?.headline ?? null,
          reportHealth: turn.report?.health ?? null,
          choices: turn.choices,
          receipts: turn.receipts,
          model: null,
          usage: NO_USAGE,
          createdAt: new Date().toISOString(),
        },
      ]);

    const finishSteps = (steps: Step[]) => steps.map((s) => (s.done ? s : { ...s, done: true }));
    let gotEvent = false;
    try {
      for await (const event of streamChat(text, sessionId, controller.signal, retry, encoded, { view, selected: selectedKeys.slice(0, 20) })) {
        gotEvent = true;
        if (event.type === "session") {
          setSessionId(event.sessionId);
          writeStored(storageKey, event.sessionId);
        } else if (event.type === "thinking") {
          turn = { ...turn, thinking: turn.thinking + event.text };
        } else if (event.type === "text") {
          turn = { ...turn, text: turn.text + event.text, steps: finishSteps(turn.steps) };
        } else if (event.type === "tool") {
          turn = { ...turn, steps: [...finishSteps(turn.steps), { label: event.label, done: false }] };
        } else if (event.type === "plan") {
          turn = { ...turn, planRunId: event.runId, planItemCount: event.itemCount, steps: finishSteps(turn.steps) };
        } else if (event.type === "mutated") {
          turn = { ...turn, mutated: true };
          onProjectChanged();
        } else if (event.type === "filter") {
          turn = { ...turn, filterNote: event.summary, steps: finishSteps(turn.steps) };
          onApplyFilter({ spec: event.spec, view: event.view });
        } else if (event.type === "report") {
          turn = { ...turn, report: { id: event.reportId, headline: event.headline, health: event.health }, steps: finishSteps(turn.steps) };
        } else if (event.type === "choices") {
          turn = { ...turn, choices: { prompt: event.prompt, options: event.options } };
        } else if (event.type === "receipt") {
          turn = { ...turn, receipts: [...turn.receipts, ...event.items] };
        } else if (event.type === "done") {
          setUsage(event.usage);
        } else if (event.type === "error") {
          setError(event.message);
        }
        setLive({ ...turn });
      }

      turn = { ...turn, steps: finishSteps(turn.steps) };
      commitTurn();
      if (!open) setUnread(true);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "Trợ lý gặp lỗi.");
        // Refused before anything streamed (e.g. 409): the old answer is still the truth.
        if (retry && !gotEvent) setMessages(before);
      } else if (turn.text.trim() || turn.thinking) {
        commitTurn();
      }
    } finally {
      setLive(null);
      abortRef.current = null;
      refreshSessions();
    }
  }

  const lastMessage = messages.at(-1);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserId = lastUser?.id ?? null;
  // A question with files cannot be asked again: the server did not keep them. And an answer that wrote to
  // Jira cannot be asked again either: it would write again (the server refuses too, this only keeps the buttons honest).
  const hadFiles = (lastUser?.attachments?.length ?? 0) > 0;
  const canRetry = !!sessionId && !hadFiles && !(lastMessage?.role === "model" && lastMessage.mutated);

  function startEdit(m: ChatMessage) {
    const { display, mentions } = fromTokens(m.content);
    setEditing({ id: m.id, text: display, mentions });
  }

  function submitEdit() {
    if (!editing || !editing.text.trim() || live) return;
    const text = toTokens(editing.text.trim(), editing.mentions);
    setEditing(null);
    void ask(text, "replace");
  }

  function retryAfterError() {
    const last = lastAskRef.current;
    setError(null);
    if (canRetry && sessionId) return void ask("", "regenerate");
    if (!last) return;
    // Nothing reached the server: take the unsent question off the list and ask it again.
    setMessages((prev) => (prev.at(-1)?.id.startsWith("local-") ? prev.slice(0, -1) : prev));
    void ask(last.text, undefined, last.files);
  }

  const [copiedId, setCopiedId] = useState<string | null>(null);
  async function copyAnswer(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // Clipboard blocked (permissions, insecure context): nothing useful to show.
    }
  }

  async function undoReceipt(messageId: string, item: ChatReceiptItem) {
    if (!item.undo) return;
    // Marked first: a second click while the write is out must not send the patch twice.
    const mark = (undone: boolean) =>
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, receipts: m.receipts?.map((r) => (r === item ? { ...r, undone } : r)) } : m)));
    mark(true);
    try {
      await api.updateTask(item.key, item.undo.patch as TaskUpdateInput);
      onProjectChanged();
    } catch (e) {
      mark(false);
      toast(e instanceof Error ? e.message : "Không hoàn tác được.", { tone: "error" });
    }
  }

  function stop() {
    abortRef.current?.abort();
    setLive(null);
  }

  askRef.current = (text: string) => {
    void ask(text);
  };

  /* ---- dropping work or files on the window ---- */

  const dragDepth = useRef(0);
  const acceptsDrop = (e: React.DragEvent) => isTaskDrag(e) || Array.from(e.dataTransfer?.types ?? []).includes("Files");
  function onDragEnter(e: React.DragEvent) {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(e: React.DragEvent) {
    if (!acceptsDrop(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  }
  function onDrop(e: React.DragEvent) {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    const keys = readTaskDrag(e);
    if (keys.length > 0) addTasks(keys);
    const files = [...e.dataTransfer.files];
    if (files.length > 0) attachFiles(files);
  }

  const q = sessionQuery.trim().toLowerCase();
  const shownSessions = sessions?.filter((x) => !q || x.title.toLowerCase().includes(q));

  // Closed, the window is nothing; but a drag of work from the app shows where to drop it to start asking.
  if (!open) {
    if (!dragging) return null;
    return (
      <div
        className="chat-dropzone"
        onDragOver={(e) => {
          if (!isTaskDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const keys = readTaskDrag(e);
          setOpen(true);
          if (keys.length > 0) window.setTimeout(() => addTasks(keys), 0);
        }}
      >
        <Icon name="chat" size={16} /> Thả vào đây để hỏi trợ lý
      </div>
    );
  }

  const style = phone ? undefined : { left: win.rect.x, top: win.rect.y, width: win.rect.w, height: win.rect.h };
  const showEmpty = messages.length === 0 && !live;

  return (
    <div
      ref={win.elRef}
      className={`chat-dock${phone ? " is-phone" : ""}${win.maximized ? " is-max" : ""}${win.busy ? ` is-${win.busy}` : ""}${dropActive ? " is-drop" : ""}${dragging && !dropActive ? " is-target" : ""}`}
      style={style}
      role="dialog"
      aria-label="Trợ lý"
      onKeyDown={(e) => {
        // Esc closes the window when focus is in it. Renaming, editing and the "@" menu stop their own Esc
        // first, and stopping it here keeps it from also clearing the plan's selection behind.
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="chat-dock-header"
        onPointerDown={win.startMove}
        onDoubleClick={(e) => {
          if (!phone && !(e.target as HTMLElement).closest("button, input, a")) win.toggleMaximized();
        }}
      >
        <button
          type="button"
          className={`chat-session-btn ${showSessions ? "is-open" : ""}`}
          onClick={() => setShowSessions((v) => !v)}
          title="Các cuộc trò chuyện của bạn"
          aria-label="Các cuộc trò chuyện"
          aria-expanded={showSessions}
        >
          <Icon name="menu" size={14} />
        </button>
        <span className="chat-dock-title">{currentTitle}</span>
        <div className="chat-dock-header-actions">
          <button type="button" className="chat-icon-btn" onClick={newChat} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">
            <Icon name="plus" size={14} />
          </button>
          {!phone && (
            <button
              type="button"
              className="chat-icon-btn"
              onClick={win.toggleMaximized}
              title={win.maximized ? "Thu nhỏ" : "Mở rộng"}
              aria-label={win.maximized ? "Thu nhỏ" : "Mở rộng"}
            >
              <Icon name={win.maximized ? "restore" : "maximize"} size={14} />
            </button>
          )}
          <Popover
            className="chat-icon-btn"
            role="menu"
            align="end"
            caret={false}
            menuLabel="Tuỳ chọn trợ lý"
            ariaLabel="Tuỳ chọn trợ lý"
            title="Tuỳ chọn"
            label={<Icon name="more" size={14} />}
          >
            {({ close }) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    setShowUsage((v) => !v);
                  }}
                >
                  <Icon name="clock" />
                  <span className="menu-item-text">{showUsage ? "Ẩn thống kê token" : "Thống kê token"}</span>
                </button>
                {!phone && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      win.reset();
                    }}
                  >
                    <Icon name="refresh" />
                    <span className="menu-item-text">Đặt lại vị trí</span>
                  </button>
                )}
                {sessionId && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      void deleteSession(sessionId);
                    }}
                  >
                    <Icon name="trash" />
                    <span className="menu-item-text">Xoá cuộc trò chuyện này</span>
                  </button>
                )}
              </>
            )}
          </Popover>
          <button type="button" className="chat-icon-btn" onClick={() => setOpen(false)} title="Đóng (Esc)" aria-label="Đóng">
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      {showSessions && (
        <div className="chat-sessions">
          <button type="button" className="chat-sessions-new" onClick={newChat}>
            <Icon name="plus" size={13} /> Cuộc trò chuyện mới
          </button>
          {sessions && sessions.length > 5 && (
            <input className="chat-sessions-search" value={sessionQuery} onChange={(e) => setSessionQuery(e.target.value)} placeholder="Tìm" aria-label="Tìm cuộc trò chuyện" />
          )}
          {shownSessions === undefined ? (
            <div className="chat-sessions-empty">
              <span className="chat-spinner" />
            </div>
          ) : shownSessions.length === 0 ? (
            <div className="chat-sessions-empty">{q ? "Không có kết quả." : "Chưa có cuộc trò chuyện nào."}</div>
          ) : (
            <ul>
              {shownSessions.map((x) => (
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
                    <button type="button" className="chat-sessions-item" onClick={() => openSession(x.id)}>
                      <span className="chat-sessions-name">{x.title}</span>
                      <span className="chat-sessions-meta">
                        {relativeTime(x.updatedAt)} · {Math.ceil(x.messageCount / 2)} lượt
                      </span>
                    </button>
                  )}
                  <button type="button" className="chat-icon-btn" onClick={() => setRenaming(x.id)} title="Đổi tên" aria-label="Đổi tên">
                    <Icon name="edit" size={14} />
                  </button>
                  <button type="button" className="chat-icon-btn" onClick={() => deleteSession(x.id)} title="Xoá" aria-label="Xoá">
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showUsage && (
        <div className="chat-usage-panel">
          <div className="chat-usage-grid">
            <span>Phiên này</span>
            <span />
            <span>Đầu vào</span>
            <b>{formatTokens(usage?.promptTokens ?? 0)}</b>
            <span>Đầu ra</span>
            <b>{formatTokens(usage?.outputTokens ?? 0)}</b>
            <span title="Token model dùng để suy luận, tính phí riêng với output">Suy nghĩ</span>
            <b>{formatTokens(usage?.thoughtTokens ?? 0)}</b>
            <span title="Phần đầu vào được lưu đệm, rẻ hơn đầu vào thường">Bộ nhớ đệm</span>
            <b>{formatTokens(usage?.cachedTokens ?? 0)}</b>
            <span>Lượt hỏi</span>
            <b>{usage?.messages ?? 0}</b>
            {usage?.cost && (
              <>
                <span title="Theo bảng giá GEMINI_PRICING; token suy nghĩ tính như đầu ra">Chi phí</span>
                <b>{formatMoney(usage.cost)}</b>
              </>
            )}
          </div>
          <div className="chat-usage-grid chat-usage-total">
            <span>Cả dự án</span>
            <b>{formatTokens(projectUsage?.totalTokens ?? 0)}</b>
            <span>Lượt hỏi</span>
            <b>{projectUsage?.messages ?? 0}</b>
            {projectUsage?.cost && (
              <>
                <span>Chi phí</span>
                <b>{formatMoney(projectUsage.cost)}</b>
              </>
            )}
          </div>
          {model && <p className="chat-usage-model">Mô hình: {model}</p>}
          {pricing && !pricing.configured && <p className="chat-usage-model">Chưa có giá cho mô hình này (biến GEMINI_PRICING) nên chỉ hiện số token.</p>}
          {usage?.cost?.partial && <p className="chat-usage-model">Một phần token thuộc mô hình chưa có giá, nên chi phí là mức tối thiểu.</p>}
        </div>
      )}

      <div className="chat-messages-wrap">
        <div className="chat-messages" ref={scrollRef} onScroll={onScroll} role="log" aria-label="Cuộc trò chuyện" aria-busy={!!live}>
          {showEmpty && (
            <div className="chat-empty">
              <div className="chat-suggestions">
                {suggestionsFor(view, selectedKeys.length > 0).map((s) => (
                  <button key={s} type="button" className="chat-suggestion" onClick={() => void ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <p>Kéo việc từ kế hoạch hoặc bảng vào đây, gõ @ để gọi người.</p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
              {m.thinking && <ThinkingBlock text={m.thinking} />}
              {editing?.id === m.id ? (
                <div className="chat-edit">
                  <textarea
                    autoFocus
                    rows={3}
                    value={editing.text}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        // Leaves the edit only — not whatever Escape would close behind the window.
                        e.stopPropagation();
                        setEditing(null);
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitEdit();
                      }
                    }}
                  />
                  <div className="chat-edit-actions">
                    <button type="button" onClick={() => setEditing(null)}>
                      Huỷ
                    </button>
                    <button type="button" className="primary" onClick={submitEdit} disabled={!editing.text.trim()}>
                      Gửi lại
                    </button>
                  </div>
                </div>
              ) : (
                m.content && (
                  <div className="chat-bubble">
                    {m.role === "model" ? (
                      <ChatMarkdown text={m.content} knownKeys={knownKeys} onOpenIssue={openIssue} />
                    ) : (
                      <UserText content={m.content} tasks={taskMap} onOpen={openIssue} />
                    )}
                  </div>
                )
              )}
              {m.role === "user" && (m.attachments?.length ?? 0) > 0 && (
                <ul className="chat-files">
                  {m.attachments!.map((a, i) => (
                    <li key={i} title={`${a.mimeType} · ${formatSize(a.size)}`}>
                      <Icon name="paperclip" size={12} /> {a.name}
                    </li>
                  ))}
                </ul>
              )}
              {m.role === "user" && m.id === lastUserId && !live && editing?.id !== m.id && canRetry && (
                <div className="chat-msg-actions">
                  <button type="button" className="chat-act" onClick={() => startEdit(m)} title="Sửa câu hỏi này rồi hỏi lại" aria-label="Sửa">
                    <Icon name="edit" size={13} />
                  </button>
                </div>
              )}
              {m.role === "model" && m.content && (
                <div className="chat-msg-actions">
                  <button type="button" className="chat-act" onClick={() => copyAnswer(m.id, m.content)} title="Sao chép câu trả lời" aria-label="Sao chép">
                    <Icon name={copiedId === m.id ? "check" : "copy"} size={13} />
                  </button>
                  {m.id === lastMessage?.id && !live && canRetry && (
                    <button type="button" className="chat-act" onClick={() => ask("", "regenerate")} title="Trả lời lại" aria-label="Tạo lại">
                      <Icon name="refresh" size={13} />
                    </button>
                  )}
                </div>
              )}
              {m.receipts && m.receipts.length > 0 && <Receipts items={m.receipts} tasks={taskMap} onOpen={openIssue} onUndo={(r) => void undoReceipt(m.id, r)} />}
              {m.filterNote && (
                <div className="chat-filter-note">
                  <Icon name="filter" size={12} /> <span>{m.filterNote}</span>
                  {m.id === lastMessage?.id && (
                    <button type="button" onClick={() => onApplyFilter({ spec: null, view: null })}>
                      Bỏ lọc
                    </button>
                  )}
                </div>
              )}
              {m.reportId && (
                <button type="button" className="chat-plan-card chat-report-card" onClick={() => onOpenReport(m.reportId!)}>
                  <span className="chat-plan-icon">
                    <Icon name="pulse" size={16} />
                  </span>
                  <span>
                    <strong>Báo cáo tiến độ · {HEALTH_TEXT[m.reportHealth ?? ""] ?? ""}</strong>
                    <br />
                    {m.reportHeadline}
                  </span>
                </button>
              )}
              {m.planRunId && (
                <button type="button" className="chat-plan-card" onClick={() => onOpenPlan(m.planRunId!)}>
                  <span className="chat-plan-icon">
                    <Icon name="plan" size={16} />
                  </span>
                  <span>
                    <strong>Kế hoạch đã sẵn sàng</strong>
                    <br />
                    Bấm để kiểm tra trước khi tạo trên Jira
                  </span>
                </button>
              )}
              {m.choices && m.id === lastMessage?.id && !live && <ChoiceButtons choices={m.choices} onPick={(message) => void ask(message)} />}
            </div>
          ))}

          {live && (
            <div className="chat-msg chat-msg-model">
              {live.thinking && !live.text && <ThinkingBlock text={live.thinking} live />}
              <Steps steps={live.steps} folded={!!live.text} />
              {live.text && (
                <div className="chat-bubble">
                  <ChatMarkdown text={live.text} knownKeys={knownKeys} onOpenIssue={openIssue} />
                </div>
              )}
              {live.receipts.length > 0 && <Receipts items={live.receipts} tasks={taskMap} onOpen={openIssue} onUndo={() => {}} />}
              {live.filterNote && (
                <div className="chat-filter-note">
                  <Icon name="filter" size={12} /> <span>{live.filterNote}</span>
                </div>
              )}
              {live.report && (
                <button type="button" className="chat-plan-card chat-report-card" onClick={() => onOpenReport(live.report!.id)}>
                  <span className="chat-plan-icon">
                    <Icon name="pulse" size={16} />
                  </span>
                  <span>
                    <strong>Báo cáo tiến độ · {HEALTH_TEXT[live.report.health ?? ""] ?? ""}</strong>
                    <br />
                    {live.report.headline}
                  </span>
                </button>
              )}
              {live.planRunId && (
                <button type="button" className="chat-plan-card" onClick={() => onOpenPlan(live.planRunId!)}>
                  <span className="chat-plan-icon">
                    <Icon name="plan" size={16} />
                  </span>
                  <span>
                    <strong>{live.planItemCount} việc đã dựng</strong>
                    <br />
                    Bấm để kiểm tra trước khi tạo trên Jira
                  </span>
                </button>
              )}
              {!live.text && !live.thinking && live.steps.length === 0 && (
                <div className="chat-tool-status">
                  <span className="chat-spinner" /> Đang đọc dữ liệu dự án
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="chat-error">
              <span>{error}</span>
              {(lastAskRef.current || canRetry) && (
                <button type="button" onClick={retryAfterError}>
                  Thử lại
                </button>
              )}
            </div>
          )}
        </div>
        {jump && (
          <button type="button" className="chat-jump" onClick={jumpToEnd}>
            <Icon name="chevronDown" size={13} /> Mới
          </button>
        )}
      </div>

      <ChatComposer
        users={users}
        meId={meId}
        tasks={taskMap}
        attached={attached}
        onRemoveTask={(k) => setAttached((prev) => prev.filter((x) => x !== k))}
        onOpenIssue={openIssue}
        files={pending}
        attachError={attachError}
        onRemoveFile={(i) => {
          setPending((prev) => prev.filter((_, j) => j !== i));
          setAttachError(null);
        }}
        onPickFiles={attachFiles}
        busy={!!live}
        onStop={stop}
        onSubmit={submit}
        textareaRef={inputRef}
        lastQuestion={lastUser ? fromTokens(lastUser.content.split("\n\nViệc đính kèm: ")[0]).display : null}
        selectedKeys={selectedKeys.filter((k) => knownKeys.has(k))}
        onAttachSelected={() => addTasks(selectedKeys)}
      />

      {dropActive && (
        <div className="chat-drop-hint" aria-hidden="true">
          <Icon name="plus" size={18} /> Thả để đính kèm
        </div>
      )}

      {!phone && !win.maximized && RESIZE_EDGES.map((edge) => <span key={edge} className={`chat-rz chat-rz-${edge}`} onPointerDown={win.startResize(edge)} />)}
    </div>
  );
}
