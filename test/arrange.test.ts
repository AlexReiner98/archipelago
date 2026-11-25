import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, contextTerm } from "../plugins/arrange/arrange.ts";
import type { NodeInfo } from "../spec/agent.ts";

const node = (id: string, title: string, at: string[], source?: string) => ({ id, title, at, kind: "instruction", plugin: "words", ...(source ? { source } : {}) }) as unknown as NodeInfo;

test("contextTerm: the context filter a find line names, underscores as spaces; none, undefined", () => {
  assert.equal(contextTerm("context:Copy"), "Copy");
  assert.equal(contextTerm("pricing context:Map_habits"), "Map habits");
  assert.equal(contextTerm("context filters are not a term"), undefined);
  assert.equal(contextTerm("profile:Copy"), undefined, "the old term names nothing");
  assert.equal(contextTerm(""), undefined);
});

test("arrange: an item on the map gets its node's place in the tree; a node no item holds is a ghost; boughs and branches come too", () => {
  const nodes = [
    node("words/a", "Check before you stop", ["reply_end"], "e_a"),
    node("words/b", "No secrets", ["file:.env"], "e_b"),
    node("since/heard", "Since you last heard", ["prompt"]),
  ];
  const a = arrange("Copy", nodes, (id) => (id === "e_a" || id === "e_b" ? id : undefined));
  assert.equal(a.profile, "Copy");
  assert.deepEqual(Object.keys(a.items).sort(), ["e_a", "e_b"]);
  for (const [x, y] of Object.values(a.items)) assert.ok(Number.isFinite(x) && Number.isFinite(y));
  assert.deepEqual(a.ghosts.map((g) => g.text), ["Since you last heard"]);
  assert.ok(a.boughs.some((b) => /reply/.test(b.text)), "the reply_end bough is named");
  assert.ok(a.wires.length >= nodes.length, "a branch to every node and bough");
  assert.ok(a.wires.every((w) => w.length >= 2));
  assert.equal(a.branches.length, a.wires.length, "each branch also as the context view's curve");
  assert.ok(a.branches.every((b) => b.d.startsWith("M") && b.d.includes(" C") && b.width > 0 && b.ink > 0));
});

test("arrange: an item not on the map is a ghost, not a place", () => {
  const a = arrange("Copy", [node("words/a", "Check before you stop", ["reply_end"], "e_gone")], () => undefined);
  assert.deepEqual(a.items, {});
  assert.equal(a.ghosts.length, 1);
});

test("arrange: a node said through a context filter link flies the item the link brings", () => {
  const links: Record<string, string> = { l_rule: "r_rule" };
  const a = arrange("Archipelago", [node("words/l_rule", "No pills", ["file:plugins/map/**"], "l_rule")], (source) => links[source]);
  assert.deepEqual(Object.keys(a.items), ["r_rule"]);
  assert.deepEqual(a.ghosts, []);
});

test("arrange: each tree name comes placed as the context view places it, so the Landscape names the tree alike", () => {
  const nodes = [node("words/a", "Check before you stop", ["reply_end"], "e_a"), node("words/b", "Semantic HTML", ["file:*.html"], "e_b"), node("words/c", "Small commits", ["tool:Bash"], "e_c")];
  const a = arrange("Copy", nodes, () => undefined);
  assert.equal(a.nameText, 11);
  for (const n of [...a.boughs, ...a.ghosts]) {
    assert.ok(n.label, `${n.text} has its placement`);
    assert.ok(n.label!.anchor === "start" || n.label!.anchor === "end");
    assert.ok(n.label!.turn > -90 - 1e-6 && n.label!.turn <= 90 + 1e-6, "it reads left to right");
  }
});

test("arrange: an item the tree holds gets its name as the context view places it, for the tree to draw as it lands", () => {
  const nodes = [node("words/a", "Check before you stop", ["reply_end"], "e_a"), node("words/b", "Semantic HTML", ["file:*.html"], "e_b")];
  const a = arrange("Copy", nodes, (id) => (id === "e_a" ? id : undefined));
  assert.ok(a.items.e_a);
  assert.equal(a.names!.e_a!.text, "Check before you stop");
  assert.ok(a.names!.e_a!.label.anchor === "start" || a.names!.e_a!.label.anchor === "end");
  assert.equal(a.names!.e_b, undefined, "a node no item holds is a ghost, named by the tree as before");
});
