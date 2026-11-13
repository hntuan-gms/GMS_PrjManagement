import { api } from "./api";

/** Files and web links chosen in a form but not yet sent — they need an issue key first. */
export interface PendingAttachments {
  files: File[];
  links: Array<{ url: string; title: string }>;
}

export const NO_ATTACHMENTS: PendingAttachments = { files: [], links: [] };

// Matches the server's cap; Jira's own default limit (10 MB) is usually lower
// and its message is what the user sees then.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const LINK_URL_RE = /^https?:\/\/\S+$/i;
/** Files sent to Jira at once. */
const UPLOAD_PARALLEL = 4;
/** A dropped or picked folder sends at most this many files. */
export const MAX_FOLDER_FILES = 100;

export function hasPending(p: PendingAttachments): boolean {
  return p.files.length > 0 || p.links.length > 0;
}

/**
 * Sends everything pending to one issue. Each file is its own request, so one
 * rejected file (too large, a type the site blocks) doesn't lose the others;
 * the failures come back as messages.
 */
export async function uploadPending(issueKey: string, p: PendingAttachments): Promise<string[]> {
  const errors: string[] = [];
  // A few at a time: one by one a dropped folder of 30 pictures took a minute (~2 s per file in Jira).
  const queue = [...p.files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        await api.uploadAttachment(issueKey, file);
      } catch (e) {
        errors.push(`${issueKey} · ${file.name}: ${e instanceof Error ? e.message : "tải lên thất bại"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, queue.length) }, worker));
  for (const link of p.links) {
    try {
      await api.addTaskLink(issueKey, link.url, link.title);
    } catch (e) {
      errors.push(`${issueKey} · ${link.url}: ${e instanceof Error ? e.message : "không thêm được liên kết"}`);
    }
  }
  return errors;
}

/**
 * Files pasted from the clipboard (a screenshot) arrive as "image.png" every
 * time; renamed so three pasted screenshots don't land in Jira with one name.
 */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return Array.from(data.files).map((f, i) => {
    if (f.name && f.name !== "image.png") return f;
    const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
    return new File([f], `anh-dan-${stamp}${i ? `-${i}` : ""}.${ext}`, { type: f.type });
  });
}


const IMAGE_TYPE = /^image\//;
/** What a file manager leaves in a folder and nobody means to attach. */
const JUNK_NAME = /^(\.|thumbs\.db$|desktop\.ini$)/i;

/** What a drop or a folder pick holds, folders opened (Jira has no folders: their files are attached side by side). */
export interface DroppedFiles {
  files: File[];
  /** More than `MAX_FOLDER_FILES`: the rest were left out. */
  leftOut: number;
}

function capped(files: File[]): DroppedFiles {
  const kept = files.filter((f) => !JUNK_NAME.test(f.name));
  return { files: kept.slice(0, MAX_FOLDER_FILES), leftOut: Math.max(0, kept.length - MAX_FOLDER_FILES) };
}

/** A folder chosen with the picker (`webkitdirectory`): its files, junk out, capped. */
export const folderFiles = (files: File[]): DroppedFiles => capped(files);

/** The sentence for files a drop left out, or null. */
export const leftOutMessage = (d: DroppedFiles): string | null =>
  d.leftOut > 0 ? `Chỉ đính kèm ${MAX_FOLDER_FILES} tệp đầu, bỏ qua ${d.leftOut} tệp.` : null;

/** Pictures dropped straight on the rich editor were put in its text; the panel attaches only the rest. */
const imagesTaken = new WeakSet<Event>();
export const markImagesTaken = (e: Event) => void imagesTaken.add(e);
export const tookImages = (e: Event) => imagesTaken.has(e);

/** Is this a picture the rich editor takes into its text? */
export const isLooseImage = (f: File) => IMAGE_TYPE.test(f.type);

function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const out: FileSystemEntry[] = [];
  // readEntries hands a directory out in pieces (100 at a time in Chrome) until it returns none.
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(out);
        out.push(...batch);
        next();
      }, reject);
    next();
  });
}

const fileOf = (e: FileSystemFileEntry) => new Promise<File>((resolve, reject) => e.file(resolve, reject));

/**
 * The files of a drop with any folder opened, all the way down. The drag's items are only readable
 * while the drop event runs, so this must be called from the handler itself; the reading after that is
 * asynchronous. `skipLooseImages`: pictures dropped loose (not inside a folder) were already taken by
 * the rich editor.
 */
export async function filesFromDrop(dt: DataTransfer, opts: { skipLooseImages?: boolean } = {}): Promise<DroppedFiles> {
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  const tops = items.map((i) => ({ entry: i.webkitGetAsEntry?.() ?? null, file: i.getAsFile() }));
  if (tops.every((t) => !t.entry)) {
    return capped(Array.from(dt.files).filter((f) => !(opts.skipLooseImages && isLooseImage(f))));
  }
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (out.length > MAX_FOLDER_FILES * 2) return;
    if (entry.isFile) out.push(await fileOf(entry as FileSystemFileEntry));
    else if (entry.isDirectory) for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child);
  };
  for (const t of tops) {
    if (t.entry?.isDirectory) {
      await walk(t.entry).catch(() => undefined);
      continue;
    }
    const f = t.file;
    if (f && !(opts.skipLooseImages && isLooseImage(f))) out.push(f);
  }
  return capped(out);
}
