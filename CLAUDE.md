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

`TaskService.applyDependencyCascade()` runs after any schedule or predecessor change. It is a BFS that keeps every successor at its earliest allowed start (ASAP) — not just "no earlier than allowed": moving a predecessor earlier now pulls a successor backward too, **but only if that successor had zero slack** against the specific edge that moved (its start exactly equalled the old bound). A successor with an intentional gap keeps it; only one that was riding right behind its predecessor gets dragged along. This still isn't a full CPM backward pass — it moves what was touching a boundary, not everything that theoretically could shift — and it works by comparing against `priorState`, each touched task's position from the instant before this cascade run first touched it. Each visited node **first re-checks its own start against its own predecessors** before pushing successors — that self-check is the fix for BUG-06 (adding a new predecessor otherwise left the task itself in violation), and it doubles as the safety net for a tentative backward pull: if some other predecessor still requires a later start, this pushes the pulled successor back forward once it's dequeued. FS/SS/FF/SF each have a distinct earliest-start formula (`earliestStartFor` in `taskService.ts`, mirrored client-side in `dependencyCascade.ts` for the optimistic-drag preview); FF/SF subtract `durationDays - 1`.

Jira write failures during a cascade are collected and returned as `cascadeWarnings` rather than swallowed, except a 401 which is re-thrown — a revoked token used to leave the overlay and Jira permanently and silently divergent.

### Date handling

All dates are `YYYY-MM-DD` strings. Server arithmetic (`addDays`, `diffDaysInclusive` in `taskService.ts`) is UTC-based. The client must **not** use `toISOString()` on a local-midnight `Date` — in UTC+7 that rolls back a day (BUG-04). `GanttView.toIso()` uses local getters deliberately; `TaskEditModal` computes in UTC to match the server. Duration is inclusive: due = start + duration − 1.

### Assistant (chat)

`ChatDock` docks bottom-right, collapsed to a pill. Planning is a **tool the assistant calls**, not a separate mode: "chia việc giúp tôi" and "dự án trễ mấy task?" are the same kind of request from the user's side, and making them pick a mode first pushes the classification onto them.

`POST /api/ai/chat` streams **SSE** (`fetch` + manual parsing client-side, since `EventSource` can only GET and the message belongs in a body). `X-Accel-Buffering: no` is required or Cloud Run buffers the whole response and delivers it in one lump. Errors after the first byte go down the stream as an `error` event — the 200 is already sent.

Reasoning streams separately from the answer (`thinkingConfig.includeThoughts`, parts flagged `thought`) and renders above it, collapsed. The first token of a real answer can be ten seconds away when the model is thinking or building a plan, and a blank panel for that long reads as a hang.

Project state is injected into the system prompt rather than fetched by a tool — cheaper than a round trip at this size, and simple questions answer in one call. The snapshot is capped and drops `done` tasks first.

Token usage is stored **per message**, with Gemini's four counters kept in separate columns (`prompt`/`output`/`thought`/`cached`). They price differently, so a single total can't be turned back into money, and a session's cost is only attributable if each turn is stored on its own.

### Assignment without a skills matrix

`resource_profile` is the declared answer to "who does what", and until someone opens the Nguồn lực tab and fills it in it is empty. `ai/roleEvidence.ts` derives evidence from the project's own Jira history instead — which issues each person was assigned, and the words in those summaries. It reports evidence ("12 issues, words: api, endpoint"), never a conclusion ("Backend Developer"): a keyword count is weak, and a job title would hide how weak. The prompt tells the model to leave `assigneeAccountId` **empty** when nothing clearly fits — an unassigned task a human fills in beats a confident wrong assignment.

### Resource view

**Who counts as a team member is its own problem** (`server/src/projectMembers.ts`). `/user/assignable/search?project=KEY` looks project-scoped but answers "who holds the *Assignable User* permission", which on a company-managed site is granted site-wide — a five-person project lists everyone with a licence, capped at 100 with no paging. Jira's declared answer is the project's **roles** (what an admin edits under Project settings → People), so that is tried first: `GET /project/{key}/role`, then each role's actors, expanding group actors via `/group/member` (roles are usually granted to a group, so without that expansion a role read returns a group name and no humans). The role URLs Jira returns are absolute **site** URLs, not gateway ones — only the trailing role id is usable.

The fallback is **not optional**: reading project roles requires *Administer Projects* on that project, and every user here logs in as themselves, so a 403 is the ordinary case for a developer, not an error. It degrades to assignable users and reports which one you got in `memberSource`, because "why is this stranger in my team list" has no answer on screen otherwise. Cached 5 minutes per (cloudId, projectKey) — resolving it costs one call per role plus one per group.

`resource_profile` and `resource_absence` (both via `server/src/resourceStore.ts`, exposed as `/api/resources`) hold the only two things Jira has no field for: how many hours a day a person actually has, and when they are away. Everything else about a person — name, avatar, account id — comes from Jira on each load, so the tab is never a second, staling copy of Jira's directory. A person with no row gets `DEFAULT_CAPACITY_HOURS`, which makes an empty table a valid state rather than a setup step.

**The load itself is computed on the client** (`client/src/resourceAllocation.ts`), from tasks `ProjectWorkspace` already holds. That is the whole reason it lives there: the heatmap has to recolour while a Gantt bar is still under the cursor, and a round trip per drag would reintroduce exactly the lag the cascade work removed. `buildResourceLoad()` produces one `DayLoad` per person per day, and the heatmap, the per-person grid and the toolbar badge are all views over that same array — a colour and a number can't disagree.

Demand per day is `estimateHours / working days in the task's span`, falling back to a full working day when Jira has no `timeoriginalestimate` (most tasks). The fallback is what stops the sub-50% band from being dead code on a team that doesn't estimate. The rate is derived from the task's **whole** span, not the visible window, or scrolling the heatmap would change how loaded someone looks. Weekends and absence days have zero capacity; work landing on one is its own band (`off-violation`), louder than "busy", because nobody is going to do it.

Two deliberate departures from a naive reading of "show who's overloaded":
- **Four non-overlapping bands**, split at 50%: "green under 100%, yellow under 50%" overlap, and a 30% day would be both. Yellow means "has room for more work", which is a different message from green.
- **`percentComplete` does not scale demand.** It's an overlay field most teams never fill in, and halving someone's load off a number nobody maintains hides real overload. Tasks Jira calls *done* drop out entirely — a finished task is not a claim on anyone's time.

`findOverlaps()` survives alongside the hours model because it answers a different question: two half-day tasks on the same day are not an overload, but they are still two things at once, and the detail grid marks them.

### AI planner

`server/src/ai/` turns a plain-language brief into a work breakdown. One Gemini call (`@google/genai`, `GEMINI_API_KEY`, shared with the video-agent service), then everything numeric is computed here rather than asked for.

The split is the design: **the model decides semantics, this code decides every number.** It returns tasks, durations in days, FS/SS/FF/SF edges and an assignee; `planner.layoutSchedule()` derives the actual dates from those durations and the graph, using the same earliest-start rules as `applyDependencyCascade`, so the preview a reviewer approves is what the live cascade will enforce. Asking a model for dates gets you a schedule that contradicts its own dependency list.

`responseSchema` (constrained decoding) guarantees the *shape*, never the meaning, so `normalize()` re-checks everything that only fails later: an issue type this project doesn't have (validated against `listIssueTypes()`, not the hard-coded `IssueTypeName` union), an assignee who isn't on the team, an edge pointing at a `tempId` the model never emitted, and cycles — each corrected and surfaced to the reviewer as a warning rather than silently accepted or thrown away.

**Nothing reaches Jira without a human.** Generation writes to `ai_plan_run`/`ai_plan_item` only; `POST /api/ai/plans/:id/apply` is the sole route that creates issues, in two passes — parents before children (Jira rejects an unborn parent key), then dependencies once every `tempId` resolves to a real issue key. Partial failure is reported per row, not rolled back: issues already created in Jira cannot be unmade, so the run stays `proposed` and the applied rows carry `applied_issue_key`.

The model is `GEMINI_MODEL` (default in `planner.ts`), and it must be set as a **repo variable** in the deploy workflow — `env_vars_update_strategy: overwrite` means a value set on the Cloud Run service by hand is wiped on the next deploy. `GET /api/ai/models` lists what the key can actually call, filtered to `generateContent`: model names are added and retired continuously, so a list written into source or docs is wrong within weeks, and a stale `GEMINI_MODEL` surfaces as a 404 on the next plan rather than at deploy time.

Not built yet: PRD/BRD upload with RAG. `pgvector` is why Postgres was chosen and why docker-compose uses the `pgvector/pgvector` image, but no vector tables exist.

### Gantt rendering reaches into gantt-task-react's own DOM

`gantt-task-react` (pinned `^0.3.9`) exposes no prop for two things this app needed, so `GanttView.tsx` reaches into its rendered SVG directly instead — the same technique `DependencyOverlay.tsx` already used for drawing FS/SS/FF/SF arrows:

- **Day-view labels.** The library always renders "Th 2, 15" (weekday + day) with no way to ask for just the day number, and at a fixed pixel width regardless of zoom. A `MutationObserver` finds every calendar-header `<text>` — queried across `bodyEl`'s whole subtree, **not** scoped to "the first `<svg>`" first: gantt-task-react renders the calendar header and the bar grid as two separate sibling `<svg>` elements (`TaskGantt`'s JSX), and grabbing the wrong one silently finds nothing (this was a real bug: the label never shrank because `querySelector("svg")` wasn't reliably the header one). Matched by the compiled CSS module class (`_9w8d5` — coupled to the exact installed version; if a bump changes it, the effect just no-ops and the old format reappears, not a crash), trimmed to its trailing day number, and blanked on every Nth label once `columnWidth` is too narrow for all of them to fit without overlapping.
- **Bar label contrast.** The library hard-codes white fill (`._3zRJQ`) for text drawn inside a bar. Every bar background here is a light pastel (see below), so white-on-pastel is low-contrast — overridden globally in `App.css` with `!important`, since there's no per-task hook to win the cascade otherwise.

**Zoom is one continuous variable, `pixelsPerDay`, not per-mode column widths.** `pickScale()` in `GanttView.tsx` derives *both* which of Day/Week/Month is showing *and* that mode's `columnWidth` from it — there is no separate viewMode state to fall out of sync with the width. A column's width is always `pixelsPerDay * daysPerColumn(mode)` (Day=1, Week=7, Month≈30.4, from the library's own `seedDates`), so the same zoom gesture shrinks every mode's columns at the same rate, and whichever mode's resulting width first lands inside `[MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]` — preferring the finest granularity that still fits — is the one rendered. That's the auto Day→Week→Month handoff as you zoom out (and back as you zoom in), with no separate threshold logic outside this one function. The Day/Week/Month buttons just jump `pixelsPerDay` to that mode's old fixed default (`DEFAULT_PIXELS_PER_DAY`), landing exactly where the buttons always used to.

A native (non-passive) `wheel` listener on `.gantt-body` — not React's `onWheel`, which React attaches passively by default, where `preventDefault()` is silently ignored — checks `e.ctrlKey` (how browsers report trackpad pinch, specifically so a page can override the browser's own page-zoom) and adjusts `pixelsPerDay`. Row height is untouched, so vertical scale never moves.

**An Epic's bar is always its children's min/max span**, even when the Epic issue itself carries its own Jira dates — `resolveRanges()` in `ganttMapping.ts` checks Epic-with-children before checking the task's own `startDate`, the opposite priority from every other WBS parent (a Story with sub-tasks keeps its own dates as authoritative, per the BUG already documented there). Dragging is disabled (`isDisabled` in `toGanttTasks()`) for an Epic that has children, since its bar would just snap back to the rollup on the next render otherwise; a childless Epic stays draggable.

**Bar colours are a hash of the task id into a fixed hue palette** (`PALETTE_HUES` in `ganttMapping.ts`) — "random" meaning varied per task and stable across renders, not re-rolled each time. Saturation and lightness are fixed and only hue varies, which is the actual mechanism for "random but harmonious": any two neighbours still read as one matched set. Bug keeps its old fixed red (worth being able to spot at a glance across a hundred bars) and Epic gets a bolder, more saturated version of its own hash-hue rather than a fully separate colour.

### Client structure

`App.tsx` is a ~50-line auth shell: `useSession()` runs before any branch (keeping `react/rules-of-hooks` satisfied), then it renders `LoginScreen`, `ProjectPicker` or `ProjectWorkspace`. There is no router — the OAuth callback is a *server* route, so the browser never sees `?code=`, only an optional `?auth_error=`.

`ProjectWorkspace` holds all the project state and is keyed on the project key, so switching project remounts the subtree and discards tasks/users/collapse/selection rather than resetting seven fields by hand. After any mutation it calls `refreshTasks()` on top of the optimistic single-task update, because a cascade can move *other* tasks server-side.

`api.ts` sends `credentials: "include"` on every call and routes 401s through a module-level handler so any failed call pulls the app back to the login screen. A 403 must **not** log out: Jira returns 401 for a dead token and 403 for a permission problem, and `server/src/errors.ts` preserves that distinction across the whole API.

Selection is file-manager style: click selects one, Ctrl/Cmd toggles, Shift extends a range measured in the **visible row order** (post-filter, post-collapse) — see `GanttView`'s `onSelect`. A global `keydown` in `ProjectWorkspace` handles Escape: closes the edit modal if one is open, otherwise clears the selection, never both at once.

`server/src/adf.ts`'s `textToAdf()` wraps a bare `http(s)` URL in ADF's `link` mark rather than leaving it as plain text — a link pasted in from an import file (an image URL, a shared doc) needs to land in Jira as something clickable. The link lives on the issue's `description` field only, never in the overlay/database.

WBS hierarchy is ours, not the Gantt library's: `ganttMapping.orderByWbs()` does the depth-first ordering and `toGanttTasks()` emits every row as `type: "task"` — `gantt-task-react`'s own project/child aggregation is bypassed, and the tree is rendered by the custom `TaskListHeader`/`TaskListTable` components inside `GanttView`. Tasks without a `startDate` are dropped from the chart.

## Known constraints

- `STATUS_OPTIONS` in `client/src/components/TaskEditModal.tsx` is a hard-coded list (Backlog/To Do/In Progress/Done). Real HHBJ workflow transitions are *Backlog, Selected for development, In Progress, Done*, so "To Do" fails (BUG-05, open). `JiraClient.getTransitions()` already exists if you want to fetch them per issue.
- `IssueTypeName` is a hard-coded union (`Epic|Story|Task|Bug|Sub-task`). Team-managed projects rename or omit these, so `createIssue` will 400 on the first project that does.
- Cross-project predecessors are rejected with a 400. The cascade only loads issues from the session's project, so a foreign key would appear to exist while never being enforced.
- An overlay-only PATCH (%, predecessors, baselines) touches no Jira field. `updateTask` does a `getIssue` visibility check in that case so a user who cannot see the issue cannot rewrite shared schedule data, but there is no write-level permission check.
- A cascade is several statements, not one transaction, so two concurrent cascades over the same tasks can still interleave — but each individual write is now atomic, which is what `--max-instances=1` used to be standing in for.
- Logout is local only — Atlassian publishes no endpoint to revoke a 3LO refresh token. Don't imply otherwise in UI copy.
