import { Router } from "express";
import { LINK_FIELDS, linkSearchJql, toSuggestions } from "../linkSearch.js";

/**
 * GET /api/link-suggestions?q= — the link box's list (linkSearch.ts). A site route: the history crosses
 * projects, and Jira decides with the caller's own token what is in it.
 */
export const linksRouter = Router();

linksRouter.get("/", async (req, res, next) => {
  const { jira, session } = req.auth!;
  try {
    const jql = linkSearchJql(String(req.query.q ?? ""));
    if (!jql) {
      res.json([]);
      return;
    }
    const found = await jira.searchIssues(jql, LINK_FIELDS, 8);
    res.json(toSuggestions(found, session.siteUrl));
  } catch (err) {
    next(err);
  }
});
