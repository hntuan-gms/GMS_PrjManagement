/**
 * Files attached to a chat message: images, PDFs and plain text.
 *
 * The limits mirror server/src/ai/attachments.ts, which is the one that enforces
 * them — these only keep the browser from encoding a 40 MB file to learn it is too
 * big. Nothing is uploaded when a file is picked: it is read into the message when
 * that is sent, goes to the model for that turn, and is not stored (the server
 * keeps only the name, type and size).
 */

export interface ChatAttachmentMeta {
  name: string;
  mimeType: string;
  size: number;
}

export interface EncodedAttachment extends ChatAttachmentMeta {
  /** Base64, without the `data:` prefix. */
  data: string;
}

export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

const TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];
/** For the file picker's `accept`: types plus the extensions browsers report no type for (.md is often blank). */
export const ACCEPT = [...TYPES, ".md", ".csv", ".txt", ".json"].join(",");

const BY_EXTENSION: Record<string, string> = { md: "text/markdown", csv: "text/csv", txt: "text/plain", json: "application/json" };

/** The type to send for `file`, or null when it is not supported. Falls back to the extension when the browser gives none. */
export function mimeOf(file: { name: string; type: string }): string | null {
  const type = file.type.toLowerCase();
  if (TYPES.includes(type)) return type;
  if (!type || type === "application/octet-stream") return BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
  return null;
}

export const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Adds `incoming` to `current`, or says why it cannot: the message is Vietnamese and ready to show. */
export function addFiles(current: File[], incoming: File[]): { files: File[]; error: string | null } {
  const files = [...current];
  for (const f of incoming) {
    if (!mimeOf(f)) return { files, error: `"${f.name}": loại tệp này chưa hỗ trợ. Dùng ảnh (PNG, JPEG, WebP, GIF), PDF hoặc văn bản (txt, md, csv, json).` };
    if (f.size > MAX_FILE_BYTES) return { files, error: `"${f.name}" lớn hơn ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
    if (files.length >= MAX_FILES) return { files, error: `Chỉ đính kèm tối đa ${MAX_FILES} tệp mỗi tin nhắn.` };
    if (files.reduce((s, x) => s + x.size, f.size) > MAX_TOTAL_BYTES) return { files, error: `Tổng dung lượng tệp vượt ${MAX_TOTAL_BYTES / 1024 / 1024} MB.` };
    files.push(f);
  }
  return { files, error: null };
}

export function encodeFile(file: File): Promise<EncodedAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Không đọc được tệp "${file.name}".`));
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ name: file.name, mimeType: mimeOf(file) ?? file.type, size: file.size, data: url.slice(url.indexOf(",") + 1) });
    };
    reader.readAsDataURL(file);
  });
}
