import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMON, type TypeInfo } from "../spec/types.ts";
import { glyph, read, shape, side, sheet, SHAPES, SIDES, TOKENS, v, VERDICTS, verdictGlyph } from "../spec/style.ts";
import { css, DARK, DERIVED, LIGHT, MARKS, SPACE, TYPE } from "../packs/style/tokens.ts";

const work: TypeInfo = { name: "work", base: "work", statuses: { open: ["todo", "doing"], closed: ["done", "dropped"] }, fields: COMMON, trial: false, pack: "work" };

test("the style sets every token the spec names, and only those", () => {
  const set = { ...LIGHT, ...DERIVED, ...TYPE, ...SPACE, ...MARKS };
  assert.deepEqual(Object.keys(set).sort(), Object.keys(TOKENS).sort());
  for (const k of Object.keys(DARK)) assert.ok(k in LIGHT, `${k} by night has a day value`);
});

test("every shape has a glyph at every side, and every verdict one", () => {
  for (const s of SHAPES) for (const at of SIDES) assert.match(MARKS[glyph(s, at)]!, /^".+"$/);
  for (const x of VERDICTS) assert.match(MARKS[verdictGlyph(x)]!, /^".+"$/);
});

test("a view's sheet gives each token a plain fallback, and leaves other properties alone", () => {
  assert.equal(sheet(".a { color:var(--fg); width:var(--own); }"), ".a { color:var(--fg, CanvasText); width:var(--own); }");
  assert.equal(v("text-s"), "var(--text-s, 11px)");
});

test("with no page, a token reads as its plain value, quotes gone", () => {
  assert.equal(read("fg"), "CanvasText");
  assert.equal(read(glyph("circle", "done")), "+");
});

test("the mark rule: shape from the base, side from the status", () => {
  assert.deepEqual(["todo", "doing", "done", "dropped"].map((s) => side(work, s)), ["fresh", "moving", "done", "gone"]);
  assert.equal(shape(["question", "work"], work), "diamond");
  assert.equal(shape(["a", "b", "c", "d", "work"], work), "square", "round again past the last shape");
});

test("the sheet sets the root by day, by night when the system is dark, and either on an element that asks", () => {
  const out = css();
  assert.match(out, /^:root \{ color-scheme:light dark;.*--fg:#1d1d1b;/m);
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{ :root \{.*--fg:#e8e6e1;/);
  assert.match(out, /\[data-scheme="dark"\] \{ color-scheme:dark;.*--mark-done:var\(--held\);/);
});
