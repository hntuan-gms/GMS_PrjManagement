/**
 * Turns a tool answer that is really a question ("delete GPM-104?", "which Quang?")
 * into buttons. Pure: the tools keep enforcing the confirmation themselves
 * (`needsConfirmation` is returned without writing anything); this only lets the
 * browser draw the reply the user would otherwise type.
 *
 * Each option's `message` is an ordinary sentence. Sent as the next user message it
 * makes the model call the tool again with confirmed / allowDuplicate / that accountId,
 * so nothing here bypasses the tools' own checks.
 */

export interface ChoiceOption {
  label: string;
  message: string;
  tone?: "danger" | "default";
}

export interface ChoicesEvent {
  prompt: string;
  options: ChoiceOption[];
}

const CANCEL: ChoiceOption = { label: "Thôi", message: "Thôi, không làm nữa", tone: "default" };

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asText = (v: unknown): string => (typeof v === "string" ? v : "");
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Joined keys, shortened: "A, B, C và 4 việc khác". */
function keyList(keys: string[], max = 4): string {
  if (keys.length <= max) return keys.join(", ");
  return `${keys.slice(0, max).join(", ")} và ${keys.length - max} việc khác`;
}

/** The buttons for a tool response, or null when the response is not a question. */
export function choicesFor(response: Record<string, unknown>): ChoicesEvent | null {
  // A name that matched several people: one button each.
  const ambiguous = asList(response.ambiguous)
    .map(asRecord)
    .filter((p): p is Record<string, unknown> => !!p && !!asText(p.accountId) && !!asText(p.name));
  if (ambiguous.length > 1) {
    return {
      prompt: "Bạn muốn chọn ai?",
      options: [
        ...ambiguous.slice(0, 8).map((p) => ({
          label: asText(p.name),
          message: `Ý tôi là ${asText(p.name)} (${asText(p.accountId)})`,
        })),
        CANCEL,
      ],
    };
  }

  if (response.needsConfirmation !== true) return null;

  // delete_task
  const willDelete = asRecord(response.willDelete);
  if (willDelete) {
    const id = asText(willDelete.id);
    if (!id) return null;
    const subtasks = asList(response.alsoDeletesSubtasks).map(asText).filter(Boolean);
    const summary = asText(willDelete.summary);
    return {
      prompt: `Xoá ${id}${summary ? ` · ${summary}` : ""}${subtasks.length > 0 ? `, kèm ${subtasks.length} việc con` : ""}? Không hoàn tác được.`,
      options: [{ label: `Xoá ${id}`, message: `Xác nhận xoá ${id}`, tone: "danger" }, CANCEL],
    };
  }

  // create_task: similar work already exists
  const dupes = asList(response.possibleDuplicates).map(asRecord).filter((d): d is Record<string, unknown> => !!d);
  if (dupes.length > 0) {
    const keys = dupes.map((d) => asText(d.id)).filter(Boolean);
    return {
      prompt: `Đã có việc giống: ${keyList(keys)}. Vẫn tạo mới?`,
      options: [{ label: "Vẫn tạo mới", message: "Vẫn tạo việc mới, dù đã có việc giống", tone: "default" }, { label: "Không tạo", message: "Không tạo nữa, dùng việc đã có", tone: "default" }],
    };
  }

  // change_issue_type: the status will change with the type
  const willMoveTo = asText(response.willMoveTo);
  if (willMoveTo) {
    const keys = asList(response.willMove).map((m) => (typeof m === "string" ? m : asText(asRecord(m)?.id ?? asRecord(m)?.key))).filter(Boolean);
    return {
      prompt: `Đổi ${keys.length > 0 ? keyList(keys) : "các việc"} sang loại ${willMoveTo}? Trạng thái sẽ đổi theo workflow mới.`,
      options: [{ label: `Đổi sang ${willMoveTo}`, message: `Xác nhận đổi loại sang ${willMoveTo}`, tone: "default" }, CANCEL],
    };
  }

  // sprint_action complete
  const sprint = asText(response.sprint);
  if (sprint) {
    const open = asList(response.openWillMove).length;
    const target = asText(response.target);
    return {
      prompt: `Đóng ${sprint}?${open > 0 ? ` ${open} việc chưa xong chuyển sang ${target || "nơi khác"}.` : ""}`,
      options: [{ label: "Đóng sprint", message: `Xác nhận đóng ${sprint}`, tone: "danger" }, CANCEL],
    };
  }

  return null;
}
