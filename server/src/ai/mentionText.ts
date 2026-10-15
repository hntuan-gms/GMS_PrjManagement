/**
 * Turns "ping Quang about this" into the `@[Name](accountId)` text the comment
 * API speaks (see adf.commentToAdf), which becomes a real Jira mention — and a
 * real notification.
 *
 * Names are resolved to accounts before this runs (resolvePerson), so an
 * ambiguous "Quang" was already turned into a question, never a guess: a mention
 * of the wrong person is an email to the wrong person.
 */

export interface ResolvedMention {
  /** What the model or user wrote after the @ ("quang", "Võ Đình Quang"). */
  typed: string;
  accountId: string;
  /** The person's display name, as the token will carry it. */
  name: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Brackets and parentheses would end the token early. */
const cleanName = (s: string) => s.replace(/[[\]()]/g, "");

/**
 * Every `@typed` in `text` becomes a mention token. A person who was asked to be
 * mentioned but whose `@name` never appears in the text is put at the front
 * ("@[Quang](id) …") — the model says "mention Quang" and the comment must
 * still notify them.
 */
export function applyMentions(text: string, mentions: ResolvedMention[]): string {
  let out = text.trim();
  const missing: string[] = [];
  // Longest typed names first, so "@Anh Tuấn" is not eaten by "@Anh".
  for (const m of [...mentions].sort((a, b) => b.typed.length - a.typed.length)) {
    const token = `@[${cleanName(m.name)}](${m.accountId})`;
    if (out.includes(token)) continue;
    const re = new RegExp(`@\\s*${escapeRe(m.typed.trim())}(?![\\p{L}\\p{N}])`, "giu");
    if (re.test(out)) out = out.replace(re, token);
    else missing.push(token);
  }
  return [...missing, out].filter(Boolean).join(" ");
}

/** For reading a comment back: mention tokens as plain `@Name`. */
export function mentionsToPlain(text: string): string {
  return text.replace(/@\[([^\]]+)\]\([^)\s]+\)/g, "@$1");
}
