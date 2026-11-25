import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dispose } from "../spec/common.ts";
import { Runtime, type Context, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import client from "../plugins/bridge/client.ts";

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
