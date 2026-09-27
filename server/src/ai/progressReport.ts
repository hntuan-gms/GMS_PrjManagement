import { badRequest } from "../errors.js";
import { computeProgress } from "../progress.js";
import type { Task } from "../types.js";
import { generateReport } from "./report.js";
import { latestReport, saveReport, type StoredReport } from "./reportStore.js";

/**
 * Compute → narrate → store, in one place.
 *
 * Both entrances go through here — the "Tạo báo cáo" button on the report page
 * and the assistant's create_progress_report tool — so a report produced from
 * the chat is the same document, with the same numbers and the same history
 * entry, as one produced from the page.
 */
export async function createProgressReport(input: {
  tasks: Task[];
  cloudId: string;
  projectKey: string;
  createdBy: string;
  asOf: string;
}): Promise<{ report: StoredReport; warnings: string[] }> {
  const metrics = computeProgress(input.tasks, input.asOf);
  if (metrics.counts.total === 0) {
    throw badRequest("Dự án chưa có công việc nào để lập báo cáo tiến độ.");
  }

  const previous = await latestReport(input.cloudId, input.projectKey);
  const generated = await generateReport(
    input.projectKey,
    metrics,
    new Set(input.tasks.map((t) => t.id)),
    previous
      ? {
          createdAt: previous.createdAt,
          asOf: previous.asOf,
          actualPct: previous.actualPct,
          plannedPct: previous.plannedPct,
          health: previous.health,
        }
      : null
  );

  const report = await saveReport({
    cloudId: input.cloudId,
    projectKey: input.projectKey,
    createdBy: input.createdBy,
    metrics,
    narrative: generated.narrative,
    model: generated.model,
    usage: generated.usage,
  });
  return { report, warnings: generated.warnings };
}
