import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, parse, refs } from "../packs/item/note.ts";
import { ago, brief, lines, marks, neighbours, others, shown } from "../packs/item/read.ts";

test("a note: the lead before the first heading, each heading a section to fold", () => {
  const n = parse(
    [
      "The UI a stranger can open on launch day.",
      "Still read-only.",
      "",
      "## Decided with the owner",
      "- First run is in.",
      "- Read-only for people:",
      "  agents write.",
      "",
      "### Order",
      "1. style",
      "2. views",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "> quoted",
      "```",
      "code here",
      "```",
    ].join("\n"),
  );
  assert.deepEqual(n.lead, [{ k: "p", text: "The UI a stranger can open on launch day. Still read-only." }]);
  assert.deepEqual(
    n.sections.map((s) => [s.title, s.depth]),
    [["Decided with the owner", 2], ["Order", 3]],
  );
  assert.deepEqual(n.sections[0]!.blocks, [{ k: "ul", items: ["First run is in.", "Read-only for people: agents write."] }]);
  assert.deepEqual(n.sections[1]!.blocks, [
    { k: "ol", items: ["style", "views"] },
    { k: "table", head: ["a", "b"], rows: [["1", "2"]] },
    { k: "quote", text: "quoted" },
    { k: "code", text: "code here" },
  ]);
  assert.deepEqual(parse(""), { lead: [], sections: [] });
  assert.deepEqual(parse("a\r\n\r\nb").lead.length, 2);
});

test("inline: code, bold, emphasis, links, and ids drawn as items", () => {
  assert.deepEqual(inline("See `x` and **y**, *z* in [the hub](i_mwpn5n9o72axz) or e_3pneg4cc."), [
    { k: "t", text: "See " },
    { k: "code", text: "x" },
    { k: "t", text: " and " },
    { k: "b", text: "y" },
    { k: "t", text: ", " },
    { k: "i", text: "z" },
    { k: "t", text: " in " },
    { k: "ref", id: "i_mwpn5n9o72axz", text: "the hub" },
    { k: "t", text: " or " },
    { k: "ref", id: "e_3pneg4cc" },
    { k: "t", text: "." },
  ]);
  assert.deepEqual(inline("[site](https://example.com) [file](../a.md)"), [
    { k: "a", text: "site", href: "https://example.com" },
    { k: "t", text: " file" },
  ]);
  assert.deepEqual(inline("snake_case_name stays"), [{ k: "t", text: "snake_case_name stays" }]);
  assert.deepEqual(refs("e_3pneg4cc then i_mwpn5n9o72axz and e_3pneg4cc"), ["e_3pneg4cc", "i_mwpn5n9o72axz"]);
});

test("fields as marks: by kind, besides title, note and status; a no is left out", () => {
  const defs = {
    title: { kind: "text" as const },
    status: { kind: "choice" as const },
    kind: { kind: "text" as const },
    held: { kind: "boolean" as const },
    gone: { kind: "boolean" as const },
    due: { kind: "date" as const },
    owner: { kind: "id" as const },
  };
  const out = marks({ title: "T", status: "todo", kind: "bug", held: true, gone: false, due: "2026-11-21T10:00:00Z", owner: "e_abcdef12", extra: "x".repeat(50) }, defs);
  assert.deepEqual(
    out.map((m) => [m.text, m.id]),
    [["kind bug", undefined], ["held", undefined], ["due 2026-11-21", undefined], ["owner e_abcdef12", "e_abcdef12"], [`extra ${"x".repeat(31)}…`, undefined]],
  );
  assert.equal(out.at(-1)!.full, `extra: ${"x".repeat(50)}`);
  assert.equal(shown({ kind: "number" }, 1200), "1,200");
});

test("neighbours: by kind of link, what it points at first, then what points at it", () => {
  const w = (id: string, type: string, from: string, to: string, fields = {}) => ({ id, type, from, to, fields });
  const g = neighbours("a", [w("l1", "part_of", "a", "hub"), w("l2", "depends_on", "b", "a"), w("l3", "depends_on", "a", "c", { for: "style" }), w("l4", "part_of", "d", "a"), w("l5", "depends_on", "a", "e")]);
  assert.deepEqual(
    g.map((x) => [x.dir, x.label, x.ends.map((e) => e.id)]),
    [["out", "part of", ["hub"]], ["out", "depends on", ["c", "e"]], ["in", "depends on", ["b"]], ["in", "part of", ["d"]]],
  );
  assert.equal(g[1]!.ends[0]!.for, "style");
});

test("a change set's lines about one item: made, fields from and to, links either way", () => {
  assert.deepEqual(lines("a", [["+", "a", "type", "work"], ["+", "a", "title", "T"]]), [{ k: "made" }]);
  assert.deepEqual(lines("a", [["-", "a", "type", "work"], ["-", "a", "title", "T"]]), [{ k: "removed" }]);
  assert.deepEqual(lines("a", [["-", "a", "status", "todo"], ["+", "a", "status", "doing"], ["+", "a", "kind", "bug"], ["-", "a", "due", "x"]]), [
    { k: "set", field: "status", from: "todo", to: "doing" },
    { k: "set", field: "kind", to: "bug" },
    { k: "set", field: "due", from: "x" },
  ]);
  assert.deepEqual(lines("a", [["+", "l", "type", "depends_on"], ["+", "l", "from", "b"], ["+", "l", "to", "a"]]), [{ k: "linked", kind: "depends_on", dir: "in", other: "b" }]);
  assert.deepEqual(lines("a", [["-", "l", "type", "part_of"], ["-", "l", "from", "a"], ["-", "l", "to", "h"]]), [{ k: "unlinked", kind: "part_of", dir: "out", other: "h" }]);
  assert.deepEqual(lines("a", [["+", "z", "type", "work"]]), [], "another item's change says nothing here");
  assert.equal(brief("short"), "short");
  assert.equal(brief("line\nbreak"), undefined);
  assert.equal(brief("x".repeat(41)), undefined);
});

test("ago: now, minutes, hours, days, then the date", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  assert.equal(ago("2026-11-21T11:59:30Z", now), "now");
  assert.equal(ago("2026-11-21T11:55:00Z", now), "5m");
  assert.equal(ago("2026-11-21T09:00:00Z", now), "3h");
  assert.equal(ago("2026-11-19T12:00:00Z", now), "2d");
  assert.equal(ago("2026-10-01T12:00:00Z", now), "2026-10-01");
  assert.equal(ago("nope", now), "");
});

test("others: the items a change reaches besides this one, which undo takes back too", () => {
  assert.equal(others("a", [["-", "a", "status", "todo"], ["+", "a", "status", "doing"]]), 0);
  assert.equal(others("a", [["+", "l1", "type", "part_of"], ["+", "l1", "from", "a"], ["+", "l1", "to", "h"]]), 0);
  assert.equal(
    others("a", [
      ["+", "l1", "type", "part_of"], ["+", "l1", "from", "a"], ["+", "l1", "to", "h"],
      ["+", "l2", "type", "part_of"], ["+", "l2", "from", "b"], ["+", "l2", "to", "h"],
      ["+", "c", "status", "done"],
    ]),
    3,
  );
});
