/**
 * The exchange plugin's record (Log): runs come last active first, and a
 * run's end counts only after its last begin. Events in, runs out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import exchange, { Journal, Log } from "../plugins/exchange/index.ts";
import type { ExchangeAppend, ExchangeEvent, ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";

const BASE = "mem:/plugins/";

const begin = (run: string, time: string, title?: string): Omit<ExchangeEvent, "id" | "seq"> => ({
  run,
  time,
  direction: "to_agent",
  kind: "begin",
  detail: { run, started: time, ...(title ? { title } : {}) } as unknown as ExchangeEvent["detail"],
});
const say = (run: string, time: string): Omit<ExchangeEvent, "id" | "seq"> => ({ run, time, direction: "to_agent", kind: "say", node: "words/a", text: "x" });
const end = (run: string, time: string): Omit<ExchangeEvent, "id" | "seq"> => ({ run, time, direction: "to_agent", kind: "end" });

test("runs come by their last event: a long run acting now is before one that began later and stopped", () => {
  const log = new Log();
  log.add(begin("long", "2026-11-18T09:00:00Z"));
  log.add(begin("short", "2026-11-21T09:00:00Z"));
  log.add(end("short", "2026-11-21T09:05:00Z"));
  assert.deepEqual([...log.order], ["long", "short"]);
  log.add(say("long", "2026-11-21T10:00:00Z"));
  assert.deepEqual([...log.order], ["short", "long"]);
});

test("a run that begins again after its end is open again", () => {
  const log = new Log();
  log.add(begin("r", "2026-11-21T09:00:00Z", "First"));
  log.add(end("r", "2026-11-21T09:10:00Z"));
  assert.equal(log.info("r")?.ended, "2026-11-21T09:10:00Z");
  log.add(begin("r", "2026-11-21T11:00:00Z", "Again"));
  const info = log.info("r");
  assert.equal(info?.ended, undefined);
  assert.equal(info?.started, "2026-11-21T09:00:00Z");
  assert.equal(info?.title, "Again");
  log.add(end("r", "2026-11-21T12:00:00Z"));
  assert.equal(log.info("r")?.ended, "2026-11-21T12:00:00Z");
});

test("a run says when it was last heard from: its latest event's time", () => {
  const log = new Log();
  log.add(begin("r", "2026-11-21T09:00:00Z", "First"));
  assert.equal(log.info("r")?.last, "2026-11-21T09:00:00Z");
  log.add(say("r", "2026-11-21T09:20:00Z"));
  assert.equal(log.info("r")?.last, "2026-11-21T09:20:00Z");
});

test("exchange.read.runs is last active first, through the plugin", async () => {
  const rt = new Runtime();
  const probe: Plugin = { id: "probe", inject: ["exchange.append", "exchange.read"], apply() {} };
  const modules: Record<string, Plugin> = { "exchange.ts": exchange, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  await loader.apply([
    { id: "exchange", plugin: "exchange.ts" },
    { id: "probe", plugin: "probe.ts" },
  ]);
  const ctx = loader.fiber("probe")!.ctx;
  const append = ctx.get<ExchangeAppend>("exchange.append");
  const read = ctx.get<ExchangeRead>("exchange.read");
  await append.append(begin("long", "2026-11-18T09:00:00Z", "Long"));
  await append.append(begin("short", "2026-11-21T09:00:00Z", "Short"));
  await append.append(end("short", "2026-11-21T09:05:00Z"));
  assert.deepEqual((await read.runs()).items.map((r) => r.run), ["short", "long"]);
  await append.append(say("long", "2026-11-21T10:00:00Z"));
  const runs = (await read.runs()).items;
  assert.deepEqual(runs.map((r) => r.run), ["long", "short"]);
  assert.equal(runs[0]!.ended, undefined);
  assert.equal(runs[1]!.ended, "2026-11-21T09:05:00Z");
});

const act = (run: string, time: string, output: string): Omit<ExchangeEvent, "id" | "seq"> => ({
  run,
  time,
  direction: "from_agent",
  kind: "act",
  act: { kind: "tool", input: { q: "é" }, output } as unknown as ExchangeEvent["act"],
});

/** The plugin over a journal file, as a fresh start reads it. */
async function pluginOver(journal: string) {
  const rt = new Runtime();
  const probe: Plugin = { id: "probe", inject: ["exchange.append", "exchange.read"], apply() {} };
  const modules: Record<string, Plugin> = { "exchange.ts": exchange, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  await loader.apply([
    { id: "exchange", plugin: "exchange.ts", config: { journal } },
    { id: "probe", plugin: "probe.ts" },
  ]);
  const ctx = loader.fiber("probe")!.ctx;
  return { append: ctx.get<ExchangeAppend>("exchange.append"), read: ctx.get<ExchangeRead>("exchange.read") };
}

test("with a journal, an act's body stays in the file and a page reads it back whole, before and after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "exchange-"));
  try {
    const file = join(dir, "exchange.jsonl");
    const first = await pluginOver(file);
    await first.append.append(begin("r", "2026-11-24T09:00:00Z", "R"));
    await first.append.append(act("r", "2026-11-24T09:01:00Z", "ü".repeat(70_000)));
    await first.append.append(say("r", "2026-11-24T09:02:00Z"));
    await first.append.append(act("r", "2026-11-24T09:03:00Z", "second"));
    const before = (await first.read.events("r")).items;
    assert.equal((before[1]!.act as { output: string }).output.length, 70_000);
    assert.equal((before[3]!.act as { output: string }).output, "second");
    const again = await pluginOver(file);
    const after = (await again.read.events("r")).items;
    assert.deepEqual(after, before);
    assert.equal((await again.read.events("r", { after: "3", limit: 1 })).items[0]!.act !== undefined, true);
    const j = new Journal(file);
    const held = new Log(j.keep);
    await j.load(held);
    assert.equal(held.runs.get("r")!.filter((e) => e.act).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
