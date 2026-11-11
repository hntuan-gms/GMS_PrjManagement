/*
 * The three optional boxes under a quick-add title (Bắt đầu, Kết thúc, Người) and how they combine with
 * what the sentence already said ("3n", "15/11", "@Minh"). Pure, so the rule is testable without the chart:
 * a box that is filled wins over the same thing typed in the sentence; an empty box changes nothing.
 */
import { inclusiveDays, isIsoDate } from "./scheduleFields";

export interface QuickExtras {
  /** YYYY-MM-DD, "" = not set. */
  startDate: string;
  /** YYYY-MM-DD, "" = not set. */
  dueDate: string;
  /** "" = not set. */
  assigneeAccountId: string;
}

export const NO_EXTRAS: QuickExtras = { startDate: "", dueDate: "", assigneeAccountId: "" };

export function hasExtras(e: QuickExtras): boolean {
  return !!(e.startDate || e.dueDate || e.assigneeAccountId);
}

export interface SentenceFields {
  startDate?: string;
  durationDays?: number;
  assigneeAccountId?: string;
}

export type MergedExtras = { ok: true; fields: SentenceFields } | { ok: false; error: string };

/**
 * - both dates: the duration is the days between them, counting both ends;
 * - start only: the sentence's duration stays (one day when it gave none);
 * - due only: the task is the one day it ends on, since a bar needs a start to be drawn.
 */
export function mergeExtras(fields: SentenceFields, extras: QuickExtras): MergedExtras {
  const out: SentenceFields = { ...fields };
  const start = extras.startDate;
  const due = extras.dueDate;
  if ((start && !isIsoDate(start)) || (due && !isIsoDate(due))) return { ok: false, error: "Ngày không hợp lệ." };
  if (start && due) {
    const days = inclusiveDays(start, due);
    if (days < 1) return { ok: false, error: "Kết thúc trước ngày bắt đầu." };
    out.startDate = start;
    out.durationDays = days;
  } else if (start) {
    out.startDate = start;
  } else if (due) {
    out.startDate = due;
    out.durationDays = 1;
  }
  if (extras.assigneeAccountId) out.assigneeAccountId = extras.assigneeAccountId;
  return { ok: true, fields: out };
}
