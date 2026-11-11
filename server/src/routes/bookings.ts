/**
 * Booking: who is promised to which project, when, for how many hours a day.
 *
 * Site routes, not project routes: a booking view adds one person up across projects, so it does
 * not sit behind requireProject. requireAuth still covers it (apiRouter.use). The project a tab is
 * on is read only as a hint: its members get rows even before anyone books them.
 *
 * Every rule about who sees and writes what is in booking.ts (pure, tested); this file gathers the
 * facts those rules need from Jira and Postgres.
 */
import { Router, type Request } from "express";
import { resolveProject } from "../auth/projectScope.js";
import {
  canEditAbsence,
  canWrite,
  roleOf,
  shapeForViewer,
  validateBookingInput,
  validateBookingPatch,
  validateRange,
  visibleAccounts,
  type Viewer,
} from "../booking.js";
import * as bookings from "../bookingStore.js";
import { badRequest, bookingForbidden, notFound, projectNotAccessible } from "../errors.js";
import { namePeople } from "../peopleDirectory.js";
import { getProjectMembers } from "../projectMembers.js";
import { resolveViewer } from "../resourceRoles.js";
import * as resources from "../resourceStore.js";
import type { JiraUser } from "../types.js";

export const bookingsRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]{1,24}$/;

/** The project this tab is on, if any. Never an error: a booking view works with none. */
async function homeProject(req: Request): Promise<string | null> {
  const { jira, session } = req.auth!;
  try {
    return (await resolveProject(req, jira, session))?.key ?? null;
  } catch {
    return null;
  }
}

async function viewerFor(req: Request, candidates: Iterable<string>): Promise<{ viewer: Viewer; projects: Array<{ key: string; name: string }> }> {
  const { jira, session } = req.auth!;
  return resolveViewer(jira, session, candidates);
}

bookingsRouter.get("/", async (req, res, next) => {
  const { jira, session } = req.auth!;
  try {
    const { from, to } = validateRange(req.query.from, req.query.to);
    const scopeRaw = typeof req.query.project === "string" ? req.query.project.trim() : "";
    if (scopeRaw && !KEY_SHAPE.test(scopeRaw)) throw badRequest("Mã dự án không hợp lệ.");
    const scope = scopeRaw || null;

    const [all, home] = await Promise.all([bookings.listInRange(session.cloudId, from, to), homeProject(req)]);
    const candidates = new Set(all.map((b) => b.projectKey));
    if (home) candidates.add(home);
    if (scope) candidates.add(scope);
    const { viewer, projects } = await viewerFor(req, candidates);
    if (scope && !viewer.accessible.has(scope)) throw projectNotAccessible(scope);

    // The team of the project being looked at gets rows before anyone is booked, for those who may book it.
    const teamKey = scope ?? home;
    let team: JiraUser[] = [];
    if (teamKey && canWrite(viewer, teamKey)) {
      team = (await getProjectMembers(jira, session.cloudId, teamKey, session.accountId)).users;
    }
    const teamIds = team.map((u) => u.accountId);

    const visible = visibleAccounts(viewer, all, teamIds);
    const shown = new Set<string>([session.accountId]);
    if (scope) {
      // One project: its team and whoever is booked on it. Someone who does not manage it sees themselves.
      if (canWrite(viewer, scope)) {
        for (const id of teamIds) shown.add(id);
        for (const b of all) if (b.projectKey === scope) shown.add(b.accountId);
      }
    } else {
      for (const id of teamIds) shown.add(id);
      for (const b of all) if (visible === "all" || visible.has(b.accountId)) shown.add(b.accountId);
    }

    const views = shapeForViewer(viewer, all, visible).filter((b) => shown.has(b.accountId));
    const [profiles, absences, names] = await Promise.all([
      resources.listProfiles(session.cloudId),
      resources.listAbsences(session.cloudId, from),
      namePeople(jira, session.cloudId, [...shown], team),
    ]);
    const profileOf = new Map(profiles.map((p) => [p.accountId, p]));
    const people = [...shown].map((accountId) => {
      const p = profileOf.get(accountId);
      const n = names.get(accountId);
      return {
        accountId,
        displayName: n?.displayName ?? "Không rõ",
        avatarUrl: n?.avatarUrl ?? null,
        capacityHoursPerDay: p?.capacityHoursPerDay ?? resources.DEFAULT_CAPACITY_HOURS,
        role: p?.role ?? null,
        skills: p?.skills ?? [],
      };
    });
    people.sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));

    const referenced = new Set(views.map((b) => b.projectKey).filter((k): k is string => !!k));
    res.json({
      role: roleOf(viewer),
      me: session.accountId,
      from,
      to,
      scope,
      people,
      bookings: views,
      absences: absences.filter((a) => shown.has(a.accountId) && a.from <= to),
      // Projects worth naming: those in the rows, and those this viewer may book.
      projects: projects
        .filter((p) => referenced.has(p.key) || canWrite(viewer, p.key))
        .map((p) => ({ key: p.key, name: p.name, writable: canWrite(viewer, p.key) })),
      defaultCapacityHours: resources.DEFAULT_CAPACITY_HOURS,
    });
  } catch (err) {
    next(err);
  }
});

/** People of the site by name, for "+ Người". Only for those who can book someone. */
bookingsRouter.get("/people", async (req, res, next) => {
  const { jira } = req.auth!;
  try {
    const home = await homeProject(req);
    const { viewer } = await viewerFor(req, home ? [home] : []);
    if (roleOf(viewer) === "member") throw bookingForbidden("tìm người để book");
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const found = await jira.searchUsers(q, 20);
    res.json(
      found
        .filter((u) => u.accountType !== "app" && u.active !== false)
        .map((u) => ({ accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrls?.["24x24"] ?? null }))
    );
  } catch (err) {
    next(err);
  }
});

bookingsRouter.post("/", async (req, res, next) => {
  const { session } = req.auth!;
  try {
    const input = validateBookingInput(req.body);
    const { viewer } = await viewerFor(req, [input.projectKey]);
    if (!viewer.accessible.has(input.projectKey)) throw projectNotAccessible(input.projectKey);
    if (!canWrite(viewer, input.projectKey)) throw bookingForbidden();
    const created = await bookings.create(session.cloudId, session.accountId, input);
    res.status(201).json(shapeForViewer(viewer, [created], "all")[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * A booking the caller may not write is "not found", not "forbidden": the id alone must not confirm
 * that a project they cannot see has booked someone.
 */
async function writable(req: Request): Promise<{ viewer: Viewer; current: NonNullable<Awaited<ReturnType<typeof bookings.get>>> }> {
  const current = await bookings.get(req.auth!.session.cloudId, req.params.id);
  if (!current) throw notFound("Không tìm thấy booking này.");
  const { viewer } = await viewerFor(req, [current.projectKey]);
  if (!canWrite(viewer, current.projectKey)) throw notFound("Không tìm thấy booking này.");
  return { viewer, current };
}

bookingsRouter.patch("/:id", async (req, res, next) => {
  try {
    const { viewer, current } = await writable(req);
    const patch = validateBookingPatch(req.body, current);
    const updated = await bookings.update(req.auth!.session.cloudId, current.id, patch);
    if (!updated) throw notFound("Không tìm thấy booking này.");
    res.json(shapeForViewer(viewer, [updated], "all")[0]);
  } catch (err) {
    next(err);
  }
});

bookingsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { current } = await writable(req);
    await bookings.remove(req.auth!.session.cloudId, current.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Leave. The Resource lens edits it too, but only for a project admin; here a person enters their own.

function readAbsenceDates(body: Record<string, unknown>, need: boolean): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  for (const key of ["from", "to"] as const) {
    if (body[key] === undefined && !need) continue;
    if (typeof body[key] !== "string" || !ISO_DATE.test(body[key] as string)) throw badRequest("Ngày nghỉ phải ở dạng YYYY-MM-DD.");
    out[key] = body[key] as string;
  }
  return out;
}

const readReason = (raw: unknown): string | null | undefined =>
  typeof raw === "string" ? raw.trim().slice(0, 200) || null : raw === null ? null : undefined;

async function absenceViewer(req: Request): Promise<Viewer> {
  const home = await homeProject(req);
  return (await viewerFor(req, home ? [home] : [])).viewer;
}

bookingsRouter.post("/absences", async (req, res, next) => {
  const { session } = req.auth!;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : session.accountId;
    const { from, to } = readAbsenceDates(body, true);
    if (to! < from!) throw badRequest("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
    if (!canEditAbsence(await absenceViewer(req), accountId)) throw bookingForbidden("nhập nghỉ phép cho người khác");
    res.status(201).json(await resources.addAbsence(session.cloudId, accountId, from!, to!, readReason(body.reason) ?? null));
  } catch (err) {
    next(err);
  }
});

async function ownAbsence(req: Request) {
  const current = await resources.getAbsence(req.auth!.session.cloudId, req.params.id);
  if (!current || !canEditAbsence(await absenceViewer(req), current.accountId)) throw notFound("Không tìm thấy kỳ nghỉ này.");
  return current;
}

bookingsRouter.patch("/absences/:id", async (req, res, next) => {
  try {
    const current = await ownAbsence(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { from?: string; to?: string; reason?: string | null } = readAbsenceDates(body, false);
    const reason = readReason(body.reason);
    if (reason !== undefined) patch.reason = reason;
    res.json(await resources.updateAbsence(req.auth!.session.cloudId, current.id, patch));
  } catch (err) {
    next(err);
  }
});

bookingsRouter.delete("/absences/:id", async (req, res, next) => {
  try {
    const current = await ownAbsence(req);
    await resources.deleteAbsence(req.auth!.session.cloudId, current.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
