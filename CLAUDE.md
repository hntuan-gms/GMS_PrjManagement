# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MS-Project-style planner (Gantt + WBS + dependencies + resource view) layered on Jira Cloud, with two-way sync. Each user logs in with their own Atlassian account via OAuth 2.0 (3LO) and picks a project they can browse — there is no shared service credential and no mock mode. `server/` is Express + TypeScript (ESM), `client/` is React 19 + Vite. UI strings and README are Vietnamese — keep new user-facing strings Vietnamese.

## Commands

```bash
# Schedule data lives in the `gms` database on the shared Cloud SQL instance
# bof-intern:asia-southeast1:intern-portal-db, alongside — but isolated from —
# the intern portal's own `intern_db` and `hnxcis`. One-time GCP wiring (database,
# user, Secret Manager entry, two IAM grants):
powershell -ExecutionPolicy Bypass -File scripts/setup-gcp-db.ps1

# Deploying is what applies it. .github/workflows/deploy.yml is the SOLE source of
# truth for the service's environment (env_vars_update_strategy: overwrite), so
# anything set on the service by hand is reverted on the next push to main.
git push origin main

# Dev — two processes; browse localhost:5173, NOT :4000
cd server && npm install && npm run dev     # tsx watch, API on :4000
cd client && npm install && npm run dev     # Vite on :5173, proxies /api to :4000

# Local dev needs its own DATABASE_URL and currently has none: this machine's IP
# is not in the instance's authorized networks, and adding it means changing
# firewall rules on an instance two other apps depend on. To bring local dev back,
# run the Cloud SQL Auth Proxy and point DATABASE_URL at localhost:5432:
#   cloud-sql-proxy bof-intern:asia-southeast1:intern-portal-db
cd server && npm run db:migrate             # optional, boot does it too
cd server && npm run db:import-overlay      # one-off: old data/overlay.v2.json -> Postgres

cd client && npm run lint                   # oxlint (the only linter; no server lint)
cd client && npm run build                  # tsc -b && vite build
cd server && npm run build                  # tsc -> server/dist

./deploy.sh                                 # build both, serve UI+API from :4000 on one process
docker compose up -d --build                # same, containerised
```

Dev goes through the Vite proxy so it is same-origin with the API and the session cookie behaves exactly as in production. Hitting `:4000` directly, or pointing `VITE_API_BASE` at another origin, breaks login — the cookie is `SameSite=Lax` and won't be sent cross-site. The symptom is "login succeeds, then bounces straight back to the login screen".

The server **exits at boot** if `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEYS`, `APP_BASE_URL` or `DATABASE_URL` is missing, or if the database is unreachable. That is deliberate: with mock mode gone there is no degraded path worth starting.

There is **no test framework and no test script** in either package. The one test pass on record (`docs/test-reports/2026-09-11-jira-two-way-sync.md`) predates OAuth. API calls now require a session cookie, so `curl` needs a cookie jar (`-b`/`-c`) or you verify in the browser.

`client/.npmrc` sets `legacy-peer-deps=true` — `gantt-task-react` declares an old React peer range. The Dockerfile must copy it before `npm ci` or the image build fails; that's why [Dockerfile:8](Dockerfile#L8) lists it explicitly.

## Architecture

### Two data sources merged per task

A `Task` (`server/src/types.ts`) = one Jira issue + a local "overlay" record, joined in `TaskService.hydrate()`:

| Owned by Jira (read/write via REST v3) | Owned by the overlay (Postgres, `task_overlay` + `task_dependency`) |
|---|---|
| summary, issuetype, status, assignee, parent | durationDays, percentComplete, predecessors, baselineStart/Due |
| `duedate` — always derived as start + duration and pushed back on every schedule edit | |
| the site's "Start date" custom field, **discovered per site** | startDate, when the site has no such field |

Only the overlay column is unrecoverable: Jira issue links carry no FS/SS/FF/SF type and no lag, Jira has no baseline concept, and standard issues have no % field. Lose the database and dates come back from Jira while the dependency graph and baselines do not.

`hydrate()` is where the two reconcile, and the precedence matters: if Jira has a Start date value it **wins** over the overlay (and duration is recomputed from it against `duedate`); if it doesn't, an out-of-band `duedate` edit made directly in Jira shifts the overlay start to match while preserving duration. Both branches exist because of real bugs (BUG-02, BUG-03 in the test report) — don't simplify them away.

**`customfield_10059` is no longer hard-coded.** It is HHBJ-specific; on another site that ID is absent or an unrelated field, and writing a date into it would be silent corruption. `server/src/fieldDiscovery.ts` resolves it per cloudId via `GET /rest/api/3/field` and caches for an hour. When it returns `null`, writes must **omit** the field — `hydrate()`'s duedate-only branch is then the designed path, not a fallback.

Every table is keyed by the Atlassian **cloudId**, because two sites can both contain an issue called ABC-1 and `Predecessor.taskId` is a bare issue key on the wire. `store.deleteOverlay()` clears edges in both directions **within that scope only**.

Dependencies are one row per edge in `task_dependency`, not a JSON array on the successor: the cascade's hot question is "who depends on X?", which an array can only answer by scanning every task. `hasSuccessors()` is an index lookup on `(cloud_id, predecessor_key)`, and it is what lets `updateTask` skip the whole cascade — including its project-wide Jira search — for a task with no dependency edges, which is most drags.

`store` is deliberately **batch-first**: `getProjectOverlays()` loads a whole project in two queries and `setOverlays()` writes many rows in one. A per-task read was free against the old JSON file but is a round trip against Postgres, so `listTasks()` reconciles in memory and persists once — `reconcile()` is pure for exactly that reason, with the write left to its caller.

### Authentication

`server/src/auth/` holds the whole OAuth layer. Sessions are **stateless sealed cookies** (AES-256-GCM via `node:crypto` — no new dependencies) rather than a server-side map, because Cloud Run replaces the container on every deploy and scales to zero, so in-memory sessions would log everyone out several times a day.

Three things there are load-bearing and easy to "harden" into an outage:

- **`SameSite=Lax`, never `Strict`.** The OAuth callback is a top-level cross-site navigation from `auth.atlassian.com`; `Strict` withholds the cookie and every single login fails the state check.
- **Refresh happens eagerly in `requireAuth`, before `next()`.** Atlassian rotates refresh tokens, and `res.cookie()` after `res.json()` is a silent no-op — dropping a rotated token logs the user out on their next request with no way to diagnose it. `auth/tokens.ts` also single-flights concurrent refreshes and keeps a ~120s grace cache for the window where a second request still carries the pre-rotation cookie.
- **`requireAuth` is mounted with `apiRouter.use`**, so a route added later is protected by default. The Cloud Run service is publicly invokable — it has to be, or the callback navigation is rejected by IAM before Express runs — which makes this middleware plus `ALLOWED_EMAIL_DOMAIN` the only access control in front of Jira.

`TaskService` is constructed **per request** from the session. There is no module-level singleton and no process-wide Jira identity.

### Dependency cascade

`TaskService.applyDependencyCascade()` runs after any schedule or predecessor change. It is a BFS, forward-only propagation (not a full CPM with a backward pass). Each visited node **first re-checks its own start against its own predecessors** before pushing successors — that self-check is the fix for BUG-06 (adding a new predecessor otherwise left the task itself in violation). FS/SS/FF/SF each have a distinct earliest-start formula; FF/SF subtract `durationDays - 1`.

Jira write failures during a cascade are collected and returned as `cascadeWarnings` rather than swallowed, except a 401 which is re-thrown — a revoked token used to leave the overlay and Jira permanently and silently divergent.

### Date handling

All dates are `YYYY-MM-DD` strings. Server arithmetic (`addDays`, `diffDaysInclusive` in `taskService.ts`) is UTC-based. The client must **not** use `toISOString()` on a local-midnight `Date` — in UTC+7 that rolls back a day (BUG-04). `GanttView.toIso()` uses local getters deliberately; `TaskEditModal` computes in UTC to match the server. Duration is inclusive: due = start + duration − 1.

### AI planner

`server/src/ai/` turns a plain-language brief into a work breakdown. One Gemini call (`@google/genai`, `GEMINI_API_KEY`, shared with the video-agent service), then everything numeric is computed here rather than asked for.

The split is the design: **the model decides semantics, this code decides every number.** It returns tasks, durations in days, FS/SS/FF/SF edges and an assignee; `planner.layoutSchedule()` derives the actual dates from those durations and the graph, using the same earliest-start rules as `applyDependencyCascade`, so the preview a reviewer approves is what the live cascade will enforce. Asking a model for dates gets you a schedule that contradicts its own dependency list.

`responseSchema` (constrained decoding) guarantees the *shape*, never the meaning, so `normalize()` re-checks everything that only fails later: an issue type this project doesn't have (validated against `listIssueTypes()`, not the hard-coded `IssueTypeName` union), an assignee who isn't on the team, an edge pointing at a `tempId` the model never emitted, and cycles — each corrected and surfaced to the reviewer as a warning rather than silently accepted or thrown away.

**Nothing reaches Jira without a human.** Generation writes to `ai_plan_run`/`ai_plan_item` only; `POST /api/ai/plans/:id/apply` is the sole route that creates issues, in two passes — parents before children (Jira rejects an unborn parent key), then dependencies once every `tempId` resolves to a real issue key. Partial failure is reported per row, not rolled back: issues already created in Jira cannot be unmade, so the run stays `proposed` and the applied rows carry `applied_issue_key`.

Not built yet: PRD/BRD upload with RAG. `pgvector` is why Postgres was chosen and why docker-compose uses the `pgvector/pgvector` image, but no vector tables exist.

### Client structure

`App.tsx` is a ~50-line auth shell: `useSession()` runs before any branch (keeping `react/rules-of-hooks` satisfied), then it renders `LoginScreen`, `ProjectPicker` or `ProjectWorkspace`. There is no router — the OAuth callback is a *server* route, so the browser never sees `?code=`, only an optional `?auth_error=`.

`ProjectWorkspace` holds all the project state and is keyed on the project key, so switching project remounts the subtree and discards tasks/users/collapse/selection rather than resetting seven fields by hand. After any mutation it calls `refreshTasks()` on top of the optimistic single-task update, because a cascade can move *other* tasks server-side.

`api.ts` sends `credentials: "include"` on every call and routes 401s through a module-level handler so any failed call pulls the app back to the login screen. A 403 must **not** log out: Jira returns 401 for a dead token and 403 for a permission problem, and `server/src/errors.ts` preserves that distinction across the whole API.

WBS hierarchy is ours, not the Gantt library's: `ganttMapping.orderByWbs()` does the depth-first ordering and `toGanttTasks()` emits every row as `type: "task"` — `gantt-task-react`'s own project/child aggregation is bypassed, and the tree is rendered by the custom `TaskListHeader`/`TaskListTable` components inside `GanttView`. Tasks without a `startDate` are dropped from the chart.

## Known constraints

- `STATUS_OPTIONS` in `client/src/components/TaskEditModal.tsx` is a hard-coded list (Backlog/To Do/In Progress/Done). Real HHBJ workflow transitions are *Backlog, Selected for development, In Progress, Done*, so "To Do" fails (BUG-05, open). `JiraClient.getTransitions()` already exists if you want to fetch them per issue.
- `IssueTypeName` is a hard-coded union (`Epic|Story|Task|Bug|Sub-task`). Team-managed projects rename or omit these, so `createIssue` will 400 on the first project that does.
- Cross-project predecessors are rejected with a 400. The cascade only loads issues from the session's project, so a foreign key would appear to exist while never being enforced.
- An overlay-only PATCH (%, predecessors, baselines) touches no Jira field. `updateTask` does a `getIssue` visibility check in that case so a user who cannot see the issue cannot rewrite shared schedule data, but there is no write-level permission check.
- A cascade is several statements, not one transaction, so two concurrent cascades over the same tasks can still interleave — but each individual write is now atomic, which is what `--max-instances=1` used to be standing in for.
- Logout is local only — Atlassian publishes no endpoint to revoke a 3LO refresh token. Don't imply otherwise in UI copy.
