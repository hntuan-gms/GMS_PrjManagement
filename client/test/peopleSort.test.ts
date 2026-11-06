import { test } from "node:test";
import assert from "node:assert/strict";
import { sortPeople } from "../src/resourceColumns";
import type { PersonLoad } from "../src/resourceAllocation";

const person = (displayName: string, capacityHours: number, allocatedHours: number) =>
  ({ displayName, capacityHours, allocatedHours }) as unknown as PersonLoad;

const people = [person("Lê Chi", 40, 10), person("Nguyễn Anh", 40, 36), person("Trần Bình", 30, 30), person("An", 40, 10)];

test("load keeps the incoming order (most overloaded first)", () => {
  assert.deepEqual(sortPeople(people, "load"), people);
});

test("least free first: whoever has the least room", () => {
  assert.deepEqual(
    sortPeople(people, "least-free").map((p) => p.displayName),
    ["Trần Bình", "Nguyễn Anh", "An", "Lê Chi"]
  );
});

test("most free first, ties broken by name", () => {
  assert.deepEqual(
    sortPeople(people, "most-free").map((p) => p.displayName),
    ["An", "Lê Chi", "Nguyễn Anh", "Trần Bình"]
  );
});

test("by name, Vietnamese collation, without mutating the input", () => {
  const before = people.map((p) => p.displayName);
  assert.deepEqual(
    sortPeople(people, "name").map((p) => p.displayName),
    ["An", "Lê Chi", "Nguyễn Anh", "Trần Bình"]
  );
  assert.deepEqual(people.map((p) => p.displayName), before);
});
