import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * "Only tokens.css writes a raw colour" (design-system MASTER.md, plan §4). App.css once carried 368
 * hex values despite the rule, which is what made a re-theme (dark mode, the new palette) impossible
 * by editing tokens alone. This keeps it that way:
 *   - CSS: no #hex anywhere but design/tokens.css (comments included — a hex in a comment is a
 *     colour someone will copy).
 *   - TS/TSX: no hex string literals ("#fff"). theme.ts's <meta name="theme-color"> is the one
 *     exception: the browser chrome cannot read a CSS variable.
 */
const SRC = join(import.meta.dirname, "..", "src");
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
const HEX_LITERAL = /["'`]#[0-9a-fA-F]{3,8}["'`]/g;
const ALLOWED = new Set(["design/tokens.css", "theme.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("no raw hex colour outside tokens.css", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    const pattern = rel.endsWith(".css") ? HEX : /\.(ts|tsx)$/.test(rel) ? HEX_LITERAL : null;
    if (!pattern) continue;
    text.split("\n").forEach((line, i) => {
      // Skip things that look like hex but are not colours: URL fragments and HTML entities.
      if (/url\(|&#/.test(line)) return;
      for (const m of line.matchAll(pattern)) offenders.push(`${rel}:${i + 1} ${m[0]}`);
    });
  }
  assert.deepEqual(offenders, [], "Use a token from design/tokens.css instead:\n" + offenders.join("\n"));
});
