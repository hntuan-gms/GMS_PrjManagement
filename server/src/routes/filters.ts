import { Router } from "express";
import { requireProject } from "../auth/middleware.js";
import { notFound } from "../errors.js";
import { validateFilterInput, type SavedFilterSpec } from "../savedFilters.js";
import { createFilter, deleteFilter, listFilters, updateFilter, type SavedFilter } from "../savedFilterStore.js";

/**
 * Saved filters for the Gantt and resource tab. Anyone who can open the project
 * may save their own and see the ones others shared; only the creator can change
 * or delete one. Nothing here touches Jira except resolving creators' names.
 */
export const filtersRouter = Router();

filtersRouter.use(requireProject);

const missing = () => notFound("Không tìm thấy bộ lọc, hoặc bạn không phải người tạo bộ lọc này.");

filtersRouter.get("/", async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const filters = await listFilters(session.cloudId, session.projectKey!, session.accountId);
    // Names come from Jira on each load, never stored: the table keeps only
    // account ids, the same as every other table here. A failed lookup costs
    // the creator's name on a shared filter, not the list.
    let names = new Map<string, string>();
    if (filters.some((f) => !f.mine)) {
      try {
        names = new Map((await taskService!.listUsers()).map((u) => [u.accountId, u.displayName]));
      } catch {
        // Shown as "người khác" on the client.
      }
    }
    res.json(
      filters.map((f: SavedFilter) => ({
        ...f,
        ownerName: f.mine ? session.displayName : names.get(f.createdBy) ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

filtersRouter.post("/", async (req, res, next) => {
  const { session } = req.auth!;
  try {
    const input = validateFilterInput(req.body, false) as { name: string; shared: boolean; spec: SavedFilterSpec };
    const created = await createFilter(session.cloudId, session.projectKey!, session.accountId, input);
    res.status(201).json({ ...created, ownerName: session.displayName });
  } catch (err) {
    next(err);
  }
});

filtersRouter.patch("/:id", async (req, res, next) => {
  const { session } = req.auth!;
  try {
    const input = validateFilterInput(req.body, true);
    const updated = await updateFilter(session.cloudId, session.projectKey!, session.accountId, req.params.id, input);
    if (!updated) {
      next(missing());
      return;
    }
    res.json({ ...updated, ownerName: session.displayName });
  } catch (err) {
    next(err);
  }
});

filtersRouter.delete("/:id", async (req, res, next) => {
  const { session } = req.auth!;
  try {
    if (!(await deleteFilter(session.cloudId, session.projectKey!, session.accountId, req.params.id))) {
      next(missing());
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
