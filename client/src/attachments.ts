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
  for (const file of p.files) {
    try {
      await api.uploadAttachment(issueKey, file);
    } catch (e) {
      errors.push(`${issueKey} · ${file.name}: ${e instanceof Error ? e.message : "tải lên thất bại"}`);
    }
  }
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

