/**
 * Initials for an avatar, the Vietnamese way: people are called by their given name, which comes
 * last, so the first letter of the LAST word leads and the first letter of the FIRST word follows
 * ("Nguyễn Anh" → "AN", "Tuấn Test" → "TT", "Nguyễn Văn An" → "AN"). One word gives one letter;
 * nothing at all gives "?". This is the one rule every avatar in the app uses.
 */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").normalize("NFC").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = Array.from(parts[parts.length - 1])[0] ?? "";
  const out = parts.length > 1 ? last + first : last;
  return out.toLocaleUpperCase("vi") || "?";
}
