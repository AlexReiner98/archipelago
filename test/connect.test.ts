import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke, ActionRegister } from "../spec/action.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import connect, { localCommand, MAKE_TOKEN, SETUP } from "../packs/connect/index.ts";
import { EVENTS, setup, TOKEN, withToken, type Setup } from "../packs/connect/setup.ts";
import { runName } from "../packs/connect/view.ts";

const BASE = "mem:/packs/";

/** A pack standing in for a host's token maker: `tokens.make`. */
const tokens: Pack = {
  id: "tokens",
  inject: ["action.register"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({ name: "tokens.make", title: "Make a token", input: { type: "object" }, run: async () => ({ token: "t0ken-secret" }) });
  },
};
const probe: Pack = { id: "probe", inject: ["action.invoke"], apply() {} };

async function setupTree(config: Record<string, unknown>) {
  const rt = new Runtime();
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "tokens.ts": tokens, "connect.ts": connect, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = [
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "tokens", pack: "tokens.ts" },
    { id: "connect", pack: "connect.ts", config },
    { id: "probe", pack: "probe.ts" },
  ];
  await loader.apply(tree);
  await rt.settle();
  const as = (kind: "person" | "agent") => loader.fiber("probe")!.ctx.intercept({ actor: { id: `${kind}:1`, kind } }).get<ActionInvoke>("action.invoke");
  return { person: as("person"), agent: as("agent") };
}

const call = (invoke: ActionInvoke, name: string) => invoke.invoke({ action: name, input: {}, authority: { of: "human", basis: "test" }, reason: "test" });

test("the setup names this server's adapter, with every hook through the command", () => {
  const s = setup({ hook: "http://127.0.0.1:5181/hook", mcp: "http://127.0.0.1:5181/mcp", command: "node hook.ts http://127.0.0.1:5181/hook", token: false });
  assert.equal(s.mcp, "claude mcp add --scope user --transport http archipelago http://127.0.0.1:5181/mcp");
  const parsed = JSON.parse(s.hooks);
  assert.deepEqual(Object.keys(parsed.hooks), [...EVENTS]);
  assert.equal(parsed.hooks.PreToolUse[0].matcher, "*");
  assert.equal(parsed.hooks.Stop[0].matcher, undefined);
  assert.equal(parsed.hooks.Stop[0].hooks[0].command, "node hook.ts http://127.0.0.1:5181/hook");
  assert.equal(parsed.env, undefined);
  assert.ok(!s.hooks.includes(TOKEN) && !s.mcp.includes(TOKEN));
});

test("where a token is taken, the texts hold its placeholder until the person's own goes in", () => {
  const s = setup({ hook: "https://map.example/hook", mcp: "https://map.example/mcp", command: "node hook.ts https://map.example/hook", token: true });
  assert.ok(s.mcp.endsWith(`--header "Authorization: Bearer ${TOKEN}"`));
  assert.equal(JSON.parse(s.hooks).env.ARCHIPELAGO_TOKEN, TOKEN);
  const mcp = withToken(s.mcp, "abc");
  assert.ok(mcp.includes("Bearer abc") && !mcp.includes(TOKEN));
  assert.equal(JSON.parse(withToken(s.hooks, "abc")).env.ARCHIPELAGO_TOKEN, "abc");
  assert.equal(withToken(s.mcp, undefined), s.mcp);
});

test("the local command runs this checkout's hook script", () => {
  const c = localCommand("http://127.0.0.1:5181/hook");
  assert.match(c, /^node ".*\/packs\/claude-code\/hook\.ts" http:\/\/127\.0\.0\.1:5181\/hook$/);
  assert.ok(!c.includes("\\"));
});

test("connect.setup answers what to copy, and with no token action there is no connect.token", async () => {
  const { person } = await setupTree({ hook: "http://127.0.0.1:5281/hook", mcp: "http://127.0.0.1:5281/mcp" });
  const out = await call(person, SETUP);
  assert.ok(out.ok);
  const s = out.output as unknown as Setup;
  assert.equal(s.token, false);
  assert.ok(s.mcp.includes("http://127.0.0.1:5281/mcp"));
  assert.ok(s.hooks.includes("http://127.0.0.1:5281/hook"));
  const none = await call(person, MAKE_TOKEN);
  assert.equal(none.ok, false);
});

test("connect.token makes a token for a person, and refuses an agent", async () => {
  const { person, agent } = await setupTree({ hook: "https://map.example/hook", mcp: "https://map.example/mcp", command: "node hook.ts", token: "tokens.make" });
  const s = (await call(person, SETUP)) as { ok: true; output: unknown };
  assert.equal((s.output as Setup).token, true);
  const made = await call(person, MAKE_TOKEN);
  assert.ok(made.ok);
  assert.deepEqual(made.output, { token: "t0ken-secret" });
  const refused = await call(agent, MAKE_TOKEN);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.refused.code, "person_only");
});

test("a run is named by its title, else its folder, else its id", () => {
  assert.equal(runName({ run: "abcdef123456", title: "Fix the build" }), "Fix the build");
  assert.equal(runName({ run: "abcdef123456", cwd: "C:\\work\\demo-repo" }), "demo-repo");
  assert.equal(runName({ run: "abcdef123456", cwd: "/home/x/demo/" }), "demo");
  assert.equal(runName({ run: "abcdef123456" }), "abcdef12");
});
