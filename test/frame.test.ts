/**
 * The frame's folds (plugins/frame/fold.ts): which fills are folded, and when
 * a side shows as a rail. Input in, the folded list out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldedOf, foldRegion, isRail } from "../plugins/frame/fold.ts";

test("a side is a rail when every fill it shows is folded, and only then", () => {
  assert.equal(isRail(["harness/node"], ["harness/node", "harness/run"]), true);
  assert.equal(isRail(["harness/node", "item/pane"], ["harness/node"]), false);
  assert.equal(isRail([], ["harness/node"]), false, "an empty side takes no room, rail or not");
});

test("folding a side folds all its fills; opening it takes them out; others stay", () => {
  assert.deepEqual(foldRegion(["a/x"], ["harness/node"], true), ["a/x", "harness/node"]);
  assert.deepEqual(foldRegion(["a/x", "harness/node"], ["harness/node"], true), ["a/x", "harness/node"], "no repeats");
  assert.deepEqual(foldRegion(["a/x", "harness/node", "harness/run"], ["harness/node"], false), ["a/x", "harness/run"]);
});

test("the folded list comes from the page key, else the config's default", () => {
  assert.deepEqual(foldedOf(undefined, ["harness/run"]), ["harness/run"]);
  assert.deepEqual(foldedOf([], ["harness/run"]), [], "opened everything: stays open");
  assert.deepEqual(foldedOf(["a/x", 3]), ["a/x"]);
});

test("the center shows the fill here.view names; else the first, unless it waits for a first pick", async () => {
  const { centerShown } = await import("../plugins/frame/center.ts");
  const fills = ["harness/view", "field/field"];
  const id = (f: string) => f;
  assert.equal(centerShown(fills, id, "field/field", true), "field/field");
  assert.equal(centerShown(fills, id, undefined, false), "harness/view", "not waiting: the first stands in");
  assert.equal(centerShown(fills, id, undefined, true), undefined, "waiting: nothing until a view is picked");
  assert.equal(centerShown(fills, id, "gone/view", true), undefined);
});
