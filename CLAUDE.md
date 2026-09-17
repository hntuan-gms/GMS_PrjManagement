# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MS-Project-style planner (Gantt + WBS + dependencies + resource view) layered on top of a Jira Cloud project (default `HHBJ` on `gimasys.atlassian.net`), with two-way sync. `server/` is Express + TypeScript (ESM), `client/` is React 19 + Vite. UI strings and README are Vietnamese — keep new user-facing strings Vietnamese.

## Commands

```bash
# Dev — two processes
cd server && npm install && npm run dev     # tsx watch, API on :4000
cd client && npm install && npm run dev     # Vite on :5173

cd client && npm run lint                   # oxlint (the only linter; no server lint)
cd client && npm run build                  # tsc -b && vite build
cd server && npm run build                  # tsc -> server/dist

./deploy.sh                                 # build both, serve UI+API from :4000 on one process
docker compose up -d --build                # same, containerised; overlay.json in volume gms-data
```

There is **no test framework and no test script** in either package. The one test pass on record (`docs/test-reports/2026-09-11-jira-two-way-sync.md`) was manual `curl` against a live Jira. To verify a change, hit the API directly, e.g. `curl localhost:4000/api/tasks`, `curl -X PATCH localhost:4000/api/tasks/HHBJ-8 -H 'Content-Type: application/json' -d '{"startDate":"2026-09-20"}'`.

`client/.npmrc` sets `legacy-peer-deps=true` — `gantt-task-react` declares an old React peer range. Don't remove it.

## Architecture

### Two data sources merged per task

A `Task` (`server/src/types.ts`) = one Jira issue + a local "overlay" record, joined in `TaskService.hydrate()`:

| Owned by Jira (read/write via REST v3) | Owned by the local overlay (`lowdb`, `data/overlay.json`) |
|---|---|
| summary, issuetype, status, assignee, parent | durationDays, percentComplete, predecessors, baselineStart/Due |
| `duedate` — always derived as start + duration and pushed back on every schedule edit | |
| `customfield_10059` "Start date" (`JIRA_START_DATE_FIELD_ID`) when the project has one | startDate, when the project has no Start date field |

`hydrate()` is where the two reconcile, and the precedence matters: if Jira has a Start date value it **wins** over the overlay (and duration is recomputed from it against `duedate`); if it doesn't, an out-of-band `duedate` edit made directly in Jira shifts the overlay start to match while preserving duration. Both branches exist because of real bugs (BUG-02, BUG-03 in the test report) — don't simplify them away.

The overlay file lives at `process.cwd()/data/overlay.json`, so it resolves to `server/data/` in dev and `/app/data/` (volume-mounted) in Docker. Overlay keys are Jira issue keys; `store.deleteOverlay()` also strips the id from every other task's predecessor list.

### Mock mode vs live mode

If any of `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` / `JIRA_PROJECT_KEY` is missing, `loadJiraConfig()` returns null and `TaskService` runs against an in-memory copy of `server/src/mockData.ts` instead. **Every mutating method in `TaskService` has both branches** (`if (this.jira && this.cfg) … else …`) — a change to create/update/delete/cascade must be made in both or mock mode silently diverges. `GET /api/meta` reports which mode is active; the client renders it as a badge.

### Dependency cascade

`TaskService.applyDependencyCascade()` runs after any schedule or predecessor change. It is a BFS, forward-only propagation (not a full CPM with a backward pass). Each visited node **first re-checks its own start against its own predecessors** before pushing successors — that self-check is the fix for BUG-06 (adding a new predecessor otherwise left the task itself in violation). FS/SS/FF/SF each have a distinct earliest-start formula; FF/SF subtract `durationDays - 1`.

### Date handling

All dates are `YYYY-MM-DD` strings. Server arithmetic (`addDays`, `diffDaysInclusive` in `taskService.ts`) is UTC-based. The client must **not** use `toISOString()` on a local-midnight `Date` — in UTC+7 that rolls back a day (BUG-04). `GanttView.toIso()` uses local getters deliberately; `TaskEditModal` computes in UTC to match the server. Duration is inclusive: due = start + duration − 1.

### Client structure

`App.tsx` holds all state (tasks, users, collapse set, modals) and passes callbacks down; there is no router or state library. After any mutation it calls `refreshTasks()` on top of the optimistic single-task update, because a cascade can move *other* tasks server-side.

WBS hierarchy is ours, not the Gantt library's: `ganttMapping.orderByWbs()` does the depth-first ordering and `toGanttTasks()` emits every row as `type: "task"` — `gantt-task-react`'s own project/child aggregation is bypassed, and the tree is rendered by the custom `TaskListHeader`/`TaskListTable` components inside `GanttView`. Tasks without a `startDate` are dropped from the chart.

`api.ts` resolves the base URL from `VITE_API_BASE`, falling back to `http://localhost:4000/api` in dev and same-origin `/api` in production (where Express serves `server/public`).

## Known constraint

`STATUS_OPTIONS` in `client/src/components/TaskEditModal.tsx` is a hard-coded list (Backlog/To Do/In Progress/Done). Real HHBJ workflow transitions are *Backlog, Selected for development, In Progress, Done*, so "To Do" fails (BUG-05, open). The fix is undecided: hard-code the real list, or fetch per-issue via `GET /rest/api/3/issue/:id/transitions` (`JiraClient.getTransitions()` already exists).
