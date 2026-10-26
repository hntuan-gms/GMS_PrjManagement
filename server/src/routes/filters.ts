import { Router } from "express";
import { requireProject } from "../auth/middleware.js";
import { badRequest, notFound } from "../errors.js";
import * as filters from "../filterStore.js";

export const filtersRouter = Router();

/**
 * Saved Gantt filters (migration 009): a person's own, plus everyone's shared ones in
 * this project. Mounted under requireAuth like the rest of /api; requireProject is
 * what ties every read and write to the session's site AND project.
 */
filtersRouter.use(requireProject);

filtersRouter.get("/", async (req, res, next) => {
  try {
    const { cloudId, projectKey, accountId } = req.auth!.session;
    res.json(await filters.listFilters(cloudId, projectKey!, accountId));
  } catch (err) {
    next(err);
  }
});

filtersRouter.post("/", async (req, res, next) => {
  try {
    const { cloudId, projectKey, accountId, displayName } = req.auth!.session;
    const body = (req.body ?? {}) as { name?: unknown; spec?: unknown; shared?: unknown };
    res.status(201).json(
      await filters.saveFilter({ cloudId, projectKey: projectKey!, accountId, displayName }, { name: body.name, spec: body.spec, shared: body.shared })
    );
  } catch (err) {
    next(err);
  }
});

filtersRouter.patch("/:id", async (req, res, next) => {
  try {
    const { cloudId, projectKey, accountId } = req.auth!.session;
    const shared = (req.body as { shared?: unknown } | undefined)?.shared;
    if (typeof shared !== "boolean") {
      next(badRequest("Cần chỉ rõ chia sẻ hay không."));
      return;
    }
    if (!(await filters.setShared(cloudId, projectKey!, accountId, req.params.id, shared))) {
      next(notFound("Không tìm thấy bộ lọc này, hoặc đây không phải bộ lọc của bạn."));
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

filtersRouter.delete("/:id", async (req, res, next) => {
  try {
    const { cloudId, projectKey, accountId } = req.auth!.session;
    if (!(await filters.deleteFilter(cloudId, projectKey!, accountId, req.params.id))) {
      next(notFound("Không tìm thấy bộ lọc này, hoặc đây không phải bộ lọc của bạn."));
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
