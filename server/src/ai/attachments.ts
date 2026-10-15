import type { Part } from "@google/genai";

/**
 * Files attached to a chat message: images, PDFs and plain text, handed to Gemini
 * for that one turn.
 *
 * Deliberately NOT stored. The database keeps only each file's name, type and size
 * (ai_chat_message.attachments) so the transcript can say what was attached — the
 * bytes live for the length of the request. That is the line between "the assistant
 * read my screenshot" and "the app is now a file store", and it is why a turn that
 * had attachments cannot be regenerated or edited: the file it was answered from is
 * gone (routes/ai.ts prepareRetry).
 *
 * Validated here rather than trusted from the browser: the body is JSON with each
 * file base64-encoded, so every limit is checked on the decoded size.
 */

export interface AttachmentMeta {
  name: string;
  mimeType: string;
  size: number;
}

/** What the model receives, plus what is remembered about it. */
export interface ParsedAttachments {
  parts: Part[];
  meta: AttachmentMeta[];
}

export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
/** A text file is pasted into the prompt, where every character costs; cap it well below the byte limit. */
export const MAX_TEXT_CHARS = 60_000;
/** The JSON body carries base64 (4/3 of the bytes) plus the message; route-level parser limit. */
export const CHAT_BODY_LIMIT = "20mb";

const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PDF = "application/pdf";
const TEXT = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

export const ALLOWED_TYPES = [...IMAGES, PDF, ...TEXT];

export class AttachmentError extends Error {}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes a base64 string decodes to, without decoding it. */
function decodedSize(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

const cleanName = (s: unknown) =>
  String(s ?? "tệp")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 120) || "tệp";

export function parseAttachments(raw: unknown): ParsedAttachments {
  if (raw === undefined || raw === null) return { parts: [], meta: [] };
  if (!Array.isArray(raw)) throw new AttachmentError("Danh sách tệp đính kèm không hợp lệ.");
  if (raw.length > MAX_FILES) throw new AttachmentError(`Chỉ đính kèm tối đa ${MAX_FILES} tệp mỗi tin nhắn.`);

  const parts: Part[] = [];
  const meta: AttachmentMeta[] = [];
  let total = 0;
  for (const item of raw) {
    const f = (item ?? {}) as { name?: unknown; mimeType?: unknown; data?: unknown };
    const name = cleanName(f.name);
    const mimeType = String(f.mimeType ?? "").toLowerCase();
    if (!ALLOWED_TYPES.includes(mimeType)) {
      throw new AttachmentError(`"${name}": loại tệp này chưa hỗ trợ. Dùng ảnh (PNG, JPEG, WebP, GIF), PDF hoặc văn bản (txt, md, csv, json).`);
    }
    const data = typeof f.data === "string" ? f.data : "";
    if (!data || !BASE64.test(data)) throw new AttachmentError(`"${name}": nội dung tệp không hợp lệ.`);
    const size = decodedSize(data);
    if (size > MAX_FILE_BYTES) throw new AttachmentError(`"${name}" lớn hơn ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new AttachmentError(`Tổng dung lượng tệp vượt ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`);

    if (TEXT.has(mimeType)) {
      const text = Buffer.from(data, "base64").toString("utf8");
      const clipped = text.length > MAX_TEXT_CHARS;
      parts.push({
        text: `Nội dung tệp đính kèm "${name}"${clipped ? ` (đã cắt còn ${MAX_TEXT_CHARS} ký tự đầu)` : ""}:\n${text.slice(0, MAX_TEXT_CHARS)}`,
      });
    } else {
      // Gemini reads images and PDFs natively; the label tells it which is which.
      parts.push({ text: `(Tệp đính kèm: "${name}")` }, { inlineData: { mimeType, data } });
    }
    meta.push({ name, mimeType, size });
  }
  return { parts, meta };
}

/** How the transcript and the model's later turns refer to files whose bytes are gone. */
export function attachmentNote(meta: AttachmentMeta[]): string {
  return meta.length > 0 ? `[Đính kèm: ${meta.map((m) => m.name).join(", ")}]` : "";
}
