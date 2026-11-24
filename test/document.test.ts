import assert from "node:assert/strict";
import { test } from "node:test";
import { headings, ordered, outline, restates, sections, workLine, type Node, type Row, type Source, type Wire } from "../packs/document/outline.ts";

/** A small map: rows by id, links, and which rows are closed. */
function map(rows: [string, string, string, string?, boolean?][], links: [string, string, string][]): Source {
  const items = new Map<string, Row>(rows.map(([id, type, title, note, closed]) => [id, { id, type, fields: { title, ...(note ? { note } : {}), ...(closed ? { status: "superseded" } : {}) } }]));
  const wires: Wire[] = links.map(([type, from, to], i) => ({ id: `r${i}`, type, from, to }));
  return {
    item: (id) => items.get(id),
    linksOf: (id) => wires.filter((w) => w.from === id || w.to === id),
    hidden: (r) => r.fields.status === "superseded" && r.type !== "work",
  };
}
const titles = (nodes: Node[]): unknown[] => nodes.map((n) => (n.children.length ? [n.row.fields.title, titles(n.children)] : n.row.fields.title));

test("siblings keep the order found, after what they depend on", () => {
  assert.deepEqual(ordered(["a", "b", "c"], (id) => (id === "a" ? ["c"] : [])), ["c", "a", "b"]);
  // A cycle places each once.
  assert.deepEqual(ordered(["a", "b"], (id) => (id === "a" ? ["b"] : ["a"])), ["b", "a"]);
});

test("named sections come in their order; without them, the roots of what was found", () => {
  const src = map([["hub", "record", "Hub"], ["x", "record", "X"], ["y", "record", "Y"]], [["part_of", "x", "hub"]]);
  assert.deepEqual(sections(["y", "hub", "gone"], [], src), ["y", "hub"]);
  assert.deepEqual(sections(undefined, ["hub", "x", "y"], src), ["hub", "y"]);
});

test("parts nest under what holds them; what is closed and not work is left out", () => {
  const src = map(
    [
      ["day", "record", "Friday"],
      ["old", "record", "Old plan", "", true],
      ["under-old", "record", "Under the old plan"],
      ["step", "work", "Bake", "", true],
      ["block", "record", "Morning"],
    ],
    [["part_of", "old", "day"], ["part_of", "under-old", "old"], ["part_of", "step", "block"], ["part_of", "block", "day"]],
  );
  assert.deepEqual(titles(outline(["day"], src)), [["Friday", [["Morning", ["Bake"]]]]]);
});

test("a part its holder's note already has as a section is read once, in the note", () => {
  const note = "# Friday\n\n## 9–9:30 a.m. — set up\n\n1. Check\n\n## 9:30–11:30 a.m. — dough chilling, sauce and cookie filling\n\n1. Mix";
  assert.deepEqual(headings(note), ["friday", "9 9 30 a m set up", "9 30 11 30 a m dough chilling sauce and cookie filling"]);
  const heads = headings(note);
  assert.equal(restates("Friday — 9–9:30 a.m. — set up", heads), true);
  // Cut at 60 characters, it still begins the heading.
  assert.equal(restates("Friday — 9:30–11:30 a.m. — dough chilling, sauce and cookie", heads), true);
  assert.equal(restates("Saturday — 4:30–7 p.m. — make and shape rolls", heads), false);
  const src = map(
    [["outline", "record", "Friday outline", note], ["b1", "record", "Friday — 9–9:30 a.m. — set up"], ["b2", "record", "Friday — Extra block"]],
    [["part_of", "b1", "outline"], ["part_of", "b2", "outline"]],
  );
  assert.deepEqual(titles(outline(["outline"], src)), [["Friday outline", ["Friday — Extra block"]]]);
});

test("work reads its first paragraph whole when its title is that paragraph cut short", () => {
  assert.equal(workLine("Beat cookie filling: 9 oz cream cheese, 4½ tbsp sugar, ¾ …", "Beat cookie filling: 9 oz cream cheese, 4½ tbsp sugar, ¾ tsp vanilla. Freeze 24 portions.\n\nMore."), "Beat cookie filling: 9 oz cream cheese, 4½ tbsp sugar, ¾ tsp vanilla. Freeze 24 portions.");
  assert.equal(workLine("Complete Friday prep", "Current outline for Friday."), "Complete Friday prep");
});
