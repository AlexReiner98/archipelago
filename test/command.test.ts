import assert from "node:assert/strict";
import { test } from "node:test";
import type { HereRead } from "../spec/here.ts";
import type { FillDef, SlotFill } from "../spec/slot.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import here from "../plugins/here/index.ts";
import command, { isToggle, OPEN } from "../plugins/command/index.ts";

test("Ctrl+K and ⌘K open and close the command line; nothing else does", () => {
  assert.equal(isToggle({ key: "k", ctrlKey: true }), true);
  assert.equal(isToggle({ key: "K", metaKey: true }), true);
  assert.equal(isToggle({ key: "k" }), false);
  assert.equal(isToggle({ key: "k", ctrlKey: true, shiftKey: true }), false);
  assert.equal(isToggle({ key: "j", ctrlKey: true }), false);
});

test("the command line fills over while command.open is set, and the keys set it", async () => {
  const g = globalThis as Record<string, unknown>;
  g.document ??= { createElement: () => ({ remove() {} }), head: { append() {} } };
  const page = new EventTarget();
  const had = g.addEventListener;
  g.addEventListener = page.addEventListener.bind(page);
  g.removeEventListener = page.removeEventListener.bind(page);
  const fills: FillDef<unknown>[] = [];
  const host: Plugin = {
    id: "host",
    apply(ctx) {
      ctx.provide("find.line", () => ({ Line: () => null, jump() {} }));
      ctx.provide<SlotFill>("slot.fill", () => ({ fill: (def) => (fills.push(def as FillDef<unknown>), () => {}) }));
    },
  };
  const rt = new Runtime();
  rt.onError = (_f, e) => {
    throw e;
  };
  const modules: Record<string, Plugin> = { host, here, command };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply(["host", "here", "command"].map((id) => ({ id, plugin: id })));
  const read = rt.root.get<HereRead>("here.read");

  assert.deepEqual(fills.map((f) => [f.slot, f.name, f.when]), [["over", "line", { [OPEN]: true }]]);
  const press = (init: Record<string, unknown>) => page.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), init));
  assert.equal(press({ key: "k", ctrlKey: true }), false, "the browser's own Ctrl+K is kept from happening");
  assert.equal(read.get(OPEN), true);
  press({ key: "x", ctrlKey: true });
  assert.equal(read.get(OPEN), true);
  press({ key: "k", metaKey: true });
  assert.equal(read.get(OPEN), undefined);

  await loader.apply([]);
  press({ key: "k", ctrlKey: true });
  g.addEventListener = had;
});
