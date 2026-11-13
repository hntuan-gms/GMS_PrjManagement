import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { api } from "./api";
import { filesFromClipboard } from "./attachments";
import { htmlToRich } from "./richPaste";
import { applyAction, attachmentImage, continueBlock, indentItems, insertBlock, settleUpload, uploadingToken, type RichAction, type TextEdit } from "./richEdit";
import { toast } from "./toast";

/**
 * Formatting for a text area that holds the Markdown of richText.ts (drawn by components/RichToolbar):
 * its keys (Ctrl B / Ctrl I, Enter carrying a list on, Tab nesting it), and pictures pasted, dropped
 * or picked — each is uploaded to the issue as an attachment and lands in the text as
 * `![name](attachment:id)`, which the server writes into Jira as the picture itself. Pasted HTML
 * keeps its headings and lists.
 *
 * Edits go through `insertText` so the browser's own undo (Ctrl Z) still works.
 */

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
let uploadSeq = 0;

interface Options {
  areaRef: RefObject<HTMLTextAreaElement | null>;
  setValue: (next: string | ((prev: string) => string)) => void;
  /** The issue pictures are attached to; without one, pictures are not offered. */
  taskId?: string;
  /** A picture became an attachment (the panel's attachment list is no longer complete). */
  onUploaded?: () => void;
}

export function useRichEditing({ areaRef, setValue, taskId, onUploaded }: Options) {
  const [uploading, setUploading] = useState(0);
  const uploadedRef = useRef(onUploaded);
  useEffect(() => {
    uploadedRef.current = onUploaded;
  });

  function current(): TextEdit | null {
    const el = areaRef.current;
    return el ? { value: el.value, start: el.selectionStart, end: el.selectionEnd } : null;
  }

  /** Puts `edit` into the box: only the part that changed is replaced, so Ctrl Z undoes it in one step. */
  function apply(edit: TextEdit) {
    const el = areaRef.current;
    if (!el) return;
    const old = el.value;
    let a = 0;
    while (a < old.length && a < edit.value.length && old[a] === edit.value[a]) a++;
    let b = 0;
    while (b < old.length - a && b < edit.value.length - a && old[old.length - 1 - b] === edit.value[edit.value.length - 1 - b]) b++;
    el.focus();
    el.setSelectionRange(a, old.length - b);
    const inserted = edit.value.slice(a, edit.value.length - b);
    // execCommand is old but it is the one way to edit a text area and keep its undo history.
    const ok =
      inserted === "" ? a === old.length - b || document.execCommand("delete") : document.execCommand("insertText", false, inserted);
    if (!ok || el.value !== edit.value) setValue(edit.value);
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(edit.start, edit.end);
    });
  }

  function run(action: RichAction) {
    const e = current();
    if (e) apply(applyAction(e, action));
  }

  function addImages(files: File[]) {
    if (!taskId) return;
    const tooBig = files.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig.length) toast(`Ảnh quá 20 MB, không thêm: ${tooBig.map((f) => f.name).join(", ")}`, { tone: "error" });
    for (const file of files.filter((f) => f.size <= MAX_IMAGE_BYTES)) {
      const n = ++uploadSeq;
      const e = current();
      if (!e) return;
      apply(insertBlock(e, uploadingToken(n, file.name)));
      setUploading((u) => u + 1);
      api
        .uploadAttachment(taskId, file)
        .then(
          (created) => {
            const f = created[0];
            setValue((v) => settleUpload(v, n, f ? attachmentImage(f.id, f.filename) : ""));
            uploadedRef.current?.();
          },
          (err) => {
            setValue((v) => settleUpload(v, n, ""));
            toast(`Không tải được ảnh ${file.name}: ${err instanceof Error ? err.message : "lỗi không rõ"}`, { tone: "error" });
          }
        )
        .finally(() => setUploading((u) => u - 1));
    }
  }

  /** True when the key was taken here. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (e.nativeEvent.isComposing) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === "b" || e.key === "B" || e.key === "i" || e.key === "I")) {
      e.preventDefault();
      e.stopPropagation();
      run(e.key.toLowerCase() === "b" ? "bold" : "italic");
      return true;
    }
    if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey) {
      const cur = current();
      const next = cur && continueBlock(cur);
      if (next) {
        e.preventDefault();
        apply(next);
        return true;
      }
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      const cur = current();
      const next = cur && indentItems(cur, e.shiftKey);
      if (next) {
        e.preventDefault();
        e.stopPropagation();
        apply(next);
        return true;
      }
    }
    return false;
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = filesFromClipboard(e.clipboardData).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0 && taskId) {
      // Taken here: the panel would otherwise also add it to the issue's attachment list on its own.
      e.preventDefault();
      e.stopPropagation();
      addImages(files);
      return;
    }
    const rich = htmlToRich(e.clipboardData.getData("text/html"));
    const plain = e.clipboardData.getData("text/plain");
    if (rich && rich !== plain.trim()) {
      e.preventDefault();
      const cur = current();
      if (cur) apply({ value: cur.value.slice(0, cur.start) + rich + cur.value.slice(cur.end), start: cur.start + rich.length, end: cur.start + rich.length });
    }
  }

  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0 || !taskId) return;
    e.preventDefault();
    e.stopPropagation();
    areaRef.current?.focus();
    addImages(files);
  }

  return { run, addImages, onKeyDown, onPaste, onDrop, uploading: uploading > 0, pictures: !!taskId };
}

export type RichEditing = ReturnType<typeof useRichEditing>;
