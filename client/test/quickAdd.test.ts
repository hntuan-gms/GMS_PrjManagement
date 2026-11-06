import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHours,
  makeDate,
  parseQuickAdd,
  resolveIssueTypeName,
  resolvePriorityName,
  weekdayDate,
  type QuickAddContext,
} from "../src/quickAdd";
import { task } from "./fixtures";

// 2026-11-06 is a Friday.
const TODAY = "2026-11-06";
const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"];

const ctx: QuickAddContext = {
  today: TODAY,
  meAccountId: "me",
  projectKey: "DEMO",
  issueTypes: ["Epic", "Story", "Task", "Lỗi", "Sub-task"],
  priorities: PRIORITIES,
  users: [
    { accountId: "me", displayName: "Tuấn Test", avatarUrl: null },
    { accountId: "chi", displayName: "Lê Chi", avatarUrl: null },
    { accountId: "anh1", displayName: "Nguyễn Anh", avatarUrl: null },
    { accountId: "anh2", displayName: "Trần Anh", avatarUrl: null },
    { accountId: "binh", displayName: "Trần Bình", avatarUrl: null },
  ],
  tasks: [
    task({ id: "DEMO-1", summary: "Giai đoạn 1", issueType: "Epic" }),
    task({ id: "DEMO-2", summary: "Giai đoạn 2", issueType: "Epic" }),
    task({ id: "DEMO-3", summary: "Thiết kế CSDL", issueType: "Story", wbsParentId: "DEMO-2", startDate: "2026-11-02", dueDate: "2026-11-10" }),
    task({ id: "DEMO-5", summary: "Thiết kế giao diện", startDate: "2026-11-09", dueDate: "2026-11-12", durationDays: 4 }),
    task({ id: "DEMO-6", summary: "Giai đoạn 2 kiểm thử", issueType: "Story" }),
    task({ id: "DEMO-7", summary: "Giai đoạn con", issueType: "Sub-task", wbsParentId: "DEMO-3" }),
  ],
};

const parse = (s: string, o: Partial<QuickAddContext> = {}) => parseQuickAdd(s, { ...ctx, ...o });

describe("parseQuickAdd — the plan's example", () => {
  const input = "Dựng API đăng nhập @chi t6 3n !cao ^DEMO-2 sau DEMO-5 #backend";
  const r = parse(input);

  it("fills every field and leaves the rest as the title", () => {
    assert.equal(r.title, "Dựng API đăng nhập");
    assert.deepEqual(r.fields, {
      assigneeAccountId: "chi",
      startDate: TODAY, // t6 said on a Friday is today
      durationDays: 3,
      priority: "High",
      parentId: "DEMO-2",
      predecessors: [{ taskId: "DEMO-5", type: "FS", lagDays: 0 }],
      labels: ["backend"],
    });
  });

  it("gives every token offsets that slice back to its text", () => {
    assert.deepEqual(
      r.tokens.map((t) => t.kind),
      ["assignee", "date", "duration", "priority", "parent", "predecessor", "label"]
    );
    for (const t of r.tokens) assert.equal(input.slice(t.start, t.end), t.raw);
    assert.equal(r.tokens.find((t) => t.kind === "predecessor")?.raw, "sau DEMO-5");
  });

  it("previews in one Vietnamese line", () => {
    assert.equal(r.preview, "Task · Dựng API đăng nhập · Lê Chi · 6/11 → 8/11 (sau DEMO-5) · Cao · trong DEMO-2 · #backend");
  });
});

describe("parseQuickAdd — people", () => {
  it("an ambiguous name is a question, not a guess", () => {
    const r = parse("Viết test @anh");
    const tok = r.tokens[0];
    assert.equal(tok.value, null);
    assert.deepEqual(tok.ambiguous?.map((c) => c.id).sort(), ["anh1", "anh2"]);
    assert.equal(r.fields.assigneeAccountId, undefined);
    assert.equal(r.title, "Viết test");
    assert.match(r.preview, /anh\? \(2 người\)/);
  });

  it("a second word narrows a name: @trần anh", () => {
    const r = parse("Viết test @trần anh mai");
    assert.equal(r.fields.assigneeAccountId, "anh2");
    assert.equal(r.tokens[0].raw, "@trần anh");
    assert.equal(r.title, "Viết test");
    assert.equal(r.fields.startDate, "2026-11-07");
  });

  it("a full name is consumed even when the first word already decided: @lê chi", () => {
    const r = parse("Dựng API @lê chi");
    assert.equal(r.fields.assigneeAccountId, "chi");
    assert.equal(r.title, "Dựng API");
  });

  it("a following title word is not swallowed into the name", () => {
    const r = parse("Sửa @chi dựng form");
    assert.equal(r.fields.assigneeAccountId, "chi");
    assert.equal(r.title, "Sửa dựng form");
  });

  it("@tôi / @toi / @me is the signed-in account", () => {
    for (const me of ["@tôi", "@toi", "@me"]) {
      const r = parse(`Viết báo cáo ${me}`);
      assert.equal(r.fields.assigneeAccountId, "me", me);
      assert.equal(r.tokens[0].label, "Tuấn Test");
    }
  });

  it("nobody by that name: flagged, and the text stays in the title", () => {
    const r = parse("Gọi @xyz");
    assert.equal(r.tokens[0].unresolved, true);
    assert.equal(r.fields.assigneeAccountId, undefined);
    assert.equal(r.title, "Gọi @xyz");
  });
});

describe("parseQuickAdd — dates", () => {
  const start = (s: string) => parse(s).fields.startDate;

  it("relative words", () => {
    assert.equal(start("Họp hôm nay"), TODAY);
    assert.equal(start("Họp mai"), "2026-11-07");
    assert.equal(start("Họp ngày mai"), "2026-11-07");
    assert.equal(start("Họp ngày kia"), "2026-11-08");
    assert.equal(start("Họp mốt"), "2026-11-08");
  });

  it("weekdays: the nearest one from today on", () => {
    assert.equal(start("Họp t6"), TODAY);
    assert.equal(start("Họp T2"), "2026-11-09");
    assert.equal(start("Họp cn"), "2026-11-08");
    assert.equal(start("Họp thứ 4"), "2026-11-11");
    assert.equal(start("Họp thứ sáu"), TODAY);
    assert.equal(start("Họp chủ nhật"), "2026-11-08");
  });

  it("… tuần sau: that weekday of next week", () => {
    assert.equal(start("Demo thứ 6 tuần sau"), "2026-11-13");
    assert.equal(start("Demo t2 tuần sau"), "2026-11-09");
    assert.equal(start("Demo tuần sau"), "2026-11-09");
    assert.equal(parse("Demo thứ 6 tuần sau").title, "Demo");
  });

  it("day-first dates, with the year guessed forward", () => {
    assert.equal(start("Nộp 15/11"), "2026-11-15");
    assert.equal(start("Nộp 5/1"), "2027-01-05");
    assert.equal(start("Nộp 15/11/2027"), "2027-11-15");
    assert.equal(start("Nộp 1/10"), "2026-10-01"); // a month back is kept as typed
    const bad = parse("Nộp 31/2");
    assert.equal(bad.fields.startDate, undefined);
    assert.equal(bad.title, "Nộp 31/2");
  });

  it("ranges set start and an inclusive duration", () => {
    for (const s of ["Sprint 15/11-20/11", "Sprint 15/11–20/11", "Sprint 15/11 - 20/11", "Sprint 15-20/11", "Sprint từ 15/11 đến 20/11"]) {
      const r = parse(s);
      assert.equal(r.fields.startDate, "2026-11-15", s);
      assert.equal(r.fields.durationDays, 6, s);
      assert.equal(r.title, "Sprint", s);
    }
    const yearEnd = parse("Nghỉ 28/12–3/1").fields;
    assert.equal(yearEnd.startDate, "2026-12-28");
    assert.equal(yearEnd.durationDays, 7);
  });

  it("a range's own length wins over a later duration, which stays as text", () => {
    const r = parse("X 15/11-20/11 3n");
    assert.equal(r.fields.durationDays, 6);
    assert.equal(r.title, "X 3n");
  });

  it("only the first date counts; a trailing comma is fine", () => {
    const r = parse("Họp mai, 15/11");
    assert.equal(r.fields.startDate, "2026-11-07");
    assert.equal(r.title, "Họp 15/11");
  });
});

describe("parseQuickAdd — Vietnamese words that must not become tokens", () => {
  const untouched = (s: string) => {
    const r = parse(s);
    assert.deepEqual(r.tokens, [], s);
    assert.equal(r.title, s);
  };

  it("đăng / đang are not dates", () => untouched("Sửa trang đăng ký đang lỗi"));
  it("một is not mốt, mãi is not mai", () => untouched("Viết một tài liệu mãi mãi"));
  it("thứ tự is not Wednesday, chữ nhật is not Sunday", () => untouched("Sắp xếp thứ tự hình chữ nhật"));
  it("thư sau is not 'Saturday' and not a dependency", () => untouched("Gửi thư sau khi họp"));
  it("T6-1 is an issue key, not Friday", () => untouched("Sửa T6-1 crash"));
  it("5G and 3D are not hours and days", () => untouched("Kiểm thử 5G và mô hình 3D"));
  it("/api/login is a path, not a type", () => untouched("Sửa /api/login"));
  it("#12 is a number, not a label", () => untouched("Xem lại #12"));
});

describe("parseQuickAdd — duration and estimate", () => {
  it("durations in days and weeks", () => {
    const d = (s: string) => parse(`X ${s}`).fields.durationDays;
    assert.equal(d("3n"), 3);
    assert.equal(d("3 ngày"), 3);
    assert.equal(d("3d"), 3);
    assert.equal(d("2t"), 14);
    assert.equal(d("2 tuần"), 14);
    assert.equal(d("1.5n"), 2); // whole calendar days, rounded up like the server
  });

  it("estimates in hours, minutes and h+minutes", () => {
    const e = (s: string) => parse(`X ${s}`).fields.estimateHours;
    assert.equal(e("4h"), 4);
    assert.equal(e("4g"), 4);
    assert.equal(e("1.5h"), 1.5);
    assert.equal(e("1,5h"), 1.5);
    assert.equal(e("1h30"), 1.5);
    assert.equal(e("30p"), 0.5);
    assert.equal(e("2 giờ"), 2);
    assert.equal(parse("X 1h30").tokens[0].label, "1h30");
  });
});

describe("parseQuickAdd — priority", () => {
  const p = (s: string, priorities = PRIORITIES) => parse(`X ${s}`, { priorities }).fields.priority;

  it("stock names", () => {
    assert.equal(p("!!"), "Highest");
    assert.equal(p("!khẩn"), "Highest");
    assert.equal(p("!khan"), "Highest");
    assert.equal(p("!cao"), "High");
    assert.equal(p("!tb"), "Medium");
    assert.equal(p("!trung bình"), "Medium");
    assert.equal(p("!thấp"), "Low");
    assert.equal(p("!thap"), "Low");
    assert.equal(parse("X !trung bình").title, "X");
  });

  it("a Vietnamese site by name, an unknown one by position", () => {
    const vi = ["Khẩn cấp", "Cao", "Trung bình", "Thấp"];
    assert.equal(p("!khẩn", vi), "Khẩn cấp");
    assert.equal(p("!thấp", vi), "Thấp");
    assert.equal(parse("X !cao", { priorities: vi }).tokens[0].label, "Cao");
    const coded = ["P1", "P2", "P3", "P4", "P5"];
    assert.equal(p("!cao", coded), "P2");
    assert.equal(p("!tb", coded), "P3");
    assert.equal(p("!thấp", coded), "P4");
  });

  it("no priorities on the site: unresolved, kept in the title", () => {
    const r = parse("X !cao", { priorities: [] });
    assert.equal(r.fields.priority, undefined);
    assert.equal(r.tokens[0].unresolved, true);
    assert.equal(r.title, "X !cao");
    assert.equal(resolvePriorityName("high", []), null);
  });
});

describe("parseQuickAdd — parent and dependencies", () => {
  it("^title words: the exact title wins over a longer one, digits included", () => {
    const r = parse("Viết tài liệu ^giai đoạn 2");
    assert.equal(r.fields.parentId, "DEMO-2");
    assert.equal(r.title, "Viết tài liệu");
  });

  it('^"quoted title"', () => {
    assert.equal(parse('X ^"giai đoạn 1"').fields.parentId, "DEMO-1");
  });

  it("^ with several matches and no single Epic is a question", () => {
    const r = parse("X ^thiết kế");
    assert.equal(r.fields.parentId, undefined);
    assert.deepEqual(r.tokens[0].ambiguous?.map((c) => c.id).sort(), ["DEMO-3", "DEMO-5"]);
  });

  it("^ a key of another project is unresolved and kept", () => {
    const r = parse("X ^ABC-1");
    assert.equal(r.tokens[0].unresolved, true);
    assert.equal(r.title, "X ^ABC-1");
    assert.equal(parse("X ^demo-1").fields.parentId, "DEMO-1");
  });

  it("sau KEY without a date starts the day after the predecessor ends", () => {
    const r = parse("Code màn hình sau DEMO-5 2n");
    assert.equal(r.fields.startDate, "2026-11-13");
    assert.match(r.preview, /13\/11 → 14\/11 \(sau DEMO-5\)/);
  });

  it('sau "quoted title", and several keys', () => {
    assert.deepEqual(parse('X sau "thiết kế csdl"').fields.predecessors, [{ taskId: "DEMO-3", type: "FS", lagDays: 0 }]);
    const many = parse("X sau DEMO-5, DEMO-3").fields;
    assert.deepEqual(many.predecessors?.map((p) => p.taskId), ["DEMO-5", "DEMO-3"]);
    assert.equal(many.startDate, "2026-11-13"); // the later of the two ends
    assert.deepEqual(parse("X sau DEMO-5 và DEMO-3").fields.predecessors?.length, 2);
  });

  it("trước KEY makes the new task a predecessor of it", () => {
    const r = parse("Chuẩn bị dữ liệu trước DEMO-5");
    assert.deepEqual(r.fields.successorOf, ["DEMO-5"]);
    assert.equal(r.title, "Chuẩn bị dữ liệu");
  });

  it("a key outside the project is unresolved", () => {
    const r = parse("X sau XYZ-9");
    assert.equal(r.tokens[0].unresolved, true);
    assert.equal(r.fields.predecessors, undefined);
    assert.equal(r.title, "X sau XYZ-9");
  });
});

describe("parseQuickAdd — labels, type, sprint", () => {
  it("#labels, deduplicated", () => {
    assert.deepEqual(parse("X #backend #ui #backend").fields.labels, ["backend", "ui"]);
  });

  it("/type against the project's own names", () => {
    assert.equal(parse("X /bug").fields.issueType, "Lỗi");
    assert.equal(parse("X /lỗi").fields.issueType, "Lỗi");
    assert.equal(parse("X /sub").fields.issueType, "Sub-task");
    assert.equal(parse("X /story").preview, "Story · X");
  });

  it("*sprint hints", () => {
    assert.equal(parse("X *sprint 8").fields.sprintHint, "sprint 8");
    assert.equal(parse("X *tiếp").fields.sprintHint, "next");
    assert.equal(parse("X *next").fields.sprintHint, "next");
    assert.equal(parse("X *backlog").fields.sprintHint, "backlog");
    assert.equal(parse("X *sprint 8").title, "X");
  });

  it("an empty title still previews", () => {
    assert.equal(parse("@chi mai").preview, "Task · (chưa có tên) · Lê Chi · từ 7/11");
  });
});

describe("helpers", () => {
  it("resolveIssueTypeName", () => {
    assert.equal(resolveIssueTypeName("bug", ["Task", "Bug"]), "Bug");
    assert.equal(resolveIssueTypeName("bug", []), "Bug");
    assert.equal(resolveIssueTypeName("task", ["Improvement", "Task"]), "Task");
    assert.equal(resolveIssueTypeName("sto", ["Story", "Task"]), "Story");
    assert.equal(resolveIssueTypeName("api", ["Story", "Task"]), null);
  });

  it("makeDate and weekdayDate", () => {
    assert.equal(makeDate(29, 2, 2028, TODAY), "2028-02-29");
    assert.equal(makeDate(29, 2, 2027, TODAY), null);
    assert.equal(makeDate(1, 13, null, TODAY), null);
    assert.equal(weekdayDate(5, "2026-11-09", true), "2026-11-20"); // Monday → Friday of next week
    assert.equal(weekdayDate(1, "2026-11-09", false), "2026-11-09");
  });

  it("formatHours", () => {
    assert.equal(formatHours(4), "4h");
    assert.equal(formatHours(1.5), "1h30");
    assert.equal(formatHours(0.25), "15p");
  });
});
