import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentNode, AgentTree } from "../spec/agent.ts";
import type { ExchangeEvent } from "../spec/exchange.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import claudeCode from "../packs/claude-code/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import grow, { ASKER, askText } from "../packs/grow/index.ts";
import { askedIn, covered, covers as growCovers, missesOf } from "../packs/grow/miss.ts";
import { covers as verdictCovers } from "../packs/verdict/judge.ts";
import verdict, { type VerdictRead } from "../packs/verdict/index.ts";
import words, { TRIAL_MARK } from "../packs/words/index.ts";
import mcp from "../packs/mcp/index.ts";
import types from "../packs/types/index.ts";

const T = "2026-11-20T15:00:00.000Z";
const ev = (seq: number, e: Partial<ExchangeEvent>): ExchangeEvent => ({ id: `e${seq}`, run: "r", seq, time: T, direction: "from_agent", kind: "act", ...e });

test("misses: failed acts and refusals, at their place and files; an asking refusal and the reply it holds are none", () => {
  const events = [
    ev(1, { kind: "begin", detail: { cwd: "C:\\repo" } }),
    ev(2, { place: "tool:Edit", act: { kind: "tool", by: "agent", input: { file_path: "C:\\repo\\a\\b.ts" }, output: "String not found", ok: false } }),
    ev(3, { place: "tool:Read", act: { kind: "tool", by: "agent", input: { file_path: "C:\\repo\\c.ts" }, ok: true } }),
    ev(4, { kind: "refuse", direction: "to_agent", place: "file:.env", node: "w/env", text: "Not .env." }),
    ev(5, { kind: "refuse", direction: "to_agent", place: "reply_end", node: ASKER, text: "Before you finish: a miss (#2).", detail: { code: "ask" } }),
    ev(6, { place: "reply_end", act: { kind: "reply", by: "agent", input: "done", output: { refused: ASKER, text: "…", code: "ask" }, ok: false } }),
  ];
  const misses = missesOf(events, "C:\\repo");
  assert.deepEqual(misses.map((m) => [m.seq, m.places, m.words]), [
    [2, ["tool:Edit", "file:a/b.ts"], "String not found"],
    [4, ["file:.env"], "Not .env."],
  ]);
  assert.equal(covered(misses[0]!, [{ id: "w/x", at: ["file:a/*.ts"] }]), true);
  assert.equal(covered(misses[0]!, [{ id: "w/x", at: ["file:a/c.ts"] }, { id: ASKER, at: ["tool:*"] }], ASKER), false);
  assert.deepEqual([...askedIn(events, ASKER)], [2]);
  assert.match(askText(misses), /^Before you finish: 2 misses .*\(#2, #4\)/);
});

/** The real packs, through the loader, with the adapter over HTTP: a miss to an ask to a node to its saying. */
test("a miss nothing covers is asked about once; the agent writes a trial node through act; the next run hears it at its place", async () => {
  const dir = await mkdtemp(join(tmpdir(), "grow-"));
  const nodes: Pack = {
    id: "nodes",
    inject: ["agent.node"],
    apply(ctx) {
      const n = ctx.get<AgentNode>("agent.node");
      n.node({ name: "bash", kind: "reflex", title: "bash", at: ["tool:Bash"], speak: () => ({ say: "Prefer Read." }) });
      n.node({ name: "check", kind: "reflex", title: "check", at: ["reply_end"], speak: () => ({ say: "Did you check?" }) });
    },
  };
  const probe: Pack = { id: "probe", inject: ["action.invoke", "agent.tree", "graph.read", "verdict.read"], apply() {} };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  let port = 0;
  const modules: Record<string, Pack> = {
    "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "verdict.ts": verdict,
    "words.ts": words, "grow.ts": grow, "nodes.ts": nodes, "cc.ts": claudeCode, "probe.ts": probe, "types.ts": types, "mcp.ts": mcp,
  };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    { id: "verdict", pack: "verdict.ts" },
    { id: "words", pack: "words.ts" },
    { id: "nodes", pack: "nodes.ts" },
    { id: "grow", pack: "grow.ts" },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "types", pack: "types.ts" },
    { id: "mcp", pack: "mcp.ts" },
    { id: "probe", pack: "probe.ts" },
  ]);
  try {
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return r.status === 202 ? undefined : ((await r.json()) as any);
    };
    const hook = (session: string, event: string, more: object = {}) => post("/hook", { hook_event_name: event, session_id: session, cwd: dir, ...more });
    const file = join(dir, "packs", "x.ts");

    // Run 1: an Edit fails where nothing listens; a Bash call fails where only a broad node listens,
    // which covers nothing: its words don't say it is that miss.
    await hook("s1", "SessionStart", { source: "startup" });
    await hook("s1", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: file, old_string: "a" }, tool_use_id: "t1" });
    await hook("s1", "PostToolUseFailure", { tool_name: "Edit", tool_input: { file_path: file, old_string: "a" }, error: "String to replace not found in file.", tool_use_id: "t1" });
    await hook("s1", "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "npm run lint" }, error: 'npm ERR! Missing script: "lint"', tool_use_id: "t2" });
    const ask = await hook("s1", "Stop", { last_assistant_message: "Done." });
    assert.equal(ask.decision, "block", "the ask keeps the agent going");
    const [seq, bashSeq] = [...ask.reason.split("\n").find((l: string) => l.startsWith("Before you finish"))!.matchAll(/#(\d+)/g)].map((m: RegExpMatchArray) => Number(m[1]));
    assert.match(ask.reason, /at tool:Edit, file:packs\/x\.ts: String to replace not found/);
    assert.match(ask.reason, new RegExp(`#${bashSeq} at tool:Bash: npm ERR! Missing script`), "a broad node at tool:Bash doesn't cover every Bash failure");

    // Asked once: the next stop goes through.
    assert.deepEqual(await hook("s1", "Stop", { last_assistant_message: "Done, again." }), {});

    // The agent writes the node through the MCP tool act.
    const call = async (id: string, args: object) => {
      await hook("s1", "PreToolUse", { tool_name: "mcp__archipelago__act", tool_input: args, tool_use_id: id });
      return (await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "act", arguments: args, _meta: { "claudecode/toolUseId": id } } })).result;
    };
    const tools = (await post("/mcp", { jsonrpc: "2.0", id: 9, method: "tools/list" })).result.tools;
    assert.match(tools.find((t: any) => t.name === "act").description, /grow\.trial/);
    const wild = await call("t3", { action: "grow.trial", reason: "r", input: { seq, place: "file:packs/*.ts", misses: "m", words: "w" } });
    assert.equal(wild.isError, true, "only an exact place");
    const elsewhere = await call("t4", { action: "grow.trial", reason: "r", input: { seq, place: "tool:Bash", misses: "m", words: "w" } });
    assert.match(elsewhere.content[0].text, /happened at tool:Edit, file:packs\/x\.ts/);
    const wrote = await call("t5", {
      action: "grow.trial",
      reason: "the Edit missed",
      input: { seq, place: "file:packs/x.ts", misses: "String to replace not found in file.", words: "Read packs/x.ts again before you edit it: it changes under you." },
    });
    assert.ok(!wrote.isError, wrote.content[0].text);
    const node = JSON.parse(wrote.content[0].text).output.node as string;
    const bashTrial = await call("t6", {
      action: "grow.trial",
      reason: "the lint script is missing",
      input: { seq: bashSeq, place: "tool:Bash", misses: "npm missing script lint", words: "There is no lint script: run npm run check." },
    });
    assert.ok(!bashTrial.isError, bashTrial.content[0].text);

    const p = loader.fiber("probe")!.ctx;
    const [item] = await p.get<GraphRead>("graph.read").get([node]);
    assert.deepEqual([item!.fields.status, item!.fields.at, item!.fields.misses, item!.fields.from_run, item!.fields.from_seq], ["trial", ["file:packs/x.ts"], "String to replace not found in file.", "s1", seq]);
    assert.ok(p.get<AgentTree>("agent.tree").nodes().some((n) => n.source === node && n.at.length === 1));

    // The ask isn't a miss: the reply_end node isn't failed by it.
    const v = await p.get<VerdictRead>("verdict.read").run("s1");
    assert.notEqual(v.find((x) => x.node === "nodes/check")?.verdict, "failed");

    // Run 2: the trial node is said at its exact place, marked, and nowhere else.
    await hook("s2", "SessionStart", { source: "startup" });
    const at = await hook("s2", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: file }, tool_use_id: "u1" });
    assert.equal(at.hookSpecificOutput.additionalContext, `[Read x.ts again before you edit it] ${TRIAL_MARK} Read packs/x.ts again before you edit it: it changes under you.`);
    const near = await hook("s2", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: join(dir, "packs", "y.ts") }, tool_use_id: "u2" });
    assert.deepEqual(near, {});

    // A Bash miss the trial node's misses name is covered; another Bash miss is still asked about.
    const heard = await hook("s2", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm run lint" }, tool_use_id: "u4" });
    assert.match(heard.hookSpecificOutput.additionalContext, /There is no lint script/);
    await hook("s2", "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "npm run lint" }, error: 'npm ERR! Missing script: "lint"', tool_use_id: "u4" });
    await hook("s2", "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "git push" }, error: "rejected: non-fast-forward", tool_use_id: "u5" });
    const ask2 = await hook("s2", "Stop", { last_assistant_message: "Done." });
    const asked2 = ask2.reason.split("\n").filter((l: string) => l.startsWith("- #"));
    assert.equal(asked2.length, 1, ask2.reason);
    assert.match(asked2[0], /non-fast-forward/);
    const verdicts2 = await p.get<VerdictRead>("verdict.read").run("s2");
    const bashNode = p.get<AgentTree>("agent.tree").nodes().find((n) => n.at[0] === "tool:Bash" && n.pack === "words")!;
    assert.deepEqual(verdicts2.find((x) => x.node === bashNode.id)?.failed_by.length, 1, "the trial node is failed by the miss it names, not by every Bash failure");

    // Retired by a person, it is no longer said.
    const out = await p.get<ActionInvoke>("action.invoke").invoke({ action: "words.retire", input: { node }, authority: { of: "human", basis: "test" }, reason: "retire" });
    assert.ok(out.ok);
    assert.deepEqual(await hook("s2", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: file }, tool_use_id: "u3" }), {});
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});

test("grow and verdict decide coverage the same way", () => {
  const cases: [string[], string | undefined, string[], string][] = [
    [["tool:Bash"], undefined, ["tool:Bash"], "exit 1"],
    [["tool:Bash"], "npm missing script lint", ["tool:Bash"], 'npm ERR! Missing script: "lint"'],
    [["tool:Bash"], "git push rejected", ["tool:Bash"], 'npm ERR! Missing script: "lint"'],
    [["tool:*"], "port already in use", ["tool:Bash"], "EADDRINUSE: address already in use :5181"],
    [["file:packs/**"], undefined, ["tool:Edit", "file:packs/a.ts"], "String to replace not found in file."],
    [["file:**"], undefined, ["tool:Edit", "file:packs/a.ts"], "String to replace not found in file."],
    [["tool:Edit"], undefined, ["tool:Edit", "file:packs/a.ts"], "String to replace not found in file."],
    [["tool:Edit"], "string to replace not found", ["tool:Edit", "file:packs/a.ts"], "String to replace not found in file."],
    [["reply_end"], "stopped before checking", ["reply_end"], "Run npm run check before you stop."],
    [["file:.env"], undefined, ["file:.env"], "Not .env."],
    // Said where a skill or memory file loads: its misses alone decide, wherever the miss stands.
    [["memory:project/~/p/CLAUDE.md"], "npm test failing", ["tool:Bash"], "npm test: 2 failing"],
    [["skill:review"], undefined, ["tool:Bash"], "npm test: 2 failing"],
  ];
  const got = cases.map(([at, misses, places, words]) => {
    const node = { at, ...(misses ? { misses } : {}) };
    const g = growCovers(node, places, words);
    assert.equal(g, verdictCovers(node, places, words), JSON.stringify([at, misses, places, words]));
    return g;
  });
  assert.deepEqual(got, [false, true, false, true, true, false, false, true, false, true, true, false]);
});

test("a refusal's node, said at the tool's result, covers that refusal at the tool, and no other", () => {
  const node = { at: ["tool_result:mcp__archipelago__*"], when: "Refused (action.input)" };
  const cases: [string[], string, boolean][] = [
    [["tool:mcp__archipelago__act"], "Refused (action.input): items.set needs fields.", true],
    [["tool:mcp__archipelago__act"], "Refused (schema.quarantined): status built is not one of todo.", false],
    [["tool:Bash"], "Refused (action.input): echoed", false],
  ];
  for (const [places, words, want] of cases) {
    assert.equal(growCovers(node, places, words), want, words);
    assert.equal(verdictCovers(node, places, words), want, words);
  }
});
