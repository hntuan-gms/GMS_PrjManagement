/**
 * Moving a task in the WBS (a new parent) or changing its issue type, checked
 * before Jira is asked to do either.
 *
 * Jira refuses most bad moves itself, but with a message about its own fields; the
 * ones that matter here are the ones this app would otherwise break silently:
 * a parent–child loop (the WBS orderer and the Gantt roll-up both walk parents),
 * an Epic that ends up with an owner (see isAssignableType), and a sub-task with no
 * parent. Pure, so the rules can be tested without Jira.
 *
 * Mirrored in client/src/structure.ts, which decides which parents the picker
 * offers — the server stays the authority; the client only avoids offering a
 * choice that would be refused. Change one, change both.
 */

export interface StructureNode {
  id: string;
  parentKey: string | null;
  typeName: string;
  subtask: boolean;
  assigned: boolean;
}

export interface TypeInfo {
  name: string;
  subtask: boolean;
}

export interface StructureChange {
  /** undefined = leave the parent alone; null = take it off its parent. */
  parentKey?: string | null;
  /** undefined = leave the type alone. */
  issueType?: string;
}

const isEpic = (name: string) => name.toLowerCase() === "epic";

/** Is `ancestor` somewhere above `id`? Doubles as a cycle guard: a malformed chain stops at 100 hops. */
export function isDescendant(nodes: Map<string, StructureNode>, id: string, ancestor: string): boolean {
  let cur = nodes.get(id)?.parentKey ?? null;
  for (let hops = 0; cur && hops < 100; hops++) {
    if (cur === ancestor) return true;
    cur = nodes.get(cur)?.parentKey ?? null;
  }
  return false;
}

/** A Vietnamese reason the change cannot be made, or null when it can. */
export function checkStructure(
  all: StructureNode[],
  types: TypeInfo[],
  id: string,
  change: StructureChange
): string | null {
  const nodes = new Map(all.map((n) => [n.id, n]));
  const me = nodes.get(id);
  if (!me) return `Không tìm thấy ${id} trong dự án.`;

  let typeName = me.typeName;
  let subtask = me.subtask;
  if (change.issueType !== undefined) {
    const t = types.find((x) => x.name.toLowerCase() === change.issueType!.toLowerCase());
    if (!t) return `Dự án không có loại công việc "${change.issueType}".`;
    typeName = t.name;
    subtask = t.subtask;
  }
  const parentKey = change.parentKey !== undefined ? change.parentKey : me.parentKey;
  const children = all.filter((n) => n.parentKey === id);

  if (parentKey) {
    const parent = nodes.get(parentKey);
    if (!parent) return `Không tìm thấy việc cha ${parentKey} trong dự án.`;
    if (parentKey === id) return "Một công việc không thể làm cha của chính nó.";
    if (isDescendant(nodes, parentKey, id)) {
      return `${parentKey} đang nằm dưới ${id}; đặt làm cha sẽ tạo vòng lặp cha–con.`;
    }
    if (parent.subtask) return `${parentKey} là Sub-task nên không làm việc cha được.`;
    if (isEpic(typeName)) return `Epic không có việc cha (${id} sẽ là Epic).`;
  }
  if (subtask && !parentKey) return `Sub-task phải có việc cha; hãy chọn việc cha cho ${id}.`;
  if (subtask && children.length > 0) {
    return `${id} đang có ${children.length} việc con nên không chuyển thành Sub-task được.`;
  }
  if (change.issueType !== undefined && isEpic(typeName) && !isEpic(me.typeName) && me.assigned) {
    // The same rule updateTask enforces on assignment, from the other side.
    return `${id} đang có người phụ trách; Epic không có người phụ trách, hãy bỏ người phụ trách trước khi đổi sang Epic.`;
  }
  return null;
}
