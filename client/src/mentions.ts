/**
 * The @mention round trip of the comment box, kept free of React so it can be tested.
 *
 * The server speaks `@[Name](accountId)`. A person types `@Name`. Between the two
 * sits a label per mention: two members can share a display name, so the label —
 * not the name — is the key, and the second "Nguyễn An" is shown as "Nguyễn An (2)".
 */

export interface Mention {
  accountId: string;
  name: string;
}
export type Mentions = Map<string, Mention>;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The label for `accountId`: its existing one if it has one, else the first free "Name", "Name (2)", … */
export function labelFor(mentions: Mentions, name: string, accountId: string): string {
  for (const [label, m] of mentions) if (m.accountId === accountId) return label;
  let label = name;
  for (let n = 2; mentions.has(label); n++) label = `${name} (${n})`;
  return label;
}

/** Tokens → the `@Name` a person types, remembering who each label stands for. */
export function fromTokens(text: string): { display: string; mentions: Mentions } {
  const mentions: Mentions = new Map();
  const display = text.replace(/@\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, name: string, id: string) => {
    const label = labelFor(mentions, name, id);
    mentions.set(label, { accountId: id, name });
    return `@${label}`;
  });
  return { display, mentions };
}

/** `@Label` → `@[Name](accountId)` for every person picked from the list and still present. */
export function toTokens(text: string, mentions: Mentions): string {
  let out = text;
  // Longest labels first, so "@Anh Tuấn" is not eaten by "@Anh" (nor "@An (2)" by "@An").
  for (const [label, m] of [...mentions].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`@${escapeRe(label)}(?=$|[\\s.,;:!?)])`, "g"), `@[${m.name}](${m.accountId})`);
  }
  return out;
}
