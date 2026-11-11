import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issuePickJql } from "../src/clockworkSearch.js";

describe("issuePickJql", () => {
  it("a whole key is looked up exactly, in capitals", () => {
    assert.equal(issuePickJql("gpm-12"), 'key = "GPM-12"');
    assert.equal(issuePickJql(" AI-7 "), 'key = "AI-7"');
  });

  it("anything else is a title search on open work that is not an Epic", () => {
    assert.equal(issuePickJql("đăng nhập"), 'summary ~ "đăng nhập*" AND statusCategory != Done AND issuetype != Epic ORDER BY updated DESC');
  });

  it("quotes, backslashes and query operators cannot break out of the string", () => {
    assert.equal(issuePickJql('a" OR project = X \\'), 'summary ~ "a OR project = X*" AND statusCategory != Done AND issuetype != Epic ORDER BY updated DESC');
    assert.equal(issuePickJql("(x)+y"), 'summary ~ "x y*" AND statusCategory != Done AND issuetype != Epic ORDER BY updated DESC');
  });

  it("too short to search is nothing", () => {
    assert.equal(issuePickJql("a"), null);
    assert.equal(issuePickJql("  "), null);
    assert.equal(issuePickJql("+-"), null);
  });
});
