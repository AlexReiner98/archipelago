import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dispose } from "../spec/common.ts";
import { Runtime, type Context, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import client from "../plugins/bridge/client.ts";
import server, { agentActor, KEYS, SERVE, type BridgeServe } from "../plugins/bridge/server.ts";

/** A stand-in for the browser's EventSource: the test opens, feeds and fails each one. */
class FakeSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = FakeSource.CONNECTING;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.all.push(this);
  }
  send(value: unknown) {
    this.readyState = FakeSource.OPEN;
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  /** What a browser does on an answer that isn't the stream (a proxy's 502): close for good. */
  fail() {
    this.readyState = FakeSource.CLOSED;
    this.onerror?.();
  }
  close() {
    this.readyState = FakeSource.CLOSED;
  }
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok());
};

test("a stream the browser closes for good is opened again, and the watches made on it", async () => {
  const g = globalThis as Record<string, unknown>;
  const was = { EventSource: g.EventSource, fetch: g.fetch };
  const watched: { stream: string; key: string }[] = [];
  FakeSource.all = [];
  g.EventSource = FakeSource;
  g.fetch = async (url: string, init?: { body?: string }) => {
    const path = url.replace("http://bridge/", "");
    const msg = init?.body ? JSON.parse(init.body) : {};
    if (path === "watch") watched.push({ stream: msg.stream, key: msg.key });
    const value = path === "caps" ? { keys: ["graph.watch"], sync: {} } : { ok: true };
    return { json: async () => value } as Response;
  };
  const heard: unknown[] = [];
  const consumer: Plugin = {
    id: "consumer",
    inject: ["graph.watch"],
    apply(ctx: Context) {
      ctx.get<{ watch(f: unknown, on: (c: unknown) => void): Dispose }>("graph.watch").watch({ after: "1" }, (c) => heard.push(c));
    },
  };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { bridge: client as Plugin, consumer };
  const loader = new Loader(rt, { base: "mem:/", import: async (u) => ({ default: modules[u.slice("mem:/".length, -3)] }) });
  try {
    const applied = loader.apply([
      { id: "bridge", plugin: "bridge.ts", config: { url: "http://bridge/", retry: 5 } },
      { id: "consumer", plugin: "consumer.ts" },
    ]);
    await until(() => FakeSource.all.length === 1);
    FakeSource.all[0]!.send({ stream: "s1" });
    await applied;
    await rt.settle();
    await until(() => watched.some((w) => w.stream === "s1"));

    // The server restarts behind a proxy: the browser gets a 502 and gives up.
    FakeSource.all[0]!.fail();
    await until(() => FakeSource.all.length === 2);
    FakeSource.all[1]!.send({ stream: "s2" });
    await until(() => watched.some((w) => w.stream === "s2" && w.key === "graph.watch"));

    // What the new stream carries reaches the watch.
    FakeSource.all[1]!.send({ watch: 1, args: [{ id: "c9" }] });
    assert.deepEqual(heard, [{ id: "c9" }]);

    // A stream that is only reconnecting (a network error) is left to the browser.
    FakeSource.all[1]!.readyState = FakeSource.CONNECTING;
    FakeSource.all[1]!.onerror?.();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(FakeSource.all.length, 2);
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    g.EventSource = was.EventSource;
    g.fetch = was.fetch;
  }
});

test("a caller through the bridge may say it is an agent, and acts as that agent; never as another person", async () => {
  // Every key a stand-in; action.invoke answers with who called it.
  const stub: Plugin = {
    id: "stub",
    apply(ctx: Context) {
      for (const k of KEYS) ctx.provide(k, (caller) => (k === "action.invoke" ? { invoke: async () => ({ actor: caller.actor ?? null }) } : {}));
    },
  };
  let port = 0;
  const rt = new Runtime();
  const loader = new Loader(rt, { base: "mem:/", import: async (u) => ({ default: u.endsWith("stub.ts") ? stub : (server as Plugin) }) });
  await loader.apply([
    { id: "stub", plugin: "stub.ts" },
    { id: "bridge", plugin: "bridge.ts", config: { port: 0, actor: { id: "person:owner", kind: "person" }, onListen: (p: number) => (port = p) } },
  ]);
  const call = async (extra: Record<string, unknown>) => {
    const r = await fetch(`http://127.0.0.1:${port}/call`, { method: "POST", body: JSON.stringify({ key: "action.invoke", method: "invoke", args: [{}], ...extra }) });
    return (await r.json()) as { value?: { actor: unknown }; error?: string };
  };
  try {
    assert.ok(port > 0);
    // No actor named: the person at the page, as before.
    assert.deepEqual((await call({})).value, { actor: { id: "person:owner", kind: "person" } });
    // An agent named: that agent.
    assert.deepEqual((await call({ actor: { id: "agent:script", kind: "agent" } })).value, { actor: { id: "agent:script", kind: "agent" } });
    // A person, or an id that isn't one, is refused, and nothing is called.
    assert.match((await call({ actor: { id: "person:someone", kind: "person" } })).error ?? "", /only an agent/);
    assert.match((await call({ actor: { id: "bad id\n", kind: "agent" } })).error ?? "", /an id of/);
    // The page's own calls are untouched by the one before.
    assert.deepEqual((await call({})).value, { actor: { id: "person:owner", kind: "person" } });
    assert.equal(agentActor(undefined), undefined);
  } finally {
    await loader.apply([]);
  }
});

test("a plugin from elsewhere has the bridge serve a key of its own, until it unloads", async () => {
  const stub: Plugin = {
    id: "stub",
    apply(ctx: Context) {
      for (const k of KEYS) ctx.provide(k, () => ({}));
    },
  };
  // What a plugin folder's plugin does with a key it injects: hands it to the bridge.
  const loop: Plugin = {
    id: "loop",
    inject: [SERVE],
    apply(ctx: Context) {
      ctx.get<BridgeServe>(SERVE).serve("verdict.read", { of: async (run: string) => `verdicts of ${run}` });
    },
  };
  const modules: Record<string, Plugin> = { stub, loop, bridge: server as Plugin };
  let port = 0;
  const rt = new Runtime();
  const loader = new Loader(rt, { base: "mem:/", import: async (u) => ({ default: modules[u.slice("mem:/".length, -3)] }) });
  const tree = (withLoop: boolean) => [
    { id: "stub", plugin: "stub.ts" },
    { id: "bridge", plugin: "bridge.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "loop", plugin: "loop.ts", disabled: !withLoop },
  ];
  const caps = async () => ((await (await fetch(`http://127.0.0.1:${port}/caps`)).json()) as { keys: string[] }).keys;
  const call = async () =>
    (await (await fetch(`http://127.0.0.1:${port}/call`, { method: "POST", body: JSON.stringify({ key: "verdict.read", method: "of", args: ["r1"] }) })).json()) as { value?: string; error?: string };
  try {
    await loader.apply(tree(true));
    await rt.settle();
    assert.ok((await caps()).includes("verdict.read"));
    assert.equal((await call()).value, "verdicts of r1");
    // The plugin unloads: its key goes, and the bridge serves the core's alone.
    await loader.apply(tree(false));
    await rt.settle();
    assert.deepEqual(await caps(), [...KEYS]);
    assert.match((await call()).error ?? "", /not served/);
  } finally {
    await loader.apply([]);
  }
});
