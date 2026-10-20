import express, { Router, type Request } from "express";
import { requireProject } from "../auth/middleware.js";
import { badRequest, describeError } from "../errors.js";
import { parseWorkbook } from "../kbkt/parse.js";
import { validateSettings } from "../kbkt/settings.js";
import { getSettings, saveSettings } from "../kbkt/settingsStore.js";
import { fileVersion } from "../kbkt/specs.js";
import { KbktSync, SyncAborted, type LogLine, type SyncOptions } from "../kbkt/sync.js";
import { XlsxFormatError } from "../kbkt/xlsx.js";

/**
 * Importing a KBKT test-case workbook (AI-33_1E127_….xlsx) into Jira — the
 * site's version of jira_sync.py. See kbkt/sync.ts for what a run does.
 *
 * Open to everyone who can open the project, not staff-only: it bills nothing
 * against a shared key, and every write is made with the user's own token, so
 * Jira's permissions are the real gate.
 *
 * Preview and apply take the same upload. Nothing is kept between the two: the
 * apply parses the file again and re-reads Jira, exactly like running the
 * script without and then with --apply.
 */
export const kbktRouter = Router();

kbktRouter.use(requireProject);

// Above the largest sample workbook (screenshots included) and below Cloud Run's 32 MB request cap.
const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything the settings panel's pickers need, read from this project rather than guessed. */
kbktRouter.get("/options", async (req, res, next) => {
  const { jira, session } = req.auth!;
  const projectKey = session.projectKey!;
  try {
    const [issueTypes, statuses, priorities, linkTypes] = await Promise.all([
      jira.getProjectIssueTypes(projectKey),
      jira.getProjectStatuses(projectKey),
      jira.getPriorities(),
      jira.getIssueLinkTypes().catch(() => []),
    ]);
    const epicTypes = issueTypes.filter((t) => (t.hierarchyLevel ?? (t.name.toLowerCase() === "epic" ? 1 : 0)) >= 1);
    const epics = epicTypes.length
      ? await jira.searchIssues(
          `project = "${projectKey}" AND issuetype in (${epicTypes.map((t) => `"${t.name.replace(/"/g, "")}"`).join(", ")}) ORDER BY key DESC`,
          ["summary"]
        )
      : [];
    res.json({
      issueTypes: issueTypes.map((t) => ({ name: t.name, subtask: !!t.subtask })),
      statuses: Object.fromEntries(statuses.map((s) => [s.name, s.statuses.map((x) => x.name)])),
      priorities: priorities.map((p) => p.name),
      linkTypes: linkTypes.map((l) => l.name),
      epics: epics.map((e) => ({ key: e.key as string, summary: String(e.fields?.summary ?? "") })),
    });
  } catch (err) {
    next(err);
  }
});

kbktRouter.get("/settings", async (req, res, next) => {
  const { session } = req.auth!;
  try {
    res.json(await getSettings(session.cloudId, session.projectKey!));
  } catch (err) {
    next(err);
  }
});

kbktRouter.put("/settings", async (req, res, next) => {
  const { session } = req.auth!;
  try {
    const settings = validateSettings(req.body);
    res.json(await saveSettings(session.cloudId, session.projectKey!, session.accountId, settings));
  } catch (err) {
    next(err);
  }
});

const rawWorkbook = express.raw({ type: () => true, limit: MAX_WORKBOOK_BYTES });

/** The upload, parsed, plus the run options from the query string — or a 400. */
async function readRun(req: Request): Promise<{
  fileName: string;
  wb: ReturnType<typeof parseWorkbook>;
  options: Omit<SyncOptions, "apply">;
}> {
  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) throw badRequest("Chưa có file Excel.");
  const rawName = String(req.get("x-file-name") ?? "kich-ban.xlsx");
  let fileName: string;
  try {
    fileName = decodeURIComponent(rawName);
  } catch {
    fileName = rawName;
  }
  let wb: ReturnType<typeof parseWorkbook>;
  try {
    wb = parseWorkbook(data);
  } catch (err) {
    if (err instanceof XlsxFormatError) throw badRequest(err.message);
    throw err;
  }
  const q = req.query as Record<string, unknown>;
  const one = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 255 ? v.trim() : null);
  const dueDate = one(q.dueDate);
  if (dueDate && !ISO_DATE.test(dueDate)) throw badRequest("Hạn hoàn thành phải có dạng YYYY-MM-DD.");
  // Absent → from the file name; "new" → always a new Story; otherwise an issue key.
  const story = one(q.story);
  const storyKey = story === null ? undefined : story.toLowerCase() === "new" ? null : story;
  if (storyKey && !/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(storyKey)) throw badRequest(`"${storyKey}" không phải mã issue.`);
  return {
    fileName: fileName.slice(0, 255),
    wb,
    options: { force: q.force === "1" || q.force === "true", epicRef: one(q.epic), storyKey, dueDate },
  };
}

/** Dry run: what an apply would do, as a list. Reads Jira, writes nothing. */
kbktRouter.post("/preview", rawWorkbook, async (req, res, next) => {
  const { jira, session } = req.auth!;
  try {
    const { fileName, wb, options } = await readRun(req);
    const settings = await getSettings(session.cloudId, session.projectKey!);
    const log: LogLine[] = [];
    const result = await new KbktSync(jira, session.projectKey!, settings, (l) => log.push(l)).run(wb, fileName, {
      ...options,
      apply: false,
    });
    res.json({ fileName, version: fileVersion(fileName), cases: wb.cases.length, bugs: wb.bugs.size, ...result, log });
  } catch (err) {
    next(err);
  }
});

/**
 * The real run, streamed as SSE so a hundred-issue workbook shows progress
 * instead of a spinner. Problems with the upload itself are still a plain 400;
 * once the stream has started, an error is an `error` event (the 200 is sent).
 * Closing the connection stops the run between two Jira calls — what is already
 * written stays, and applying the same file again carries on from there.
 */
kbktRouter.post("/apply", rawWorkbook, async (req, res, next) => {
  const { jira, session } = req.auth!;
  let run: Awaited<ReturnType<typeof readRun>>;
  let settings: Awaited<ReturnType<typeof getSettings>>;
  try {
    run = await readRun(req);
    settings = await getSettings(session.cloudId, session.projectKey!);
  } catch (err) {
    next(err);
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Cloud Run and any proxy in front of it will otherwise buffer the whole
  // response and deliver it in one lump.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // `res`, not `req`: a request's "close" fires as soon as its body is read.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });

  try {
    const result = await new KbktSync(jira, session.projectKey!, settings, (l) => send("log", l)).run(run.wb, run.fileName, {
      ...run.options,
      apply: true,
      signal: abort.signal,
    });
    send("done", { fileName: run.fileName, ...result });
  } catch (err) {
    if (!(err instanceof SyncAborted)) {
      const { error, code } = describeError(err);
      send("error", { message: error, code });
    }
  } finally {
    res.end();
  }
});
