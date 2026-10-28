import { JiraApiError } from "../src/jiraClient.js";

/**
 * A Jira that keeps issues in memory — enough of one to prove what a dry run
 * and an apply do, and that a second apply of the same file does nothing.
 * It proves the sync's own logic, never Jira's behaviour. Shared by the unit
 * tests and the e2e stand-in API (e2e/mock-api.mts).
 */
export class FakeJira {
  issues = new Map<string, any>();
  calls: string[] = [];
  private seq = 100;
  private initial: Record<string, string> = { "Sub Testcase": "Not run", "Sub Bug": "To Do", Story: "To Do" };
  private flow: Record<string, string[]> = {
    "not run": ["Passed", "Failed", "Pending"],
    "to do": ["Done", "In Progress"],
    passed: ["Failed", "Pending"],
    failed: ["Passed", "Pending"],
    pending: ["Passed", "Failed"],
    done: ["To Do"],
  };

  constructor(private readonly project = "AI") {
    this.issues.set(`${project}-1`, {
      key: `${project}-1`,
      fields: { summary: "Đợt 1", issuetype: { name: "Epic", hierarchyLevel: 1 }, labels: [] },
    });
  }

  async getIssue(key: string) {
    this.calls.push(`getIssue ${key}`);
    const issue = this.issues.get(key);
    if (!issue) throw new JiraApiError(404, '{"errorMessages":["Issue does not exist"]}');
    return structuredClone(issue);
  }

  async searchIssues(jql: string) {
    this.calls.push("search");
    const label = /labels = "([^"]+)"/.exec(jql)?.[1];
    return [...this.issues.values()].filter((i) => (i.fields.labels ?? []).includes(label)).map((i) => structuredClone(i));
  }

  async getProjectIssueTypes() {
    return [
      { id: "1", name: "Epic", subtask: false, hierarchyLevel: 1 },
      { id: "2", name: "Story", subtask: false, hierarchyLevel: 0 },
      { id: "3", name: "Sub Testcase", subtask: true, hierarchyLevel: -1 },
      { id: "4", name: "Sub-Bug", subtask: true, hierarchyLevel: -1 },
    ];
  }

  /**
   * Create screens shaped like the real AI project's (Module, Test Steps,
   * Expected/Actual Result…; PIC is a user picker, which cannot be filled).
   * `screens = false` is a project whose sub-tasks have no fields of their own.
   */
  screens = true;
  async getCreateMetaFields(_project: string, issueTypeId: string) {
    this.calls.push(`createmeta ${issueTypeId}`);
    if (!this.screens) return [];
    const area = (fieldId: string, name: string) => ({ fieldId, name, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea" } });
    const line = (fieldId: string, name: string) => ({ fieldId, name, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield" } });
    const select = (fieldId: string, name: string, values: string[]) => ({
      fieldId,
      name,
      schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" },
      allowedValues: values.map((value, i) => ({ id: `${fieldId}-${i}`, value })),
    });
    const common = [
      { fieldId: "summary", name: "Summary", schema: { type: "string", system: "summary" } },
      { fieldId: "description", name: "Description", schema: { type: "string", system: "description" } },
    ];
    if (issueTypeId === "3") {
      return [
        ...common,
        line("customfield_10101", "Module"),
        area("customfield_10102", "Pre-conditions"),
        area("customfield_10103", "Test Steps"),
        area("customfield_10104", "Test Data"),
        area("customfield_10105", "Actual Result"),
        area("customfield_10106", "Expected Result"),
        select("customfield_10107", "Test Type", ["Functional", "Non-functional"]),
        { fieldId: "customfield_10108", name: "PIC", schema: { type: "user", custom: "com.atlassian.jira.plugin.system.customfieldtypes:userpicker" } },
      ];
    }
    if (issueTypeId === "4") {
      return [
        ...common,
        select("customfield_10201", "Severity", ["Cao", "Trung bình", "Thấp"]),
        area("customfield_10202", "Root Cause"),
        area("customfield_10203", "Steps to Reproduce"),
        area("customfield_10105", "Actual Result"),
        area("customfield_10106", "Expected Result"),
      ];
    }
    return common;
  }

  async bulkCreateIssues(updates: Array<{ fields: Record<string, any> }>) {
    this.calls.push(`bulk ${updates.length}`);
    return updates.map(({ fields }) => {
      const key = `${this.project}-${this.seq++}`;
      const type = fields.issuetype.name;
      this.issues.set(key, {
        key,
        fields: {
          ...structuredClone(fields),
          issuetype: { name: type },
          status: { name: this.initial[type] ?? "To Do" },
          priority: fields.priority ?? null,
          parent: fields.parent ?? null,
          issuelinks: [],
          attachment: [],
        },
      });
      return { key };
    });
  }

  async getTransitions(key: string) {
    this.calls.push(`transitions ${key}`);
    const status = this.issues.get(key).fields.status.name.toLowerCase();
    return (this.flow[status] ?? []).map((to, i) => ({ id: `${status}:${i}`, name: `→ ${to}`, to: { name: to } }));
  }

  async transitionIssueById(key: string, id: string) {
    this.calls.push(`transition ${key}`);
    const [from, i] = id.split(":");
    this.issues.get(key).fields.status = { name: this.flow[from][Number(i)] };
  }

  async updateIssue(key: string, body: { fields?: Record<string, any>; update?: { labels?: Array<{ add?: string; remove?: string }> } }) {
    this.calls.push(`update ${key}`);
    const f = this.issues.get(key).fields;
    Object.assign(f, structuredClone(body.fields ?? {}));
    for (const op of body.update?.labels ?? []) {
      if (op.add) f.labels = [...f.labels, op.add];
      if (op.remove) f.labels = f.labels.filter((l: string) => l !== op.remove);
    }
  }

  async updateIssueFields(key: string, fields: Record<string, unknown>) {
    return this.updateIssue(key, { fields });
  }

  async createIssueLink(_type: string, inward: string, outward: string) {
    this.calls.push(`link ${inward} ${outward}`);
    this.issues.get(inward).fields.issuelinks.push({ outwardIssue: { key: outward } });
    this.issues.get(outward).fields.issuelinks.push({ inwardIssue: { key: inward } });
  }

  async addAttachment(key: string, file: { name: string; data: Buffer }) {
    this.calls.push(`attach ${key} ${file.name}`);
    const a = { id: String(this.seq++), filename: file.name, size: file.data.length };
    this.issues.get(key).fields.attachment.push(a);
    return [a];
  }

  async deleteAttachment(id: string) {
    this.calls.push(`deleteAttachment ${id}`);
  }
}
