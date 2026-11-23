import assert from "node:assert/strict";
import { test } from "node:test";
import type { TypeInfo } from "../spec/types.ts";
import { COMMON } from "../spec/types.ts";
import { parse, run, type Row, type Wire } from "../packs/find/query.ts";
import { layout, order, SIZE } from "../packs/map/layout.ts";
import { markToken, side } from "../packs/map/marks.ts";
import { MARKS } from "../packs/style/tokens.ts";

const base = (name: string, open: string[], closed: string[]): TypeInfo => ({ name, base: name, statuses: { open, closed }, fields: COMMON, trial: false, pack: name });
const TYPES = new Map([
  ["work", base("work", ["todo", "doing"], ["done", "dropped"])],
  ["question", base("question", ["open"], ["decided", "dropped"])],
  ["bug", { ...base("work", ["todo", "doing"], ["done", "dropped"]), name: "bug", trial: true }],
]);

function index(items: [string, string, string, string][], links: [string, string, string][]) {
  return {
    items: new Map<string, Row>(items.map(([id, type, title, status]) => [id, { id, type, fields: { title, status } }])),
    links: new Map<string, Wire>(links.map(([type, from, to], i) => [`l${i}`, { id: `l${i}`, type, from, to, fields: {} }])),
    type: (n: string) => TYPES.get(n),
  };
}

const IX = index(
  [
    ["hub", "work", "Track 3", "doing"],
    ["a", "work", "Base types", "done"],
    ["b", "work", "Map UI", "doing"],
    ["c", "bug", "Canvas fit is off", "todo"],
    ["q", "question", "Where is the edge?", "decided"],
    ["x", "work", "Something else", "todo"],
  ],
  [
    ["part_of", "a", "hub"],
    ["part_of", "b", "hub"],
    ["part_of", "c", "b"],
    ["depends_on", "b", "a"],
    ["depends_on", "b", "q"],
  ],
);

test("find parses a line into words and terms; empty is is:open", () => {
  assert.deepEqual(parse(""), { words: [], is: "open" });
  assert.deepEqual(parse("Map  ui type:work in:hub"), { words: ["map", "ui"], type: "work", in: "hub" });
  assert.deepEqual(parse("is:closed status:done"), { words: [], is: "closed", status: "done" });
});

test("find runs a query: words, sides, a type or its base, in: at any depth, near:", () => {
  const ids = (q: string) => run(IX, q).items.map((r) => r.id);
  assert.deepEqual(ids(""), ["hub", "b", "c", "x"]);
  assert.deepEqual(ids("is:closed"), ["a", "q"]);
  assert.deepEqual(ids("map"), ["b"]);
  assert.deepEqual(ids("type:work is:open"), ["hub", "b", "c", "x"], "a flavour matches its base");
  assert.deepEqual(ids("type:bug"), ["c"]);
  assert.deepEqual(ids("in:hub").sort(), ["a", "b", "c", "hub"]);
  assert.deepEqual(ids("near:b").sort(), ["a", "b", "c", "hub", "q"]);
  assert.deepEqual(ids("id:q"), ["q"]);
  const r = run(IX, "in:hub");
  assert.equal(r.links.length, 4, "only the links among the items drawn");
  const capped = run(IX, "is:open", 2);
  assert.equal(capped.items.length, 2);
  assert.equal(capped.more, 2);
});

test("the layout puts what an item needs to its left, parts before the whole, with right-angled wires", () => {
  assert.equal(order("depends_on"), "before");
  assert.equal(order("part_of"), "after");
  assert.equal(order("about"), null);
  const all = { items: [...IX.items.values()], links: [...IX.links.values()] };
  const out = layout(all);
  const col = (id: string) => out.boxes.get(id)!.col;
  assert.ok(col("a") < col("b"), "b depends on a: a is left");
  assert.ok(col("q") < col("b"), "b depends on q");
  assert.ok(col("b") < col("hub"), "b is part of hub: hub is right");
  assert.ok(col("c") < col("b"), "c is part of b");
  assert.equal(col("x"), -1, "an item with no links is set apart");
  assert.ok(out.boxes.get("x")!.y > Math.max(...["a", "b", "c", "q", "hub"].map((id) => out.boxes.get(id)!.y)));
  for (const p of out.paths) {
    for (let i = 1; i < p.points.length; i++) {
      const [x0, y0] = p.points[i - 1]!;
      const [x1, y1] = p.points[i]!;
      assert.ok(x0 === x1 || y0 === y1, `${p.type} ${p.from}→${p.to} turns at right angles`);
    }
  }
  assert.equal(out.width, 3 * SIZE.w + 2 * SIZE.gapX, "three columns: a q c, then b, then hub");
});

test("wires never share a stretch of line and never run through a card", () => {
  // A plan whose wires fan out of one card, span several columns, and meet in one card.
  const items = ["hub", "a", "b", "c", "d", "e", "f", "q", "x"].map((id) => ({ id }));
  const links = [
    ["part_of", "a", "hub"], ["part_of", "b", "hub"], ["part_of", "c", "hub"], ["part_of", "d", "hub"], ["part_of", "e", "hub"], ["part_of", "f", "hub"],
    ["depends_on", "b", "a"], ["depends_on", "c", "b"], ["depends_on", "d", "c"], ["depends_on", "e", "a"], ["depends_on", "f", "a"],
    ["depends_on", "f", "q"], ["about", "x", "e"], ["bears_on", "q", "hub"],
  ].map(([type, from, to], i) => ({ id: `l${i}`, type: type!, from: from!, to: to! }));
  const out = layout({ items, links });
  type S = { x0: number; y0: number; x1: number; y1: number; wire: string };
  const segs: S[] = [];
  for (const p of out.paths) {
    for (let i = 1; i < p.points.length; i++) {
      const [x0, y0] = p.points[i - 1]!;
      const [x1, y1] = p.points[i]!;
      assert.ok(x0 === x1 || y0 === y1, "right angles only");
      segs.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), wire: p.id });
    }
  }
  const eps = 0.01;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]!;
      const b = segs[j]!;
      if (a.wire === b.wire) continue;
      const horiz = a.y0 === a.y1 && b.y0 === b.y1 && Math.abs(a.y0 - b.y0) < eps && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > eps;
      const vert = a.x0 === a.x1 && b.x0 === b.x1 && Math.abs(a.x0 - b.x0) < eps && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > eps;
      assert.ok(!horiz && !vert, `wires ${a.wire} and ${b.wire} share a stretch`);
    }
  }
  for (const s of segs) {
    for (const box of out.boxes.values()) {
      const inside = s.x1 > box.x + eps && s.x0 < box.x + SIZE.w - eps && s.y1 > box.y + eps && s.y0 < box.y + SIZE.h - eps;
      assert.ok(!inside, `wire ${s.wire} runs through ${box.id}`);
    }
  }
});

test("the layout survives a cycle and links outside the drawn items", () => {
  const out = layout({
    items: [{ id: "a" }, { id: "b" }],
    links: [
      { id: "1", type: "depends_on", from: "a", to: "b" },
      { id: "2", type: "depends_on", from: "b", to: "a" },
      { id: "3", type: "depends_on", from: "a", to: "gone" },
    ],
  });
  assert.equal(out.boxes.size, 2);
  assert.equal(out.paths.length, 2);
});

test("marks come from the base and the status's side, never the type's name", () => {
  const bases = { work: "square", question: "diamond", profile: "hexagon" } as const;
  const w = TYPES.get("work")!;
  const bug = TYPES.get("bug")!;
  assert.deepEqual(["todo", "doing", "done", "dropped"].map((s) => side(w, s)), ["fresh", "moving", "done", "gone"]);
  const drawn = (t: string) => MARKS[t as keyof typeof MARKS];
  assert.deepEqual(["todo", "doing", "done", "dropped"].map((s) => markToken(bases, w, s)), ["glyph-square-fresh", "glyph-square-moving", "glyph-square-done", "glyph-square-gone"]);
  assert.deepEqual(["todo", "doing", "done", "dropped"].map((s) => drawn(markToken(bases, w, s))), ['"□"', '"◧"', '"■"', '"■"'], "the style draws each side");
  assert.equal(markToken(bases, bug, "done"), markToken(bases, w, "done"), "a flavour is marked as its base");
  assert.equal(drawn(markToken(bases, TYPES.get("question")!, "open")), '"◇"');
  // Edition 10: a base its pack draws as a hexagon has the hexagon's letters.
  assert.equal(markToken(bases, { ...w, name: "profile", base: "profile" }, "todo"), "glyph-hexagon-fresh");
  assert.equal(drawn("glyph-hexagon-fresh"), '"⬡"');
});
