import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { Fact } from "../spec/changeset.ts";
import type { Json } from "../spec/common.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import grow from "../packs/grow/index.ts";
import keep, { type Review } from "../packs/keep/index.ts";
import replay from "../packs/replay/index.ts";
import scripted, { playAs, type Script, type ScriptedPlay } from "../packs/scripted/index.ts";
import verdict, { type VerdictRead } from "../packs/verdict/index.ts";
import words from "../packs/words/index.ts";

const CWD = "C:\\Users\\me\\repo";
const MISS = "server answered 429 empty body";
const T = (m: number) => `2026-11-24T10:${String(m).padStart(2, "0")}:00.000Z`;

const probe: Pack = {
  id: "probe",
  inject: ["agent.run", "action.invoke", "action.register", "graph.read", "exchange.read", "verdict.read", "scripted.play"],
  apply(ctx) {
    // Stands in for grow.trial's fields.
    ctx.get<ActionRegister>("action.register").register({
      name: "probe.write",
      title: "write facts",
      input: { type: "object" },
      async run(input: { facts: Fact[] }, call) {
        call.write(input.facts);
        return {};
      },
    });
  },
};

/** A run that calls Bash once: `out`, worked or not, then replies. */
const bash = (m: number, out: string, ok: boolean, more: Script["steps"] = []): Script => ({
  start: { cwd: CWD, title: `run at ${m}`, harness: "test" },
  steps: [{ prompt: "Fetch it.", time: T(m) }, { tool: "Bash", input: { command: "curl x" }, output: out, ok, time: T(m) }, ...more, { reply: "Done.", time: T(m) }],
});
/** A run that only edits a file. */
const edit = (m: number): Script => ({
  start: { cwd: CWD, harness: "test" },
  steps: [{ tool: "Edit", input: { file_path: `${CWD}\\a.ts` }, output: "ok", time: T(m) }, { reply: "Done.", time: T(m) }],
});

async function setup(config: Record<string, unknown> = {}, more: string[] = []) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack<any>> = { graph, action, exchange, agent, verdict, words, scripted, keep, replay, probe, grow };
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const ids = ["graph", "action", "exchange", "agent", "verdict", "words", "scripted", ...more, "probe", "keep", "replay"];
  const tree: Entry[] = ids.map((id) => ({ id, pack: id, ...(id === "replay" ? { config } : id === "keep" ? { config: { apply: false } } : {}) }));
  await loader.apply(tree);
  await rt.settle();
  assert.deepEqual(errors, []);
  const ctx = () => loader.fiber("probe")!.ctx.intercept({ actor: { id: "person:owner", kind: "person" } });
  const invoke = (a: string, input: Record<string, unknown>): Promise<any> =>
    ctx().get<ActionInvoke>("action.invoke").invoke<any>({ action: a, input: input as Json, authority: { of: "human", basis: "test" }, reason: "test" });
  const play = (run: string, script: Script) => playAs(loader.fiber("probe")!.ctx, script, { run });
  /** A trial node at tool:Bash for the 429 miss, written in `from`. */
  const trial = async (from: string) => {
    const out = await invoke("words.add", { title: "Back off on 429", at: ["tool:Bash"], words: "On 429, back off and retry." });
    assert.ok(out.ok, JSON.stringify(out));
    const id = out.output.node as string;
    assert.ok((await invoke("probe.write", { facts: [["+", id, "status", "trial"], ["+", id, "misses", MISS], ["+", id, "from_run", from]] })).ok);
    await rt.settle();
    return id;
  };
  const settle = async (ms = 900) => {
    await new Promise((r) => setTimeout(r, ms));
    await rt.settle();
  };
  const verdicts = () => ctx().get<VerdictRead>("verdict.read");
  const read = () => ctx().get<ExchangeRead>("exchange.read");
  return { rt, loader, errors, invoke, play, trial, settle, verdicts, read };
}

test("a trial node is replayed on past runs where its place came up, and judged there apart from its live record", async () => {
  const { errors, invoke, play, trial, settle, verdicts, read, loader } = await setup();
  await play("r1", bash(1, MISS, false));
  await play("r2", bash(2, MISS, false));
  await play("r3", edit(3)); // its place never came up
  await play("r4", bash(4, "Server answered 429 empty body; backed off, retried, fine.", true)); // the situation, gone right
  await play("r5", bash(5, MISS, false)); // the run it was written in
  const id = await trial("r5");
  await settle();

  const node = ((await invoke("keep.review", { node: id })).output as Review).nodes[0]!.node!;
  const list = (await verdicts().verdicts(node, { limit: 50 })).items;
  assert.deepEqual(list.map((v) => [v.replay_of, v.verdict]), [["r1", "failed"], ["r2", "failed"], ["r4", "held"]], "newest first: r4, r2, r1 replayed; r3 and r5 not");
  assert.equal(await verdicts().record(node), undefined, "no live run said it");
  const rep = await verdicts().replayed(node);
  assert.deepEqual([rep?.runs, rep?.held, rep?.failed], [3, 1, 2]);

  // A replay is a run of its own, harness scripted, with the recorded run as `replay_of`.
  const runs = (await read().runs({ limit: 50 })).items.filter((r) => r.facts?.replay_of);
  assert.deepEqual(runs.map((r) => [r.facts!.replay_of, r.harness]).sort(), [["r1", "scripted"], ["r2", "scripted"], ["r4", "scripted"]]);

  const review = (await invoke("keep.review", { node: id })).output as Review;
  const r = review.nodes[0]!;
  assert.equal(r.record, undefined);
  assert.deepEqual([r.replayed?.runs, r.replayed?.held, r.replayed?.failed], [3, 1, 2]);
  assert.equal(r.standing?.state, "trial");
  assert.match(r.standing!.why, /held 0\.5, failed 0, quiet 0 \(3 replays at 0\.5 each\)/);

  // Asked again: nothing left to replay. Not again on a tree change either.
  assert.deepEqual((await invoke("replay.trial", { node: id })).output.replayed, []);
  await invoke("words.add", { title: "other", at: ["tool:Edit"], words: "Read before you edit." });
  await settle();
  assert.equal((await verdicts().verdicts(node, { limit: 50 })).items.length, 3);

  // A live run: its record is the live one, the replays stay apart.
  await play("r6", bash(6, "Server answered 429 empty body; backed off, retried, fine.", true));
  await settle(100);
  assert.deepEqual([(await verdicts().record(node))?.runs, (await verdicts().record(node))?.held], [1, 1]);
  const after = ((await invoke("keep.review", { node: id })).output as Review).nodes[0]!;
  assert.match(after.standing!.why, /held 1\.5/);

  // A replay of a run it was said in live (made for another node, say) tells nothing new: keep leaves it out.
  await loader.fiber("probe")!.ctx.get<ScriptedPlay>("scripted.play").replay("r6");
  await settle(100);
  assert.equal((await verdicts().replayed(node))?.runs, 4, "the verdict pack keeps every replay");
  const again = ((await invoke("keep.review", { node: id })).output as Review).nodes[0]!;
  assert.equal(again.replayed?.runs, 3);
  assert.deepEqual(errors, []);
});

test("per caps the replays; auto: false waits to be asked; the action replays more", async () => {
  const { errors, invoke, play, trial, settle, verdicts } = await setup({ auto: false, per: 1 });
  for (let m = 1; m <= 3; m++) await play(`r${m}`, bash(m, MISS, false));
  const id = await trial("r3");
  await settle();
  const node = ((await invoke("keep.review", { node: id })).output as Review).nodes[0]!.node!;
  assert.equal((await verdicts().verdicts(node, { limit: 50 })).items.length, 0, "auto off: nothing yet");
  const out = await invoke("replay.trial", { node: id });
  assert.deepEqual(out.output.replayed.map((x: { of: string }) => x.of), ["r2"]);
  assert.deepEqual((await invoke("replay.trial", { node: id })).output.replayed, [], "per reached");
  assert.deepEqual((await invoke("replay.trial", { node: id, runs: 1 })).output.replayed.map((x: { of: string }) => x.of), ["r1"], "runs asks for more");
  assert.equal((await invoke("replay.trial", { node: "i_none" })).refused.code, "replay.not_loaded");
  assert.deepEqual(errors, []);
});

test("grow asks nothing in a replay: its misses were asked about in the recorded run", async () => {
  const { errors, play, trial, settle, read } = await setup({}, ["grow"]);
  const first = await play("r1", bash(1, MISS, false));
  assert.equal(first.refused.filter((x) => x.code === "ask").length, 1, "the live run is asked");
  await play("r2", bash(2, MISS, false));
  await trial("r2");
  await settle();
  const replays = (await read().runs({ limit: 50 })).items.filter((r) => r.facts?.replay_of);
  assert.equal(replays.length, 1);
  const events = (await read().events(replays[0]!.run, { limit: 200 })).items;
  assert.equal(events.filter((e) => e.kind === "refuse" && e.node === "grow/ask").length, 0);
  assert.deepEqual(errors, []);
});

test("the pack unloads cleanly, a pass pending", async () => {
  const { loader, rt, errors, play, trial } = await setup();
  await play("r1", bash(1, MISS, false));
  await trial("r9");
  await loader.apply(["graph", "action", "exchange", "agent", "verdict", "words", "scripted", "probe"].map((id) => ({ id, pack: id })));
  await rt.settle();
  await new Promise((r) => setTimeout(r, 700));
  await loader.apply([]);
  await rt.settle();
  assert.deepEqual(errors, []);
});
