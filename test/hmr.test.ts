import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { ModuleGraph } from "../runtime/hmr.ts";
import { NodeHost, type HotResult } from "../runtime/node.ts";

/**
 * Fixture plugins on disk, so Node's real module loader is in play:
 * - word.ts: a plain module the provider imports.
 * - provider.ts: provides `demo.greet`, built from word.ts.
 * - consumer.ts: injects it and puts its greeting in the world.
 * The world is a set on globalThis: what is in it is what the plugins did.
 */
const dir = mkdtempSync(join(tmpdir(), "cordis-hmr-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, src: string) => writeFileSync(join(dir, name), src);
const world = () => [...((globalThis as { world?: Set<string> }).world ?? [])].sort();

const setWord = (w: string) => write("word.ts", `export const word: string = ${JSON.stringify(w)};\n`);
const setConsumer = (suffix: string) =>
  write(
    "consumer.ts",
    `
const g = globalThis as { world?: Set<string> };
export default {
  id: "consumer",
  inject: ["demo.greet"],
  apply(ctx: any) {
    const said = ctx.get("demo.greet") + "${suffix}";
    ctx.effect(() => {
      (g.world ??= new Set()).add(said);
      return () => g.world!.delete(said);
    });
  },
};
`,
  );
setWord("hello");
write(
  "provider.ts",
  `
import { word } from "./word.ts";
const g = globalThis as { world?: Set<string> };
export default {
  id: "provider",
  apply(ctx: any) {
    ctx.effect(() => {
      (g.world ??= new Set()).add("provider:" + word);
      return () => g.world!.delete("provider:" + word);
    });
    ctx.provide("demo.greet", () => word);
  },
};
`,
);
setConsumer("!");

const url = (name: string) => pathToFileURL(join(dir, name)).href;

test("the module graph accepts a change and everything that imports it", () => {
  const g = new ModuleGraph();
  g.record("a", "b");
  g.record("b", "c");
  g.record("x", "c");
  g.record("r", "c");
  const { accepted, declined } = g.classify(["c"], (u) => u === "r");
  assert.deepEqual([...accepted].sort(), ["a", "b", "c", "x"]);
  assert.deepEqual([...declined], ["r"]);
});

test("load, hot-reload, unload: the old version's effects go and nothing is left", async () => {
  const host = await new NodeHost({
    base: pathToFileURL(dir + "/").href,
    tree: [
      { id: "consumer", plugin: "consumer.ts" },
      { id: "provider", plugin: "provider.ts" },
    ],
  }).start();
  const { loader } = host;
  assert.deepEqual(world(), ["hello!", "provider:hello"]);

  // A change to a module the provider imports reloads the provider; the
  // consumer leaves with the old provider and comes back with the new one.
  const provider0 = loader.fiber("provider");
  const consumer0 = loader.fiber("consumer");
  setWord("bonjour");
  const r1 = await host.hot([join(dir, "word.ts")]);
  assert.deepEqual(r1.reloaded, ["provider"]);
  assert.deepEqual(world(), ["bonjour!", "provider:bonjour"]);
  assert.notEqual(loader.fiber("provider"), provider0);
  assert.equal(loader.fiber("consumer"), consumer0, "the consumer was re-applied, not rebuilt");
  assert.equal(provider0!.state, "inactive");

  // A change to the consumer alone leaves the provider be.
  const provider1 = loader.fiber("provider");
  setConsumer("?");
  const r2 = await host.hot([join(dir, "consumer.ts")]);
  assert.deepEqual(r2.reloaded, ["consumer"]);
  assert.deepEqual(world(), ["bonjour?", "provider:bonjour"]);
  assert.equal(loader.fiber("provider"), provider1);

  // A module that fails to import changes nothing (Algorithm 10).
  write("consumer.ts", "export default {{{ not code");
  const errors: unknown[] = [];
  host.runtime.onError = (_f, e) => errors.push(e);
  const r3 = await host.hot([join(dir, "consumer.ts")]);
  assert.ok(r3.error, "the import failed");
  assert.deepEqual(world(), ["bonjour?", "provider:bonjour"], "the old version still runs");
  assert.equal(loader.fiber("consumer")!.state, "active");

  setConsumer("!!");
  await host.hot([join(dir, "consumer.ts")]);
  assert.deepEqual(world(), ["bonjour!!", "provider:bonjour"]);

  await host.stop();
  assert.deepEqual(world(), [], "everything the plugins did is gone");
  assert.equal(host.runtime.fibers.size, 0);
});

test("the watcher hot-reloads a file edited on disk", async () => {
  setWord("hello");
  setConsumer("!");
  const reloads: HotResult[] = [];
  let notify: () => void = () => {};
  const host = await new NodeHost({
    base: pathToFileURL(dir + "/").href,
    tree: [
      { id: "provider", plugin: "provider.ts" },
      { id: "consumer", plugin: "consumer.ts" },
    ],
    watch: dir,
    onReload: (r) => {
      reloads.push(r);
      if (r.reloaded.length) notify();
    },
  }).start();
  try {
    assert.deepEqual(world(), ["hello!", "provider:hello"]);
    const seen = new Promise<void>((resolve) => (notify = resolve));
    setWord("hej");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([seen, new Promise((_, no) => (timer = setTimeout(() => no(new Error("no reload in 5s")), 5000)))]);
    clearTimeout(timer);
    assert.deepEqual(world(), ["hej!", "provider:hej"]);
  } finally {
    await host.stop();
  }
  assert.deepEqual(world(), []);
});

test("a change that reaches a declined module is not hot-reloaded: it needs a restart", async () => {
  setWord("hello");
  const host = await new NodeHost({
    base: pathToFileURL(dir + "/").href,
    tree: [{ id: "provider", plugin: "provider.ts" }],
    declined: (u) => u.endsWith("/word.ts"),
  }).start();
  const before = host.loader.fiber("provider");
  setWord("ciao");
  const r = await host.hot([join(dir, "word.ts")]);
  assert.deepEqual(r.reloaded, []);
  assert.deepEqual(r.restart, [url("word.ts")]);
  assert.equal(host.loader.fiber("provider"), before);
  await host.stop();
});
