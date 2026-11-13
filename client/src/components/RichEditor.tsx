import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditor, useEditorState, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { filesFromClipboard } from "../attachments";
import { docToRich, richToDoc, type DocNode } from "../richDoc";
import { toast } from "../toast";
import type { JiraUser } from "../types";
import { Icon, type IconName } from "./Icons";
import RichImage from "./RichImage";

/**
 * The comment and description box, edited as it reads (TipTap over ProseMirror — the engine Jira's own
 * editor is built on): headings, lists, code, quotes, links, @mentions and pictures look while typing
 * the way they look on the page. What it hands back is still the text of richText.ts (`docToRich`), so
 * the server, the cache and Jira see exactly what they did with the plain box.
 *
 * Markdown typed out of habit turns into the thing itself ("- " a list, "# " a heading, "**x**" bold,
 * "```" a code block). A picture pasted, dropped or picked is uploaded at once as an attachment of the
 * issue and sits in the text as `attachment:<id>`; until then it is an `uploading:n` placeholder and
 * `hasUploading` says so, so nothing is sent with it half done. HTML pasted from Jira or Google Docs
 * keeps its structure (ProseMirror reads it through the same schema).
 */

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
let uploadSeq = 0;

export interface RichEditorHandle {
  focus: () => void;
  clear: () => void;
}

interface Props {
  /** The stored text when the box opens; later changes come from the box itself. */
  value: string;
  onChange: (text: string) => void;
  /** The issue pictures are attached to; without one, pictures are not offered. */
  taskId?: string;
  /** Who "@" lists; none = no mentions. */
  members?: JiraUser[];
  placeholder?: string;
  autoFocus?: boolean;
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  /** Esc with nothing of the box's own to close. True = taken (the panel underneath stays). */
  onEscape?: () => boolean;
  /** Focus left the box (not to its own bar, and not because the window lost focus). */
  onBlur?: () => void;
  onFocus?: () => void;
  /** A picture became an attachment of the issue. */
  onUploaded?: () => void;
  /** Pictures on their way: what is in the box is not ready to send. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Hide the formatting bar (the folded comment box). */
  bare?: boolean;
  className?: string;
  ariaLabel: string;
  handleRef?: (h: RichEditorHandle | null) => void;
}

/* ------------------------------------------------------------------ picture node */

function ImageView({ node, extension, selected }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper className={`rt-figure re-figure${selected ? " is-selected" : ""}`} data-drag-handle="">
      <RichImage src={String(node.attrs.src ?? "")} alt={String(node.attrs.alt ?? "")} taskId={(extension.options as { taskId?: string }).taskId} />
    </NodeViewWrapper>
  );
}

const RichImageNode = Node.create<{ taskId?: string }>({
  name: "richImage",
  group: "block",
  atom: true,
  draggable: true,
  addOptions: () => ({ taskId: undefined }),
  addAttributes: () => ({
    src: { default: "" },
    alt: { default: "" },
  }),
  // Only this box's own pictures are read back from a paste: an <img> from another site is not loaded.
  parseHTML: () => [
    {
      tag: "img[data-rich-src]",
      getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("data-rich-src"), alt: (el as HTMLElement).getAttribute("alt") ?? "" }),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["img", mergeAttributes({ "data-rich-src": HTMLAttributes.src, alt: HTMLAttributes.alt })],
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

/* ------------------------------------------------------------------ mentions */

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d").toLowerCase();

interface SuggestState {
  items: JiraUser[];
  active: number;
  rect: DOMRect | null;
  pick: (u: JiraUser) => void;
}

/* ------------------------------------------------------------------ the bar */

const BUTTONS: Array<{ id: string; icon: IconName; label: string; keys?: string; run: (e: Editor) => void; active: (e: Editor) => boolean }> = [
  { id: "heading", icon: "heading", label: "Tiêu đề", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading") },
  { id: "bold", icon: "bold", label: "Đậm", keys: "Ctrl B", run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { id: "italic", icon: "italic", label: "Nghiêng", keys: "Ctrl I", run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { id: "strike", icon: "strike", label: "Gạch ngang", run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
  { id: "code", icon: "code", label: "Mã", keys: "Ctrl E", run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  { id: "bullet", icon: "listBullet", label: "Danh sách", run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { id: "numbered", icon: "listNumber", label: "Danh sách số", run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { id: "quote", icon: "quote", label: "Trích dẫn", run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { id: "codeblock", icon: "codeBlock", label: "Khối mã", run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
];

function Toolbar({ editor, pictures, onPick, uploading, onLink }: { editor: Editor; pictures: boolean; onPick: () => void; uploading: boolean; onLink: () => void }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => Object.fromEntries([...BUTTONS.map((b) => [b.id, b.active(e)]), ["link", e.isActive("link")]]) as Record<string, boolean>,
  });
  return (
    <div className="rt-bar" role="toolbar" aria-label="Định dạng">
      {BUTTONS.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`rt-bar-btn${active[b.id] ? " is-on" : ""}`}
          aria-label={b.label}
          aria-pressed={active[b.id]}
          title={b.keys ? `${b.label} (${b.keys})` : b.label}
          // The box keeps the focus (and its selection), or the action would have nothing to act on.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => b.run(editor)}
        >
          <Icon name={b.icon} size={15} />
        </button>
      ))}
      <button
        type="button"
        className={`rt-bar-btn${active.link ? " is-on" : ""}`}
        aria-label="Liên kết"
        aria-pressed={active.link}
        title="Liên kết (Ctrl K)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onLink}
      >
        <Icon name="link" size={15} />
      </button>
      {pictures && (
        <button type="button" className="rt-bar-btn" aria-label="Chèn ảnh" title="Chèn ảnh (hoặc dán / kéo ảnh vào)" onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
          <Icon name="image" size={15} />
        </button>
      )}
      {uploading && <span className="rt-bar-note">Đang tải ảnh…</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ the box */

export default function RichEditor(props: Props) {
  const { taskId, bare, className, ariaLabel } = props;
  // The editor is made once; what it calls back reads the latest props through this.
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });
  const [uploading, setUploading] = useState(0);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const suggestRef = useRef<SuggestState | null>(null);
  const [linkAsk, setLinkAsk] = useState<{ href: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  const showSuggest = (s: SuggestState | null) => {
    suggestRef.current = s;
    setSuggest(s);
  };

  function addImages(files: File[]) {
    const editor = editorRef.current;
    const issue = live.current.taskId;
    if (!editor || !issue) return;
    const tooBig = files.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig.length) toast(`Ảnh quá 20 MB, không thêm: ${tooBig.map((f) => f.name).join(", ")}`, { tone: "error" });
    for (const file of files.filter((f) => f.size <= MAX_IMAGE_BYTES)) {
      const src = `uploading:${++uploadSeq}`;
      editor.chain().focus().insertContent({ type: "richImage", attrs: { src, alt: `Đang tải ${file.name}…` } }).run();
      setUploading((n) => n + 1);
      // The placeholder is found again by its src: the text may have moved around it meanwhile.
      const settle = (attrs: { src: string; alt: string } | null) => {
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        let at = -1;
        ed.state.doc.descendants((n, pos) => {
          if (at < 0 && n.type.name === "richImage" && n.attrs.src === src) at = pos;
          return at < 0;
        });
        if (at < 0) return;
        const tr = attrs ? ed.state.tr.setNodeMarkup(at, undefined, attrs) : ed.state.tr.delete(at, at + 1);
        ed.view.dispatch(tr);
      };
      api
        .uploadAttachment(issue, file)
        .then(
          (created) => {
            const f = created[0];
            settle(f ? { src: `attachment:${f.id}`, alt: f.filename } : null);
            live.current.onUploaded?.();
          },
          (err) => {
            settle(null);
            toast(`Không tải được ảnh ${file.name}: ${err instanceof Error ? err.message : "lỗi không rõ"}`, { tone: "error" });
          }
        )
        .finally(() => setUploading((n) => n - 1));
    }
  }

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: props.autoFocus ? "end" : false,
    content: richToDoc(props.value) as never,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" } },
      }),
      Placeholder.configure({ placeholder: () => live.current.placeholder ?? "" }),
      RichImageNode.configure({ taskId }),
      ...(props.members
        ? [
            Mention.configure({
              HTMLAttributes: { class: "td-mention" },
              renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
              renderHTML: ({ node, options }) => ["span", mergeAttributes({ "data-type": "mention", "data-id": node.attrs.id }, options.HTMLAttributes), `@${node.attrs.label ?? node.attrs.id}`],
              suggestion: {
                char: "@",
                items: ({ query }) => (live.current.members ?? []).filter((m) => fold(m.displayName).includes(fold(query))).slice(0, 6),
                render: () => ({
                  onStart: (p) => showSuggest({ items: p.items as JiraUser[], active: 0, rect: p.clientRect?.() ?? null, pick: (u) => p.command({ id: u.accountId, label: u.displayName.replace(/[[\]()]/g, "") }) }),
                  onUpdate: (p) => showSuggest({ items: p.items as JiraUser[], active: 0, rect: p.clientRect?.() ?? null, pick: (u) => p.command({ id: u.accountId, label: u.displayName.replace(/[[\]()]/g, "") }) }),
                  onKeyDown: ({ event }) => {
                    const s = suggestRef.current;
                    if (!s || s.items.length === 0) return false;
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      const n = s.items.length;
                      showSuggest({ ...s, active: (s.active + (event.key === "ArrowDown" ? 1 : n - 1)) % n });
                      return true;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      s.pick(s.items[s.active]);
                      return true;
                    }
                    if (event.key === "Escape") {
                      // Closes the list only — not the box, not the panel underneath.
                      event.stopPropagation();
                      showSuggest(null);
                      return true;
                    }
                    return false;
                  },
                  onExit: () => showSuggest(null),
                }),
              },
            }),
          ]
        : []),
    ],
    editorProps: {
      attributes: { "aria-label": ariaLabel, "aria-multiline": "true", role: "textbox", spellcheck: "false" },
      handlePaste: (_view: EditorView, event: ClipboardEvent) => {
        const files = filesFromClipboard(event.clipboardData).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0 || !live.current.taskId) return false;
        // Taken here: the panel would otherwise also add it to the issue's attachment list on its own.
        event.preventDefault();
        event.stopPropagation();
        addImages(files);
        return true;
      },
      handleDrop: (_view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) => {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length === 0 || !live.current.taskId) return false;
        event.preventDefault();
        event.stopPropagation();
        addImages(files);
        return true;
      },
      handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.stopPropagation();
          live.current.onSubmit?.();
          return true;
        }
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
          // Ctrl K is the command bar elsewhere; inside the box it is a link, as in Jira.
          event.preventDefault();
          event.stopPropagation();
          askLink();
          return true;
        }
        if (event.key === "Escape" && !suggestRef.current) {
          if (live.current.onEscape?.()) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => live.current.onChange(docToRich(ed.getJSON() as DocNode)),
    onFocus: () => live.current.onFocus?.(),
    onBlur: ({ event }) => {
      // The picture picker opening (the window losing focus) is not leaving the box, nor is its own bar.
      if (!document.hasFocus()) return;
      const to = event.relatedTarget as globalThis.Node | null;
      if (to && wrapRef.current?.contains(to)) return;
      live.current.onBlur?.();
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    props.handleRef?.({
      focus: () => editor.commands.focus("end"),
      clear: () => editor.commands.clearContent(true),
    });
    return () => props.handleRef?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    live.current.onUploadingChange?.(uploading > 0);
  }, [uploading]);

  function askLink() {
    const ed = editorRef.current;
    if (!ed) return;
    setLinkAsk({ href: String(ed.getAttributes("link").href ?? "") });
  }

  function applyLink(href: string) {
    const ed = editorRef.current;
    setLinkAsk(null);
    if (!ed) return;
    const url = href.trim();
    const chain = ed.chain().focus().extendMarkRange("link");
    if (!url) return void chain.unsetLink().run();
    const full = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    if (ed.state.selection.empty && !ed.isActive("link")) {
      ed.chain().focus().insertContent({ type: "text", text: full, marks: [{ type: "link", attrs: { href: full } }] }).run();
    } else chain.setLink({ href: full }).run();
  }

  return (
    <div ref={wrapRef} className={`re${bare ? " is-bare" : ""}${className ? ` ${className}` : ""}`}>
      {!bare && <Toolbar editor={editor} pictures={!!taskId} uploading={uploading > 0} onPick={() => fileRef.current?.click()} onLink={askLink} />}
      {linkAsk && (
        <form
          className="re-link"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink(String(new FormData(e.currentTarget).get("href") ?? ""));
          }}
        >
          <input
            name="href"
            autoFocus
            defaultValue={linkAsk.href}
            placeholder="Dán địa chỉ liên kết (https://…)"
            aria-label="Địa chỉ liên kết"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setLinkAsk(null);
                editor.commands.focus();
              }
            }}
          />
          <button type="submit" className="primary tonal">
            {linkAsk.href ? "Lưu" : "Thêm"}
          </button>
          {linkAsk.href && (
            <button type="button" onClick={() => applyLink("")}>
              Bỏ liên kết
            </button>
          )}
        </form>
      )}
      <EditorContent editor={editor} className="re-content rt" />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          addImages(files);
        }}
      />
      {suggest &&
        suggest.items.length > 0 &&
        suggest.rect &&
        createPortal(
          <ul className="td-suggest re-suggest" role="listbox" style={{ position: "fixed", left: suggest.rect.left, top: suggest.rect.bottom + 4 }}>
            {suggest.items.map((u, i) => (
              <li key={u.accountId} role="option" aria-selected={i === suggest.active}>
                <button
                  type="button"
                  className={i === suggest.active ? "is-active" : ""}
                  // mousedown, not click: the box would blur first and close the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    suggest.pick(u);
                  }}
                >
                  {u.displayName}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
