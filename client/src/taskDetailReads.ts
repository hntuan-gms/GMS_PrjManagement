import { api } from "./api";
import { LIST_MAX_AGE_MS, TASK_MAX_AGE_MS, loadDetail } from "./detailCache";

/**
 * The reads behind the task panel, one name each, so the panel and the prefetch ask for the same thing
 * under the same cache key (detailCache). `null` for "no description" is an answer; undefined is not.
 */
export const readers = {
  description: (id: string) => api.getTaskDescription(id).then((r) => r.description),
  transitions: (id: string) => api.getTaskTransitions(id),
  attachments: (id: string) => api.getTaskAttachments(id),
  watchers: (id: string) => api.getTaskWatchers(id),
  comments: (id: string) => api.listComments(id),
  links: (id: string) => api.getIssueLinks(id),
};

export type TaskRead = keyof typeof readers;

/** The project-wide lists the panel's pickers use. Each is one Jira call, and they rarely change. */
export const projectLists = {
  priorities: () => api.listPriorities(),
  labels: () => api.listLabels(),
  components: () => api.listComponents(),
  versions: () => api.listVersions(),
  issueTypes: () => api.listIssueTypes(),
  linkTypes: () => api.listLinkTypes(),
};

export type ProjectList = keyof typeof projectLists;

/**
 * Start a task's reads before the panel opens (its row was just selected). Quiet: a failure is the
 * panel's to report when it asks for itself. Which reads: the ones the first screen of the panel shows.
 */
export function prefetchTaskDetail(id: string, includeDescription: boolean): void {
  const reads: TaskRead[] = ["transitions", "comments", "attachments", "watchers", "links"];
  if (includeDescription) reads.push("description");
  for (const r of reads) void loadDetail(r, id, () => readers[r](id) as Promise<unknown>, TASK_MAX_AGE_MS).catch(() => undefined);
}

/** The lists, once per ten minutes, ahead of the first panel. */
export function prefetchProjectLists(): void {
  for (const l of Object.keys(projectLists) as ProjectList[]) {
    void loadDetail(`list:${l}`, "", () => projectLists[l]() as Promise<unknown>, LIST_MAX_AGE_MS).catch(() => undefined);
  }
}
