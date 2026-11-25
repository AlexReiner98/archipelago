/**
 * The light carried from graph to graph (plugins/field/carry.ts): a new graph renumbers the particles, and what
 * the pointer lit stays on the same items. Input in, the renumbered light out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { carryIndex, carryLight } from "../plugins/field/carry.ts";

const last = { id: ["a", "b", "c"] };
// A session came first: every item moves one place on, and c is gone.
const next = { n: 3, idIx: new Map([["s", 0], ["a", 1], ["b", 2]]) };

test("carryIndex: the same item in the next graph, or -1", () => {
  assert.equal(carryIndex(last, next, 1), 2);
  assert.equal(carryIndex(last, next, 2), -1, "gone");
  assert.equal(carryIndex(last, next, -1), -1, "nothing pointed at");
  assert.equal(carryIndex(null, next, 0), -1, "no graph before");
});

test("carryLight: what was lit stays lit on the same items, the focus with them", () => {
  const out = carryLight(last, next, Float32Array.from([1, 0.5, 0.25]), new Set([0, 1, 2]), 0);
  assert.deepEqual([...out.shine], [0, 1, 0.5]);
  assert.deepEqual([...out.shining].sort(), [1, 2]);
  assert.equal(out.focus, 1);
});
