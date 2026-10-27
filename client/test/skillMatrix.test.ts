import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSkillMatrix, filterRows, normalizeSkills, skillKey, toggleSkill } from "../src/skillMatrix";
import type { ResourceProfile } from "../src/types";

const profile = (accountId: string, skills: string[], role: string | null = null): ResourceProfile => ({
  accountId,
  role,
  skills,
  capacityHoursPerDay: 8,
  costPerDay: null,
  notes: null,
});

const users = [
  { accountId: "a", displayName: "An" },
  { accountId: "b", displayName: "Bình" },
  { accountId: "c", displayName: "Cường" },
];

describe("skill matrix", () => {
  it("treats case and diacritics as the same skill", () => {
    assert.equal(skillKey("  Kiểm thử "), skillKey("kiem thu"));
    assert.deepEqual(normalizeSkills(["React", "react", " ", "Node"]), ["React", "Node"]);
  });

  it("merges spellings into one column and counts the people, most common first", () => {
    const m = buildSkillMatrix(users, [profile("a", ["React", "SQL"]), profile("b", ["react"]), profile("c", [])]);
    assert.deepEqual(
      m.columns.map((c) => [c.label, c.count]),
      [["React", 2], ["SQL", 1]]
    );
    assert.equal(m.withoutSkills, 1);
    // Whoever has the most skills comes first.
    assert.equal(m.rows[0].accountId, "a");
  });

  it("keeps the spelling most people used", () => {
    const m = buildSkillMatrix(users, [profile("a", ["react"]), profile("b", ["React"]), profile("c", ["React"])]);
    assert.equal(m.columns[0].label, "React");
  });

  it("an added-but-unowned skill is still a column", () => {
    const m = buildSkillMatrix(users, [profile("a", ["SQL"])], ["Go"]);
    assert.deepEqual(m.columns.map((c) => [c.label, c.count]), [["SQL", 1], ["Go", 0]]);
  });

  it("ignores profiles of people who are not listed", () => {
    const m = buildSkillMatrix(users, [profile("zzz", ["Rust"])]);
    assert.equal(m.columns.length, 0);
  });

  it("toggling adds a missing skill and removes a present one, whatever its spelling", () => {
    assert.deepEqual(toggleSkill(["React"], "SQL"), ["React", "SQL"]);
    assert.deepEqual(toggleSkill(["React", "SQL"], "react"), ["SQL"]);
  });

  it("filters rows by name, role or skill without caring about diacritics", () => {
    const m = buildSkillMatrix(users, [profile("a", ["Kiểm thử"], "QA"), profile("b", ["React"])]);
    assert.deepEqual(filterRows(m.rows, "kiem thu").map((r) => r.accountId), ["a"]);
    assert.deepEqual(filterRows(m.rows, "binh").map((r) => r.accountId), ["b"]);
    assert.equal(filterRows(m.rows, "").length, 3);
  });
});
