import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issuePickJql } from "../src/clockworkSearch.js";

describe("issuePickJql", () => {
  it("a whole key is looked up exactly, in capitals, whatever project the search was opened from", () => {
    assert.equal(issuePickJql("gpm-12"), 'key = "GPM-12"');
    assert.equal(issuePickJql(" AI-7 "), 'key = "AI-7"');
    assert.equal(issuePickJql("AI-7", "GPM"), 'key = "AI-7"');
  });

  it("a title search finds Epics and finished work too", () => {
    assert.equal(issuePickJql("đăng nhập"), 'summary ~ "đăng nhập*" ORDER BY updated DESC');
  });

  it("a project narrows the title search to it", () => {
    assert.equal(issuePickJql("pilot", "gmspm"), 'project = "GMSPM" AND summary ~ "pilot*" ORDER BY updated DESC');
  });

  it("nothing typed, with a project: my work there and what was created lately", () => {
    assert.equal(issuePickJql("", "AI"), 'project = "AI" AND (assignee = currentUser() OR created >= -14d) ORDER BY updated DESC');
    assert.equal(issuePickJql(""), null);
  });

  it("a project that is not a key is ignored rather than put into the JQL", () => {
    assert.equal(issuePickJql("pilot", 'X" OR 1=1'), 'summary ~ "pilot*" ORDER BY updated DESC');
    assert.equal(issuePickJql("", 'X" OR 1=1'), null);
  });

  it("quotes, backslashes and query operators cannot break out of the string", () => {
    assert.equal(issuePickJql('a" OR project = X \\'), 'summary ~ "a OR project = X*" ORDER BY updated DESC');
    assert.equal(issuePickJql("(x)+y"), 'summary ~ "x y*" ORDER BY updated DESC');
  });

  it("too short to search is nothing", () => {
    assert.equal(issuePickJql("a"), null);
    assert.equal(issuePickJql("  "), null);
    assert.equal(issuePickJql("+-"), null);
  });
});
