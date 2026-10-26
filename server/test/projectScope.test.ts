import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickProject, requestedProjectKey } from "../src/auth/projectScope.js";

const A = { key: "AAA", name: "Dự án A" };
const B = { key: "BBB", name: "Dự án B" };
const header = (v?: string) => ({ get: (n: string) => (n.toLowerCase() === "x-project-key" ? v : undefined) });

describe("requestedProjectKey", () => {
  it("reads the key a tab names, trimmed", () => {
    assert.equal(requestedProjectKey(header(" GMSPM ")), "GMSPM");
    assert.equal(requestedProjectKey(header("HN_026")), "HN_026");
  });
  it("names nothing when the header is missing or cannot be a Jira key", () => {
    assert.equal(requestedProjectKey(header()), null);
    assert.equal(requestedProjectKey(header("")), null);
    assert.equal(requestedProjectKey(header("A")), null);
    assert.equal(requestedProjectKey(header("AB-1/../x")), null);
    assert.equal(requestedProjectKey(header("9AB")), null);
  });
});

describe("pickProject", () => {
  it("a tab that names nothing runs on the session's project", () => {
    assert.deepEqual(pickProject(null, A, [A, B]), A);
    assert.equal(pickProject(null, null, [A, B]), null);
  });
  it("a tab that names another project the account can browse runs on that one, not the session's", () => {
    assert.deepEqual(pickProject("BBB", A, [A, B]), B);
  });
  it("naming the session's own project needs no list", () => {
    assert.deepEqual(pickProject("AAA", A, []), A);
  });
  it("a project the account cannot browse is refused, never swapped for the session's", () => {
    assert.equal(pickProject("ZZZ", A, [A, B]), null);
  });
  it("with no session project, a named one still has to be browsable", () => {
    assert.deepEqual(pickProject("BBB", null, [A, B]), B);
    assert.equal(pickProject("ZZZ", null, [A, B]), null);
  });
});
