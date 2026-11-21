import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Act, AgentNode, AgentRun, Answer, Moment, RunStart } from "../spec/agent.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import graph from "../packs/graph/index.ts";
import exchange from "../packs/exchange/index.ts";
import claudeCode from "../packs/claude-code/index.ts";
import { handle, lastAssistantText, relativePath, toolPlaces, unseenFailures, type HookInput, type RunPort } from "../packs/claude-code/mapping.ts";
import { rpc } from "../packs/claude-code/mcp.ts";
import { withRemote } from "../packs/claude-code/hook.ts";
import mcpPack from "../packs/mcp/index.ts";
import types from "../packs/types/index.ts";
import type { ToolDef } from "../packs/mcp/host.ts";

const T = "2026-11-20T15:00:00.000Z";
const actor = { id: "claude-code", kind: "agent" as const };

/** A stand-in agent.run: records the calls and answers what it is told to. */
function fake(answers: (m: Moment) => Answer = () => ({ said: [] })) {
  const calls: [string, unknown][] = [];
  const run: AgentRun = {
    async begin(s: RunStart) {
      calls.push(["begin", s]);
      return { ...s, started: T };
    },
    async reach(m: Moment) {
      calls.push(["reach", m]);
      return answers(m);
    },
    async act(a: Act) {
      calls.push(["act", a]);
    },
    async end(run: string) {
      calls.push(["end", run]);
    },
  };
  const port: RunPort = { agent: run, begun: false };
  const go = (input: Partial<HookInput> & { hook_event_name: string }) =>
    handle({ session_id: "s1", cwd: "C:\\work\\repo", ...input }, port, { actor, now: () => T });
  return { calls, port, go };
}

test("paths become places relative to the run's folder, with /", () => {
  assert.equal(relativePath("C:\\work\\repo\\spec\\agent.ts", "C:\\work\\repo"), "spec/agent.ts");
  assert.equal(relativePath("c:/work/repo/a.ts", "C:\\work\\repo\\"), "a.ts");
  assert.equal(relativePath("/home/x/b.ts", "/home/y"), "/home/x/b.ts");
  assert.deepEqual(toolPlaces("Edit", { file_path: "C:\\work\\repo\\packs\\a.ts", old_string: "x" }, "C:\\work\\repo"), ["tool:Edit", "file:packs/a.ts"]);
  assert.deepEqual(toolPlaces("NotebookEdit", { notebook_path: "/r/n.ipynb" }, "/r"), ["tool:NotebookEdit", "file:n.ipynb"]);
  assert.deepEqual(toolPlaces("Bash", { command: "ls" }), ["tool:Bash"]);
});

test("SessionStart begins the run once and says what the nodes say", async () => {
  const { calls, go } = fake((m) => (m.places[0] === "session_start" ? { said: [{ node: "n/a", text: "A." }, { node: "n/b", text: "B." }] } : { said: [] }));
  const out = await go({ hook_event_name: "SessionStart", source: "startup" });
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "A.\n\nB." } });
  await go({ hook_event_name: "SessionStart", source: "compact" });
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["begin", "reach", "reach"],
  );
  const begin = calls[0]![1] as RunStart;
  assert.equal(begin.run, "s1");
  assert.equal(begin.harness, "claude-code");
  assert.deepEqual((calls[2]![1] as Moment).input, { source: "compact" });
});

test("a hook before SessionStart still begins the run", async () => {
  const { calls, go } = fake();
  assert.deepEqual(await go({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }), {});
  assert.deepEqual(calls.map((c) => c[0]), ["begin", "reach"]);
});

test("a prompt is reached, then recorded as the person's act; a refusal blocks it", async () => {
  const { calls, go } = fake((m) => (m.input === "rm everything" ? { said: [], refused: { node: "n/no", text: "No." } } : { said: [{ node: "n/s", text: "Noted." }] }));
  const ok = await go({ hook_event_name: "UserPromptSubmit", prompt: "hello" });
  assert.deepEqual(ok, { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "Noted." } });
  const blocked = await go({ hook_event_name: "UserPromptSubmit", prompt: "rm everything" });
  assert.deepEqual(blocked, { decision: "block", reason: "No." });
  const acts = calls.filter((c) => c[0] === "act").map((c) => c[1] as Act);
  assert.deepEqual(acts.map((a) => [a.place, a.kind, a.by, a.input, a.ok]), [
    ["prompt", "prompt", "person", "hello", true],
    ["prompt", "prompt", "person", "rm everything", false],
  ]);
  assert.deepEqual((calls[1]![1] as Moment).places, ["prompt"]);
});

test("PreToolUse reaches tool: and file:, and a refusal denies the call and is its act", async () => {
  const { calls, go } = fake((m) =>
    m.places.includes("file:.env") ? { said: [{ node: "n/s", text: "Also this." }], refused: { node: "n/env", text: "Not .env." } } : { said: [{ node: "n/f", text: "Careful." }] },
  );
  const said = await go({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "C:\\work\\repo\\README.md" } });
  assert.deepEqual(said, { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "Careful." } });
  const denied = await go({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "C:\\work\\repo\\.env" } });
  assert.deepEqual(denied, {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Not .env.\n\nAlso this." },
  });
  const reaches = calls.filter((c) => c[0] === "reach").map((c) => (c[1] as Moment).places);
  assert.deepEqual(reaches, [
    ["tool:Read", "file:README.md"],
    ["tool:Edit", "file:.env"],
  ]);
  const acts = calls.filter((c) => c[0] === "act").map((c) => c[1] as Act);
  assert.equal(acts.length, 1, "only the refused call is an act at PreToolUse");
  assert.deepEqual([acts[0]!.place, acts[0]!.kind, acts[0]!.ok], ["tool:Edit", "tool", false]);
});

test("PostToolUse is the act, then tool_result: is reached with the result", async () => {
  const { calls, go } = fake((m) => (m.places[0] === "tool_result:Bash" ? { said: [{ node: "n/r", text: "Seen." }] } : { said: [] }));
  const out = await go({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: { stdout: "a\nb", stderr: "" } });
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "Seen." } });
  const [, act, reach] = calls;
  assert.equal(act![0], "act");
  assert.deepEqual(act![1], { run: "s1", time: T, place: "tool:Bash", kind: "tool", by: "agent", input: { command: "ls" }, output: { stdout: "a\nb", stderr: "" }, ok: true });
  assert.deepEqual(reach![1], { run: "s1", places: ["tool_result:Bash"], time: T, input: { stdout: "a\nb", stderr: "" } });
  await go({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" }, error: "exit 1" });
  const failed = calls.filter((c) => c[0] === "act").map((c) => c[1] as Act)[1]!;
  assert.deepEqual([failed.ok, failed.output], [false, "exit 1"]);
});

test("long results are cut before they are recorded", async () => {
  const { calls, go } = fake();
  await go({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "x" }, tool_response: { file: { content: "x".repeat(10000) } } });
  const act = calls.find((c) => c[0] === "act")![1] as Act;
  const content = ((act.output as any).file.content as string);
  assert.ok(content.length < 4100 && content.endsWith("(6000 more)"));
});

test("Stop reaches reply_end with the reply; a refusal keeps the agent going", async () => {
  const { calls, go } = fake((m) => (m.input === "done?" ? { said: [], refused: { node: "n/more", text: "Not yet: run the tests." } } : { said: [] }));
  assert.deepEqual(await go({ hook_event_name: "Stop", last_assistant_message: "All done." }), {});
  assert.deepEqual(await go({ hook_event_name: "Stop", last_assistant_message: "done?" }), { decision: "block", reason: "Not yet: run the tests." });
  const acts = calls.filter((c) => c[0] === "act").map((c) => c[1] as Act);
  assert.deepEqual(acts.map((a) => [a.place, a.kind, a.input, a.output, a.ok]), [
    ["reply_end", "reply", undefined, "All done.", true],
    ["reply_end", "reply", "done?", { refused: "n/more", text: "Not yet: run the tests." }, false],
  ]);
});

test("SessionEnd ends the run; the next hook begins it again", async () => {
  const { calls, go } = fake();
  await go({ hook_event_name: "SessionStart" });
  await go({ hook_event_name: "SessionEnd", reason: "exit" });
  await go({ hook_event_name: "SessionEnd", reason: "exit" });
  assert.deepEqual(calls.map((c) => c[0]), ["begin", "reach", "end"]);
});

test("a subagent is a run of its own, whose parent is the session's run", async () => {
  const { calls, port, go } = fake((m) =>
    m.places[0] === "session_start" ? { said: [{ node: "n/start", text: "Hello, helper." }] } : m.input === "half done" ? { said: [], refused: { node: "n/more", text: "Finish it." } } : { said: [] },
  );
  // Each run has its own port in the adapter; here one port stands for the subagent's.
  const sub = { agent_id: "agent-7", agent_type: "Explore" };
  assert.deepEqual(await go({ hook_event_name: "SubagentStart", ...sub }), {
    hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: "Hello, helper." },
  });
  await go({ hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { pattern: "x" }, ...sub });
  assert.deepEqual(await go({ hook_event_name: "SubagentStop", last_assistant_message: "half done", ...sub }), { decision: "block", reason: "Finish it." });
  assert.equal(port.begun, true);
  assert.deepEqual(await go({ hook_event_name: "SubagentStop", last_assistant_message: "Found it.", ...sub }), {});
  assert.equal(port.begun, false);
  const begin = calls[0]![1] as RunStart;
  assert.deepEqual([begin.run, begin.parent, begin.title], ["s1:agent-7", "s1", "Explore subagent"]);
  assert.ok(calls.slice(1).every((c) => c[0] === "end" ? c[1] === "s1:agent-7" : (c[1] as Moment | Act).run === "s1:agent-7"));
  assert.deepEqual((calls[1]![1] as Moment).input, { source: "subagent", agent_type: "Explore" });
  assert.deepEqual(calls.map((c) => c[0]), ["begin", "reach", "reach", "reach", "act", "reach", "act", "end"]);
});

test("PreCompact reaches compact with what started it", async () => {
  const { calls, go } = fake();
  assert.deepEqual(await go({ hook_event_name: "PreCompact", trigger: "manual" }), {});
  const m = calls[1]![1] as Moment;
  assert.deepEqual([m.places, m.input], [["compact"], { trigger: "manual" }]);
});

test("a notice: the harness asked the person, and the run waits on them", async () => {
  const { calls, go } = fake();
  await go({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" });
  const a = calls[1]![1] as Act;
  assert.deepEqual([a.place, a.kind, a.by, a.input, a.ok], ["prompt", "notice", "agent", { type: "idle_prompt", message: "Claude is waiting for your input" }, true]);
});

test("a person allowing a call they were asked about is their decision, before the call's act", async () => {
  const { calls, go } = fake();
  const call = { tool_name: "Bash", tool_input: { command: "rm -rf build" } };
  assert.deepEqual(await go({ hook_event_name: "PermissionRequest", ...call }), {});
  await go({ hook_event_name: "PostToolUse", tool_use_id: "t1", tool_response: { stdout: "" }, ...call });
  // The same call again, not asked about: no decision.
  await go({ hook_event_name: "PostToolUse", tool_use_id: "t2", tool_response: { stdout: "" }, ...call });
  const acts = calls.filter((c) => c[0] === "act").map((c) => c[1] as Act);
  assert.deepEqual(acts.map((a) => [a.place, a.kind, a.by, a.output, a.ok]), [
    ["tool:Bash", "decision", "person", "allow", true],
    ["tool:Bash", "tool", "agent", { stdout: "" }, true],
    ["tool:Bash", "tool", "agent", { stdout: "" }, true],
  ]);
});

test("a person denying a call shows in the transcript, read at the next prompt: a decision that didn't work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ask-"));
  try {
    const path = join(dir, "t.jsonl");
    const call = { tool_name: "Edit", tool_input: { file_path: "a.ts", old_string: "x", new_string: "y" } };
    const lines = [
      { type: "user", timestamp: "2026-11-20T14:59:00.000Z", message: { content: "fix it" } },
      { type: "assistant", timestamp: "2026-11-20T14:59:01.000Z", message: { content: [{ type: "tool_use", id: "t1", name: "Edit", input: call.tool_input }] } },
      { type: "user", timestamp: "2026-11-20T15:00:01.000Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected." }] } },
    ];
    await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const calls: [string, unknown][] = [];
    const agentRun: AgentRun = {
      async begin(s) {
        return { ...s, started: T };
      },
      async reach(m) {
        calls.push(["reach", m]);
        return { said: [] };
      },
      async act(a) {
        calls.push(["act", a]);
      },
      async end() {},
    };
    const port: RunPort = { agent: agentRun, begun: false, seen: new Set() };
    const { readFile } = await import("node:fs/promises");
    const opts = { actor, now: () => T, transcript: async () => readFile(path, "utf8") };
    const go = (i: Partial<HookInput> & { hook_event_name: string }) => handle({ session_id: "s1", transcript_path: path, ...i }, port, opts);
    await go({ hook_event_name: "PermissionRequest", ...call });
    await go({ hook_event_name: "UserPromptSubmit", prompt: "no, do it differently" });
    await go({ hook_event_name: "UserPromptSubmit", prompt: "again" });
    const decisions = calls.filter((c) => c[0] === "act" && (c[1] as Act).kind === "decision").map((c) => c[1] as Act);
    assert.deepEqual(decisions.map((a) => [a.place, a.by, a.output, a.ok]), [["tool:Edit", "person", "deny", false]]);
    assert.deepEqual(port.asks?.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("what a subagent loaded is read from its own transcript when it stops, in its run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-"));
  try {
    const own = join(dir, "agent.jsonl");
    const line = { type: "attachment", attachment: { type: "instructions", files: [{ path: "/r/CLAUDE.md", type: "Project", content: "# Rules" }] } };
    await writeFile(own, JSON.stringify(line) + "\n");
    const { readFile } = await import("node:fs/promises");
    const reached: Moment[] = [];
    const agentRun: AgentRun = {
      async begin(s) {
        return { ...s, started: T };
      },
      async reach(m) {
        reached.push(m);
        return { said: [] };
      },
      async act() {},
      async end() {},
    };
    const port: RunPort = { agent: agentRun, begun: true, seen: new Set() };
    const transcriptFrom = async (i: HookInput, offset: number) => {
      const text = (await readFile(i.transcript_path!, "utf8")).slice(offset);
      return { text, end: offset + text.length };
    };
    await handle(
      { hook_event_name: "SubagentStop", session_id: "s1", agent_id: "a1", agent_type: "Explore", transcript_path: join(dir, "main.jsonl"), agent_transcript_path: own, last_assistant_message: "Done." },
      port,
      { actor, now: () => T, transcriptFrom },
    );
    assert.deepEqual(reached.map((m) => [m.run, m.places[0]]), [
      ["s1:a1", "memory:project//r/CLAUDE.md"],
      ["s1:a1", "reply_end"],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a SubagentStop for a subagent that never started is not a run", async () => {
  const { calls, go } = fake();
  assert.deepEqual(await go({ hook_event_name: "SubagentStop", agent_id: "agent-x", agent_type: "", last_assistant_message: "suggestion" }), {});
  assert.deepEqual(calls, []);
});

test("the reply is read from the transcript when the hook doesn't carry it", () => {
  const transcript = [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "First." }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Last." }, { type: "text", text: "Really." }] } }),
    "",
  ].join("\n");
  assert.equal(lastAssistantText(transcript), "Last.\nReally.");
  assert.equal(lastAssistantText(""), undefined);
});

test("the MCP server lists the tools packs added and hands each call its run", async () => {
  const { port } = fake();
  const seen: unknown[] = [];
  const echo: ToolDef = {
    name: "echo",
    description: () => "Says it back.",
    inputSchema: { type: "object" },
    async call(args, run) {
      seen.push(run?.run);
      if (args.boom) throw new Error("boom");
      return { text: String(args.say), isError: args.say === "no" };
    },
  };
  const ports = { tools: () => [echo], runFor: (id?: string) => (id === "t1" ? { run: "s1", actor, agent: port.agent, invoke: {} as any } : undefined) };
  const init = (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, ports)) as any;
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, ports), undefined);
  const list = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ports)) as any;
  assert.deepEqual(list.result.tools, [{ name: "echo", description: "Says it back.", inputSchema: { type: "object" } }]);
  const call = (args: object, toolUseId?: string) =>
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: args, ...(toolUseId ? { _meta: { "claudecode/toolUseId": toolUseId } } : {}) } }, ports) as Promise<any>;
  assert.deepEqual((await call({ say: "hi" }, "t1")).result, { content: [{ type: "text", text: "hi" }] });
  assert.deepEqual((await call({ say: "no" })).result, { content: [{ type: "text", text: "no" }], isError: true });
  assert.deepEqual((await call({ boom: true })).result, { content: [{ type: "text", text: "echo failed: boom" }], isError: true });
  assert.deepEqual(seen, ["s1", undefined, undefined]);
  const none = (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }, ports)) as any;
  assert.equal(none.error.code, -32602);
});

/** The real packs, through the loader, over HTTP. */
test("hooks and MCP over HTTP reach the agent pack and land on the exchange, both ways", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-"));
  const transcript = join(dir, "t.jsonl");
  await writeFile(transcript, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Finished." }] } }) + "\n");
  const nodes: Pack = {
    id: "nodes",
    inject: ["agent.node"],
    apply(ctx) {
      const n = ctx.get<AgentNode>("agent.node");
      n.node({ name: "hello", kind: "instruction", title: "hello", at: ["session_start"], speak: () => ({ say: "Hello from the map." }) });
      n.node({ name: "env", kind: "rule", title: "env", at: ["file:.env"], speak: () => ({ refuse: "Not .env." }) });
      n.node({ name: "spec", kind: "reflex", title: "spec", at: ["file:spec/*"], speak: () => ({ say: "The spec is versioned." }) });
    },
  };
  const probe: Pack = { id: "probe", inject: ["exchange.read"], apply() {} };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  let port = 0;
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "agent.ts": agent, "exchange.ts": exchange, "nodes.ts": nodes, "cc.ts": claudeCode, "probe.ts": probe, "types.ts": types, "mcp.ts": mcpPack };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    { id: "nodes", pack: "nodes.ts" },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "types", pack: "types.ts" },
    { id: "mcp", pack: "mcp.ts" },
    { id: "probe", pack: "probe.ts" },
  ]);
  try {
    assert.ok(port > 0, "the adapter listens");
    assert.equal(loader.fiber("mcp")?.state, "active", "the mcp pack serves its tools on the adapter");
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, json: r.status === 202 ? undefined : await r.json() };
    };
    const hook = (event: string, more: object = {}) =>
      post("/hook", { hook_event_name: event, session_id: "sess-1", cwd: dir, transcript_path: transcript, ...more }).then((r) => r.json);

    assert.deepEqual(await hook("SessionStart", { source: "startup" }), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "Hello from the map." } });
    await hook("UserPromptSubmit", { prompt: "edit the spec" });
    const pre = await hook("PreToolUse", { tool_name: "Edit", tool_input: { file_path: join(dir, "spec", "agent.ts") }, tool_use_id: "t1" });
    assert.equal(pre.hookSpecificOutput.additionalContext, "The spec is versioned.");
    await hook("PostToolUse", { tool_name: "Edit", tool_input: { file_path: join(dir, "spec", "agent.ts") }, tool_response: { ok: true }, tool_use_id: "t1" });
    const denied = await hook("PreToolUse", { tool_name: "Read", tool_input: { file_path: join(dir, ".env") }, tool_use_id: "t2" });
    assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");

    await hook("PreToolUse", { tool_name: "mcp__archipelago__hear", tool_input: { place: "file:spec/x.ts" }, tool_use_id: "t3" });
    const listed = await post("/mcp", { jsonrpc: "2.0", id: 9, method: "tools/list" });
    assert.deepEqual(listed.json.result.tools.map((t: any) => t.name), ["hear", "act", "get", "query", "tell", "run"]);
    const mcp = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hear", arguments: { place: "file:spec/x.ts" }, _meta: { "claudecode/toolUseId": "t3" } } });
    assert.deepEqual(mcp.json.result.content, [{ type: "text", text: "The spec is versioned." }]);
    assert.equal((await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);

    await hook("Stop", { stop_hook_active: false });
    await hook("SessionEnd", { reason: "exit" });
    assert.equal((await post("/hook", { nope: 1 })).status, 400);

    const read = loader.fiber("probe")!.ctx.get<ExchangeRead>("exchange.read");
    const events = (await read.events("sess-1")).items;
    assert.deepEqual(
      events.map((e) => [e.kind, e.direction, e.place ?? "-", e.node ?? e.act?.kind ?? "-"]),
      [
        ["begin", "from_agent", "-", "-"],
        ["say", "to_agent", "session_start", "nodes/hello"],
        ["act", "from_agent", "prompt", "prompt"],
        ["say", "to_agent", "file:spec/agent.ts", "nodes/spec"],
        ["act", "from_agent", "tool:Edit", "tool"],
        ["refuse", "to_agent", "file:.env", "nodes/env"],
        ["act", "from_agent", "tool:Read", "tool"],
        ["say", "to_agent", "file:spec/x.ts", "nodes/spec"],
        ["act", "from_agent", "reply_end", "reply"],
        ["end", "from_agent", "-", "-"],
      ],
    );
    const begin = (await read.runs()).items[0]!;
    assert.deepEqual([begin.run, begin.harness, begin.agent], ["sess-1", "claude-code", actor]);
    assert.equal(events.find((e) => e.act?.kind === "reply")!.act!.output, "Finished.");
    assert.deepEqual(errors, []);

    // Unloading the pack closes its server.
    await loader.apply([{ id: "graph", pack: "graph.ts" }, { id: "action", pack: "action.ts" }, { id: "exchange", pack: "exchange.ts" }, { id: "agent", pack: "agent.ts" }]);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});

test("the command forwarder prints the adapter's answer, and nothing when it is down", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const got = JSON.parse(b);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ echoed: got.hook_event_name, ...(got.git_remote ? { remote: got.git_remote } : {}) }));
    });
  });
  // A folder whose origin carries credentials: only host/owner/name may leave. Made before the server
  // listens, and only where git is (the image that tests a deploy has none): the forwarder's own logic
  // is tested without git below.
  const { execFileSync, spawn } = await import("node:child_process");
  let repo: string | undefined = await mkdtemp(join(tmpdir(), "hook-repo-"));
  try {
    execFileSync("git", ["init", "-q", repo], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://user:secret@GitHub.com/a/b.git"], { stdio: "ignore" });
  } catch {
    await rm(repo, { recursive: true, force: true });
    repo = undefined;
  }
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  const forward = async (url: string, cwd?: string) => {
    const child = spawn(process.execPath, ["packs/claude-code/hook.ts", url]);
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stdin.end(JSON.stringify({ hook_event_name: "SessionStart", session_id: "s", ...(cwd ? { cwd } : {}) }));
    const code = await new Promise((ok) => child.on("close", ok));
    return { code, out };
  };
  try {
    assert.deepEqual(await forward(`http://127.0.0.1:${port}/hook`), { code: 0, out: '{"echoed":"SessionStart"}' });
    if (repo) assert.deepEqual(await forward(`http://127.0.0.1:${port}/hook`, repo), { code: 0, out: '{"echoed":"SessionStart","remote":"github.com/a/b"}' });
  } finally {
    await new Promise((ok) => server.close(ok));
    if (repo) await rm(repo, { recursive: true, force: true });
  }
  assert.deepEqual(await forward(`http://127.0.0.1:${port}/hook`), { code: 0, out: "" });
});

test("the forwarder adds the folder's remote; a folder with no origin, or bad input, goes as it came", () => {
  const body = (o: object) => JSON.stringify(o);
  assert.equal(JSON.parse(withRemote(body({ cwd: "C:/r" }), () => "git@github.com:a/b.git\n")).git_remote, "github.com/a/b");
  assert.equal(withRemote(body({ cwd: "C:/r" }), () => { throw new Error("not a repo"); }), body({ cwd: "C:/r" }));
  assert.equal(withRemote(body({}), () => "https://github.com/a/b"), body({}));
  assert.equal(withRemote("not json", () => "https://github.com/a/b"), "not json");
});

test("the hook's remote is a fact of the run it begins", async () => {
  const { calls, go } = fake();
  await go({ hook_event_name: "SessionStart", git_remote: "github.com/a/b" });
  assert.deepEqual((calls[0]![1] as RunStart).facts, { remote: "github.com/a/b" });
  const sub = fake();
  await sub.go({ hook_event_name: "SubagentStart", agent_id: "x", agent_type: "Explore", git_remote: "github.com/a/b" });
  assert.deepEqual((sub.calls[0]![1] as RunStart).facts, { agent_type: "Explore", remote: "github.com/a/b" });
  const none = fake();
  await none.go({ hook_event_name: "SessionStart" });
  assert.equal((none.calls[0]![1] as RunStart).facts, undefined);
});

test("at Stop, the turn's failed tool calls no hook saw are read from the transcript and recorded as failed acts", async () => {
  const line = (o: object) => JSON.stringify(o);
  const transcript = [
    line({ type: "user", message: { content: "earlier prompt" } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "old", name: "Edit", input: { file_path: "a" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "old", is_error: true, content: "old error" }] } }),
    line({ type: "user", message: { content: "fix settings" } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "C:\work\repo\s.txt", old_string: "x" } }, { type: "tool_use", id: "e2", name: "Bash", input: { command: "false" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", is_error: true, content: "<tool_use_error>String to replace not found in file.</tool_use_error>" }, { type: "tool_result", tool_use_id: "e2", is_error: true, content: "exit 1" }] } }),
  ].join("\n");
  assert.deepEqual(unseenFailures(transcript, new Set(["e2"])), [
    { id: "e1", tool: "Edit", input: { file_path: "C:\work\repo\s.txt", old_string: "x" }, error: "String to replace not found in file." },
  ]);
  const { calls, port } = fake();
  port.seen = new Set(["e2"]);
  const go = (input: Partial<HookInput> & { hook_event_name: string }) =>
    handle({ session_id: "s1", cwd: "C:\work\repo", ...input }, port, { actor, now: () => T, transcript: async () => transcript });
  await go({ hook_event_name: "Stop", last_assistant_message: "Done." });
  await go({ hook_event_name: "Stop", last_assistant_message: "Done." });
  const acts = calls.filter((c) => c[0] === "act").map((c) => c[1] as Act);
  assert.deepEqual(acts.map((a) => [a.place, a.output, a.ok]), [
    ["tool:Edit", "String to replace not found in file.", false],
    ["reply_end", "Done.", true],
    ["reply_end", "Done.", true],
  ]);
});

test("a restart mid-turn records each call once: Stop reads back what is on the record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-restart-"));
  const journal = join(dir, "exchange.jsonl");
  const transcriptPath = join(dir, "t.jsonl");
  const begun = new Date(Date.now() - 1000).toISOString();
  const line = (o: object) => JSON.stringify(o);
  const use = (id: string, name: string, input: object) => line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
  const result = (id: string, content: string, is_error = true) => line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content }] } });
  await writeFile(
    transcriptPath,
    [
      line({ type: "user", timestamp: begun, message: { content: "build it" } }),
      use("t1", "Bash", { command: "false" }),
      result("t1", "exit 1"),
      use("t2", "Bash", { command: "false" }),
      result("t2", "exit 1"),
      use("t3", "Edit", { file_path: join(dir, "a.ts"), old_string: "x", new_string: "y" }),
      result("t3", "<tool_use_error>String to replace not found in file.</tool_use_error>"),
      line({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }),
    ].join("\n") + "\n",
  );
  const probe: Pack = { id: "probe", inject: ["exchange.read"], apply() {} };
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "agent.ts": agent, "exchange.ts": exchange, "cc.ts": claudeCode, "probe.ts": probe };
  let port = 0;
  const tree = [
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts", config: { journal } },
    { id: "agent", pack: "agent.ts" },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "probe", pack: "probe.ts" },
  ];
  const start = async () => {
    const rt = new Runtime();
    const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
    await loader.apply(tree);
    return loader;
  };
  const hook = (event: string, more: object = {}) =>
    fetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: event, session_id: "sess-r", cwd: dir, transcript_path: transcriptPath, ...more }),
    }).then((r) => r.json());
  let loader = await start();
  try {
    await hook("SessionStart", { source: "startup" });
    await hook("UserPromptSubmit", { prompt: "build it" });
    // The first failed Bash call is seen by its hooks; then the server restarts.
    await hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "false" }, tool_use_id: "t1" });
    await hook("PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "false" }, error: "exit 1", tool_use_id: "t1" });
    await loader.apply([]);
    loader = await start();
    // The same command fails again with no hook (the server was down), and an Edit is rejected before any hook.
    await hook("Stop", { stop_hook_active: false });
    await hook("Stop", { stop_hook_active: true });
    const read = loader.fiber("probe")!.ctx.get<ExchangeRead>("exchange.read");
    const acts = (await read.events("sess-r")).items.filter((e) => e.kind === "act" && e.act?.kind === "tool");
    assert.deepEqual(
      acts.map((e) => [e.place, e.act!.output, e.act!.ok]),
      [
        ["tool:Bash", "exit 1", false],
        ["tool:Bash", "exit 1", false],
        ["tool:Edit", "String to replace not found in file.", false],
      ],
      "t1 once from its hook, t2 and t3 once from the transcript, after a restart and two Stops",
    );
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});

/** A client without hooks (claude.ai, a desktop chat): its MCP session is a run of its own. */
test("an MCP client without hooks gets a session, and the session is its own recorded run", async () => {
  const nodes: Pack = {
    id: "nodes",
    inject: ["agent.node"],
    apply(ctx) {
      const n = ctx.get<AgentNode>("agent.node");
      n.node({ name: "hello", kind: "instruction", title: "hello", at: ["session_start"], speak: () => ({ say: "Hello from the map." }) });
      n.node({ name: "heard", kind: "reflex", title: "heard", at: ["tool_result:mcp__archipelago__hear"], speak: () => ({ say: "Heard it." }) });
    },
  };
  const probe: Pack = { id: "probe", inject: ["exchange.read"], apply() {} };
  const rt = new Runtime();
  let port = 0;
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "agent.ts": agent, "exchange.ts": exchange, "nodes.ts": nodes, "cc.ts": claudeCode, "probe.ts": probe, "types.ts": types, "mcp.ts": mcpPack };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    { id: "nodes", pack: "nodes.ts" },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "types", pack: "types.ts" },
    { id: "mcp", pack: "mcp.ts" },
    { id: "probe", pack: "probe.ts" },
  ]);
  try {
    const post = async (body: unknown, session?: string) => {
      const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body) });
      return { status: r.status, session: r.headers.get("mcp-session-id"), json: r.status === 202 ? undefined : await r.json() };
    };
    // Claude Code opens no session: its calls are found through its hooks.
    const cc = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } } });
    assert.equal(cc.session, null);

    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "Claude AI" } } });
    const session = init.session!;
    assert.ok(session, "a client without hooks gets a session");
    assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session)).status, 202);
    const call = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hear", arguments: { place: "file:x.ts" } } }, session);
    const text: string = call.json.result.content[0].text;
    assert.match(text, /Hello from the map\./, "what is said at session_start comes with the first result");
    assert.match(text, /Heard it\./, "what is said at the tool's result comes with it");

    assert.equal((await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, "not-a-session")).status, 404, "an unknown session starts again");
    const del = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "DELETE", headers: { "mcp-session-id": session } });
    assert.equal(del.status, 204);

    const read = loader.fiber("probe")!.ctx.get<ExchangeRead>("exchange.read");
    const runs = (await read.runs()).items;
    const own = runs.find((r) => r.run === `mcp-${session}`)!;
    assert.deepEqual([own.harness, own.agent], ["claude-ai", { id: "claude-ai", kind: "agent" }]);
    const events = (await read.events(own.run)).items;
    assert.deepEqual(
      events.map((e) => [e.kind, e.place ?? "-", e.node ?? e.act?.kind ?? "-"]),
      [
        ["begin", "-", "-"],
        ["say", "session_start", "nodes/hello"],
        ["act", "tool:mcp__archipelago__hear", "tool"],
        ["say", "tool_result:mcp__archipelago__hear", "nodes/heard"],
        ["end", "-", "-"],
      ],
    );
  } finally {
    await loader.apply([]);
  }
});
