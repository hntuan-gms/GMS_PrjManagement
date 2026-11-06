/**
 * A "done" status that means the work was dropped, not finished. Jira files "Cancel", "Rejected",
 * "Won't do" under the done category, and a tick beside them says the work was delivered.
 * Matched on the workflow's own name with diacritics folded, whole words only: a bare "huy" would
 * also match the "chuyen" of "Chuyển QA".
 */
const DROPPED = /\b(cancel\w*|reject\w*|won.?t do|duplicate|abandon\w*|huy|da huy|tu choi|bo qua|khong lam)\b/;

export function isDroppedStatus(name: string | undefined): boolean {
  if (!name) return false;
  return DROPPED.test(name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase());
}
