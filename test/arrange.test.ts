import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, profileTerm } from "../packs/arrange/arrange.ts";
import type { NodeInfo } from "../spec/agent.ts";

const node = (id: string, title: string, at: string[], source?: string) => ({ id, title, at, kind: "instruction", pack: "words", ...(source ? { source } : {}) }) as unknown as NodeInfo;

test("profileTerm: the profile a find line names, underscores as spaces; none, undefined", () => {
  assert.equal(profileTerm("profile:Copy"), "Copy");
  assert.equal(profileTerm("pricing profile:Map_habits"), "Map habits");
  assert.equal(profileTerm("profiles are not a term"), undefined);
  assert.equal(profileTerm(""), undefined);
});

test("arrange: an item on the map gets its node's place in the tree; a node no item holds is a ghost; boughs and branches come too", () => {
  const nodes = [
    node("words/a", "Check before you stop", ["reply_end"], "e_a"),
    node("words/b", "No secrets", ["file:.env"], "e_b"),
    node("since/heard", "Since you last heard", ["prompt"]),
  ];
  const a = arrange("Copy", nodes, (id) => id === "e_a" || id === "e_b");
  assert.equal(a.profile, "Copy");
  assert.deepEqual(Object.keys(a.items).sort(), ["e_a", "e_b"]);
  for (const [x, y] of Object.values(a.items)) assert.ok(Number.isFinite(x) && Number.isFinite(y));
  assert.deepEqual(a.ghosts.map((g) => g.text), ["Since you last heard"]);
  assert.ok(a.boughs.some((b) => /reply/.test(b.text)), "the reply_end bough is named");
  assert.ok(a.wires.length >= nodes.length, "a branch to every node and bough");
  assert.ok(a.wires.every((w) => w.length >= 2));
});

test("arrange: an item not on the map is a ghost, not a place", () => {
  const a = arrange("Copy", [node("words/a", "Check before you stop", ["reply_end"], "e_gone")], () => false);
  assert.deepEqual(a.items, {});
  assert.equal(a.ghosts.length, 1);
});
