import assert from "node:assert/strict";
import { test } from "node:test";
import { headings, ordered, outline, restates, sections, workLine, type Node, type Row, type Source, type Wire } from "../plugins/document/outline.ts";

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
      ["phase", "record", "Phase one"],
      ["old", "record", "Old plan", "", true],
      ["under-old", "record", "Under the old plan"],
      ["step", "work", "Ship it", "", true],
      ["block", "record", "Week one"],
    ],
    [["part_of", "old", "phase"], ["part_of", "under-old", "old"], ["part_of", "step", "block"], ["part_of", "block", "phase"]],
  );
  assert.deepEqual(titles(outline(["phase"], src)), [["Phase one", [["Week one", ["Ship it"]]]]]);
});

test("a part its holder's note already has as a section is read once, in the note", () => {
  const note = ["# Launch", "", "## Week 1 — set up", "", "1. Check", "", "## Week 2–3 — write the guide, record the demo and post it", "", "1. Write"].join("\n");
  const heads = headings(note);
  assert.deepEqual(heads, ["launch", "week 1 set up", "week 2 3 write the guide record the demo and post it"]);
  assert.equal(restates("Launch — Week 1 — set up", heads), true);
  // Cut at 60 characters, it still begins the heading.
  assert.equal(restates("Launch plan — Week 2–3 — write the guide, record the demo…", heads), true);
  assert.equal(restates("Launch — Week 4 — review", heads), false);
  const src = map(
    [["outline", "record", "Launch outline", note], ["b1", "record", "Launch — Week 1 — set up"], ["b2", "record", "Launch — Extra week"]],
    [["part_of", "b1", "outline"], ["part_of", "b2", "outline"]],
  );
  assert.deepEqual(titles(outline(["outline"], src)), [["Launch outline", ["Launch — Extra week"]]]);
});

test("work reads its first paragraph whole when its title is that paragraph cut short", () => {
  const first = "Run the import on a copy, check the counts per type and spot-check twenty notes.";
  assert.equal(workLine("Run the import on a copy, check the counts per type and…", `${first}\n\nMore.`), first);
  assert.equal(workLine("Finish phase one", "Current outline for phase one."), "Finish phase one");
});
