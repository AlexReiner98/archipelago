import assert from "node:assert/strict";
import { test } from "node:test";
import type { Caller, Dispose } from "../spec/common.ts";
import { byPosition } from "../spec/common.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, move, type Entry } from "../runtime/loader.ts";

const BASE = "mem:/packs/";

/** A loader over modules held in memory, keyed by url. */
function setup(modules: Record<string, Pack>) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, {
    base: BASE,
    import: async (url) => {
      const m = modules[url.slice(BASE.length)];
      if (!m) throw new Error(`no module ${url}`);
      return { default: m };
    },
  });
  return { rt, loader, errors };
}

interface Words {
  say(word: string): Dispose;
  all(): string[];
}

/** A broker that orders what packs say by the config tree. */
const words: Pack = {
  id: "words",
  apply(ctx) {
    const said: { caller: Caller; seq: number; word: string }[] = [];
    let seq = 0;
    ctx.provide<Words>("demo.words", (caller, from) => ({
      say: (word) =>
        from.effect(() => {
          const e = { caller, seq: seq++, word };
          said.push(e);
          return () => said.splice(said.indexOf(e), 1);
        }),
      all: () => [...said].sort((a, b) => byPosition(a.caller, b.caller) || a.seq - b.seq).map((e) => e.word),
    }));
  },
};

const speaker: Pack<{ words: string[] }> = {
  id: "speaker",
  inject: ["demo.words"],
  apply(ctx, config) {
    const w = ctx.get<Words>("demo.words");
    for (const word of config.words) w.say(word);
  },
};

const all = (rt: Runtime) => rt.root.get<Words>("demo.words").all();

test("the config tree loads, disables, reconfigures and unloads entries", async () => {
  const { rt, loader } = setup({ "words.ts": words, "speaker.ts": speaker });
  const tree: Entry[] = [
    { id: "a", pack: "speaker.ts", config: { words: ["a"] } },
    { id: "words", pack: "words.ts" },
    { id: "b", pack: "speaker.ts", config: { words: ["b"] } },
  ];
  await loader.apply(tree);
  assert.deepEqual(all(rt), ["a", "b"]);

  await loader.edit((t) => (t[0]!.disabled = true, t));
  assert.deepEqual(all(rt), ["b"]);
  assert.equal(loader.status()[0]!.state, "off");

  await loader.edit((t) => (delete t[0]!.disabled, (t[2]!.config = { words: ["b2", "b3"] }), t));
  assert.deepEqual(all(rt), ["a", "b2", "b3"]);

  await loader.edit((t) => t.filter((e) => e.id !== "a"));
  assert.deepEqual(all(rt), ["b2", "b3"]);

  await loader.apply([]);
  assert.equal(rt.fibers.size, 0, "nothing is left");
});

test("moving an entry reorders what it contributed, without reloading", async () => {
  const { rt, loader } = setup({ "words.ts": words, "speaker.ts": speaker });
  await loader.apply([
    { id: "words", pack: "words.ts" },
    { id: "a", pack: "speaker.ts", config: { words: ["a"] } },
    { id: "g", children: [{ id: "b", pack: "speaker.ts", config: { words: ["b"] } }] },
  ]);
  assert.deepEqual(all(rt), ["a", "b"]);
  const fa = loader.fiber("a");
  await loader.edit((t) => move(t, "a", "g", 1));
  assert.deepEqual(all(rt), ["b", "a"]);
  assert.equal(loader.fiber("a"), fa, "same fiber");
  assert.deepEqual(fa!.position(), [1, 1], "a now sits second in g");
});

test("a disabled group turns off everything in it", async () => {
  const { rt, loader } = setup({ "words.ts": words, "speaker.ts": speaker });
  await loader.apply([
    { id: "words", pack: "words.ts" },
    { id: "g", disabled: true, children: [{ id: "a", pack: "speaker.ts", config: { words: ["a"] } }] },
  ]);
  assert.deepEqual(all(rt), []);
  await loader.edit((t) => (delete t[1]!.disabled, t));
  assert.deepEqual(all(rt), ["a"]);
});

test("the first provider in the tree is the one bound; moving it switches", async () => {
  const named = (name: string): Pack => ({
    id: name,
    apply: (ctx) => void ctx.provide("demo.name", () => name),
  });
  const reader: Pack = { id: "reader", inject: ["demo.name"], apply() {} };
  const { rt, loader } = setup({ "one.ts": named("one"), "two.ts": named("two"), "reader.ts": reader });
  await loader.apply([
    { id: "one", pack: "one.ts" },
    { id: "two", pack: "two.ts" },
    { id: "r", pack: "reader.ts" },
  ]);
  assert.equal(loader.fiber("r")!.ctx.get("demo.name"), "one");
  await loader.edit((t) => move(t, "two", null, 0));
  assert.equal(loader.fiber("r")!.ctx.get("demo.name"), "two", "rebound to the new first");
  await loader.edit((t) => t.filter((e) => e.id !== "two"));
  assert.equal(loader.fiber("r")!.ctx.get("demo.name"), "one");
  assert.equal(rt.root.get("demo.name"), "one");
});

test("an entry's intercept reaches providers as the actor and run, updated in place", async () => {
  const seen: Caller[] = [];
  const who: Pack = {
    id: "who",
    apply: (ctx) => void ctx.provide("demo.who", (caller) => ({ ask: () => seen.push({ ...caller, position: caller.position }) })),
  };
  let applies = 0;
  const asker: Pack = {
    id: "asker",
    inject: ["demo.who"],
    apply(ctx) {
      applies++;
      (globalThis as { ask?: () => void }).ask = () => ctx.get<{ ask(): void }>("demo.who").ask();
    },
  };
  const { loader } = setup({ "who.ts": who, "asker.ts": asker });
  const actor = { id: "e_alex", kind: "person" };
  await loader.apply([
    { id: "who", pack: "who.ts" },
    { id: "page", intercept: { actor }, children: [{ id: "asker", pack: "asker.ts" }] },
  ]);
  const ask = () => (globalThis as { ask?: () => void }).ask!();
  ask();
  await loader.edit((t) => ((t[1]!.intercept = { actor, run: "e_run2" }), t));
  ask();
  assert.equal(applies, 1, "no reload for a new intercept");
  assert.deepEqual(seen, [
    { pack: "asker", actor, run: undefined, position: [1, 0] },
    { pack: "asker", actor, run: "e_run2", position: [1, 0] },
  ]);
});

test("a module that fails to import is reported and the rest still load", async () => {
  const { rt, loader, errors } = setup({ "words.ts": words });
  await loader.apply([
    { id: "words", pack: "words.ts" },
    { id: "gone", pack: "missing.ts" },
  ]);
  assert.equal(errors.length, 1);
  assert.deepEqual(
    loader.status().map((s) => [s.id, s.state]),
    [
      ["words", "active"],
      ["gone", "failed"],
    ],
  );
  assert.deepEqual(rt.keys(), ["demo.words"]);
});

test("status says off for a disabled entry, and waiting with what it misses", async () => {
  const { loader } = setup({ "words.ts": words, "speaker.ts": speaker });
  await loader.apply([
    { id: "a", pack: "speaker.ts", config: { words: ["a"] } },
    { id: "b", pack: "speaker.ts", config: { words: ["b"] }, disabled: true },
  ]);
  const state = () => loader.status().map(({ id, state, missing }) => ({ id, state, missing }));
  assert.deepEqual(state(), [
    { id: "a", state: "waiting", missing: ["demo.words"] },
    { id: "b", state: "off", missing: undefined },
  ]);
  await loader.edit((t) => [{ id: "words", pack: "words.ts" }, ...t]);
  assert.deepEqual(state(), [
    { id: "words", state: "active", missing: undefined },
    { id: "a", state: "active", missing: undefined },
    { id: "b", state: "off", missing: undefined },
  ]);
});
