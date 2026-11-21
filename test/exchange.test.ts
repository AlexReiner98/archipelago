/**
 * The exchange pack's record (Log): runs come last active first, and a
 * run's end counts only after its last begin. Events in, runs out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import exchange, { Log } from "../packs/exchange/index.ts";
import type { ExchangeAppend, ExchangeEvent, ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";

const BASE = "mem:/packs/";

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

test("exchange.read.runs is last active first, through the pack", async () => {
  const rt = new Runtime();
  const probe: Pack = { id: "probe", inject: ["exchange.append", "exchange.read"], apply() {} };
  const modules: Record<string, Pack> = { "exchange.ts": exchange, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  await loader.apply([
    { id: "exchange", pack: "exchange.ts" },
    { id: "probe", pack: "probe.ts" },
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
