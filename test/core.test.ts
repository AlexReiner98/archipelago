import assert from "node:assert/strict";
import { test } from "node:test";
import type { Caller, Dispose } from "../spec/common.ts";
import { byPosition } from "../spec/common.ts";
import { Runtime, type Pack } from "../runtime/core.ts";

/** A broker in the smallest form: packs add items, a reader lists them in tree order. */
interface List {
  add(item: string): Dispose;
  items(): string[];
}

function listProvider(log: string[] = []): Pack {
  return {
    id: "list",
    apply(ctx) {
      const entries: { caller: Caller; seq: number; item: string }[] = [];
      let seq = 0;
      log.push("list up");
      ctx.effect(() => () => log.push("list down"));
      ctx.provide<List>("demo.list", (caller, from) => ({
        // The registration is the caller's effect, not the provider's.
        add: (item) =>
          from.effect(() => {
            const e = { caller, seq: seq++, item };
            entries.push(e);
            return () => entries.splice(entries.indexOf(e), 1);
          }),
        items: () =>
          [...entries].sort((a, b) => byPosition(a.caller, b.caller) || a.seq - b.seq).map((e) => e.item),
      }));
    },
  };
}

function contributor(id: string, items: string[], log: string[] = []): Pack {
  return {
    id,
    inject: ["demo.list"],
    apply(ctx) {
      log.push(`${id} up`);
      ctx.effect(() => () => log.push(`${id} down`));
      const list = ctx.get<List>("demo.list");
      for (const item of items) list.add(item);
    },
  };
}

test("an effect is reverted when its pack unloads, and dispose is idempotent", async () => {
  const rt = new Runtime();
  const world = new Set<string>();
  let early: Dispose = () => {};
  const fiber = rt.root.plugin({
    id: "p",
    apply(ctx) {
      ctx.effect(() => {
        world.add("a");
        return () => world.delete("a");
      });
      early = ctx.effect(() => {
        world.add("b");
        return () => world.delete("b");
      });
    },
  });
  await rt.settle();
  assert.equal(fiber.state, "active");
  assert.deepEqual([...world], ["a", "b"]);
  await early();
  await early();
  assert.deepEqual([...world], ["a"]);
  await fiber.dispose();
  assert.equal(fiber.state, "inactive");
  assert.deepEqual([...world], []);
  assert.equal(rt.fibers.size, 0);
});

test("a consumer waits for its provider, leaves before it, and comes back with it", async () => {
  const rt = new Runtime();
  const log: string[] = [];
  const consumer = rt.root.plugin(contributor("c", ["x"], log));
  await rt.settle();
  assert.equal(consumer.state, "inactive", "no provider yet");

  let provider = rt.root.plugin(listProvider(log));
  await rt.settle();
  assert.equal(consumer.state, "active");
  assert.deepEqual(rt.root.get<List>("demo.list").items(), ["x"]);

  log.length = 0;
  await provider.dispose();
  await rt.settle();
  assert.equal(consumer.state, "inactive");
  assert.deepEqual(log, ["c down", "list down"], "the dependent tears down first");

  provider = rt.root.plugin(listProvider(log));
  await rt.settle();
  assert.equal(consumer.state, "active");
  assert.deepEqual(rt.root.get<List>("demo.list").items(), ["x"]);
});

test("what a pack registers through a provider goes when the pack unloads", async () => {
  const rt = new Runtime();
  rt.root.plugin(listProvider());
  const a = rt.root.plugin(contributor("a", ["a1", "a2"]));
  rt.root.plugin(contributor("b", ["b1"]));
  await rt.settle();
  const list = rt.root.get<List>("demo.list");
  assert.deepEqual(list.items(), ["a1", "a2", "b1"]);
  await a.dispose();
  assert.deepEqual(list.items(), ["b1"]);
});

test("a key not injected is refused, and a key not provided is inactive", async () => {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  rt.root.plugin(listProvider());
  const sneaky = rt.root.plugin({ id: "sneaky", apply: (ctx) => void ctx.get("demo.list") });
  await rt.settle();
  assert.equal(sneaky.state, "failed");
  assert.match(String(errors[0]), /was not injected/);
});

test("the provider is told who calls: pack, actor and run, position", async () => {
  const rt = new Runtime();
  const seen: Caller[] = [];
  rt.root.plugin({
    id: "who",
    apply(ctx) {
      ctx.provide("demo.who", (caller) => ({ ask: () => seen.push({ ...caller, position: caller.position }) }));
    },
  });
  rt.root.plugin({
    id: "asker",
    inject: ["demo.who"],
    apply(ctx) {
      ctx.get<{ ask(): void }>("demo.who").ask();
      const run = ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "e_run1" });
      run.get<{ ask(): void }>("demo.who").ask();
    },
  });
  await rt.settle();
  assert.deepEqual(seen, [
    { pack: "asker", actor: undefined, run: undefined, position: [1] },
    { pack: "asker", actor: { id: "e_agent", kind: "agent" }, run: "e_run1", position: [1] },
  ]);
});

test("a failing pack takes back what it registered and stays failed until its target moves", async () => {
  const rt = new Runtime();
  rt.onError = () => {};
  const world = new Set<string>();
  const fiber = rt.root.plugin({
    id: "bad",
    apply(ctx) {
      ctx.effect(() => {
        world.add("half");
        return () => world.delete("half");
      });
      throw new Error("boom");
    },
  });
  await rt.settle();
  assert.equal(fiber.state, "failed");
  assert.equal(world.size, 0);
  await fiber.dispose();
  assert.equal(fiber.state, "inactive");
});

test("an apply that is a generator yields inverses, run last first", async () => {
  const rt = new Runtime();
  const log: string[] = [];
  const fiber = rt.root.plugin({
    id: "gen",
    *apply() {
      log.push("one");
      yield () => void log.push("undo one");
      log.push("two");
      yield () => void log.push("undo two");
    },
  });
  await rt.settle();
  assert.equal(fiber.state, "active");
  await fiber.dispose();
  assert.deepEqual(log, ["one", "two", "undo two", "undo one"]);
});

test("unloading a parent unloads the packs it plugged in", async () => {
  const rt = new Runtime();
  const world = new Set<string>();
  const child: Pack = {
    id: "child",
    apply(ctx) {
      ctx.effect(() => {
        world.add("child");
        return () => world.delete("child");
      });
    },
  };
  const parent = rt.root.plugin({ id: "parent", apply: (ctx) => void ctx.plugin(child) });
  await rt.settle();
  assert.deepEqual([...world], ["child"]);
  const [inner] = [...rt.fibers].filter((f) => f.pack.id === "child");
  assert.deepEqual(inner!.position(), [0, 0]);
  await parent.dispose();
  assert.deepEqual([...world], []);
  assert.equal(rt.fibers.size, 0);
});

test("a provider leaves even when a consumer's teardown hangs; the hang is reported", async () => {
  const rt = new Runtime();
  rt.teardownLimit = 50;
  const errors: string[] = [];
  rt.onError = (f, e) => errors.push(`${f.pack.id}: ${(e as Error).message}`);
  const provider = rt.root.plugin(listProvider());
  const stuck = rt.root.plugin({
    id: "stuck",
    inject: ["demo.list"],
    apply(ctx) {
      ctx.effect(() => () => new Promise(() => {})); // an undo that never ends
    },
  });
  await rt.settle();
  assert.equal(stuck.state, "active");
  const started = Date.now();
  await provider.dispose();
  assert.equal(provider.state, "inactive");
  assert.ok(Date.now() - started < 1000, "removal did not wait forever");
  await rt.settle();
  assert.equal(stuck.state, "inactive", "the consumer is waiting again");
  assert.ok(errors.some((e) => e.includes("an undo took over 50ms")));
});
