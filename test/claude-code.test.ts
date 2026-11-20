import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Act, AgentNode, AgentRun, Answer, Moment, RunStart } from "../spec/agent.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import claudeCode from "../packs/claude-code/index.ts";
import { handle, lastAssistantText, relativePath, toolPlaces, type HookInput, type RunPort } from "../packs/claude-code/mapping.ts";
import { knownPlace, rpc } from "../packs/claude-code/mcp.ts";

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
  assert.deepEqual(acts.map((a) => [a.place, a.kind, a.output, a.ok]), [
    ["reply_end", "reply", "All done.", true],
    ["reply_end", "reply", "done?", false],
  ]);
});

test("SessionEnd ends the run; the next hook begins it again", async () => {
  const { calls, go } = fake();
  await go({ hook_event_name: "SessionStart" });
  await go({ hook_event_name: "SessionEnd", reason: "exit" });
  await go({ hook_event_name: "SessionEnd", reason: "exit" });
  assert.deepEqual(calls.map((c) => c[0]), ["begin", "reach", "end"]);
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

test("the MCP server's hear answers only what the nodes say at the place", async () => {
  const { port } = fake((m) => (m.places[0] === "file:.env" ? { said: [], refused: { node: "n/env", text: "Not .env." } } : { said: [{ node: "n/a", text: "About a.ts." }] }));
  const ports = { runFor: () => ({ run: "s1", agent: port.agent }), now: () => T };
  const init = (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, ports)) as any;
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, ports), undefined);
  const list = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ports)) as any;
  assert.deepEqual(list.result.tools.map((t: any) => t.name), ["hear"]);
  const heard = (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hear", arguments: { place: "file:a.ts" } } }, ports)) as any;
  assert.deepEqual(heard.result, { content: [{ type: "text", text: "About a.ts." }] });
  const refused = (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "hear", arguments: { place: "file:.env" } } }, ports)) as any;
  assert.deepEqual(refused.result, { content: [{ type: "text", text: "Not .env." }], isError: true });
  const bad = (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "hear", arguments: { place: "nowhere" } } }, ports)) as any;
  assert.equal(bad.result.isError, true);
  assert.ok(knownPlace("tool:Bash") && knownPlace("reply_end") && !knownPlace("tool:") && !knownPlace("file"));
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
  const modules: Record<string, Pack> = { "agent.ts": agent, "exchange.ts": exchange, "nodes.ts": nodes, "cc.ts": claudeCode, "probe.ts": probe };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    { id: "nodes", pack: "nodes.ts" },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "probe", pack: "probe.ts" },
  ]);
  try {
    assert.ok(port > 0, "the adapter listens");
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
    await loader.apply([{ id: "exchange", pack: "exchange.ts" }, { id: "agent", pack: "agent.ts" }]);
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
    req.on("end", () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ echoed: JSON.parse(b).hook_event_name })));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  const forward = async (url: string) => {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["packs/claude-code/hook.ts", url]);
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stdin.end(JSON.stringify({ hook_event_name: "SessionStart", session_id: "s" }));
    const code = await new Promise((ok) => child.on("close", ok));
    return { code, out };
  };
  try {
    assert.deepEqual(await forward(`http://127.0.0.1:${port}/hook`), { code: 0, out: '{"echoed":"SessionStart"}' });
  } finally {
    await new Promise((ok) => server.close(ok));
  }
  assert.deepEqual(await forward(`http://127.0.0.1:${port}/hook`), { code: 0, out: "" });
});
