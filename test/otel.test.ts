import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { AgentNode, AgentRun } from "../spec/agent.ts";
import { LIMIT_MAX } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import agent from "../plugins/agent/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import otel, { type OtelConfig } from "../plugins/otel/index.ts";
import { placeOf, traceOf, tracesUrl, shownUrl, type KeyValue, type Span } from "../plugins/otel/spans.ts";
import { markOf } from "../plugins/otel/view.ts";
import { otelFromEnv } from "../app/tree.ts";

const RUN = "5f0c2a9e-1b7d-4c3e-9a8f-0123456789ab";
const SUB = "sub-run";
const at = (s: number) => new Date(Date.UTC(2026, 10, 24, 10, 0, s)).toISOString();

/** A local OTLP/HTTP receiver: what each POST to /v1/traces carried. */
async function receiver(fail = 0) {
  const got: { url: string; headers: IncomingMessage["headers"]; body: any }[] = [];
  let failing = fail;
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      if (failing > 0) {
        failing--;
        res.writeHead(503).end();
        return;
      }
      got.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(text) });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { got, endpoint: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Stands in for the transcript plugin: the run's token use. */
const fakeTranscript: Plugin = {
  id: "transcript",
  inject: ["action.register"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({
      name: "transcript.tokens",
      title: "fake",
      input: { type: "object" },
      async run(input: { run: string }) {
        if (input.run !== RUN) return { rows: [], none: true };
        return {
          rows: [
            { n: 1, kind: "usage", input: 10, cacheRead: 100, cacheWrite: 50, output: 7, model: "claude-test" },
            { n: 2, kind: "usage", input: 5, cacheRead: 200, cacheWrite: 0, output: 3, model: "claude-test" },
          ],
        };
      },
    });
  },
};

/** A node that speaks before every tool call. */
const speaker: Plugin = {
  id: "speaker",
  inject: ["agent.node"],
  apply(ctx) {
    ctx.get<AgentNode>("agent.node").node({ name: "hint", kind: "reflex", title: "Hint", at: ["tool:*"], repeat: "every", speak: () => ({ say: "the map's said words" }) });
  },
};

const probe: Plugin = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };

async function start(config: OtelConfig) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, exchange, agent, speaker, transcript: fakeTranscript, otel, probe } as Record<string, Plugin>;
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, plugin: id, ...(id === "otel" ? { config } : {}) }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = (run: string) => loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run });
  const invoke = (a: string, input: object) => ctx(RUN).get<ActionInvoke>("action.invoke").invoke({ action: a, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  return { loader, errors, ctx, invoke, stop: () => loader.apply([]) };
}

/** A run with a parent: a say before a tool call, the call, a failing call, a reply; then its end. */
async function play(ctx: (run: string) => any) {
  const run = ctx(RUN).get("agent.run") as AgentRun;
  await run.begin({ run: RUN, agent: { id: "e_agent", kind: "agent" }, harness: "claude-code", reaches: [], title: "Secret title", cwd: "/home/me/project", parent: "p-run", task: "i_task" });
  await run.act({ run: RUN, place: "prompt", time: at(1), kind: "prompt", by: "person", input: "the map's words in a prompt" });
  await run.reach({ run: RUN, places: ["tool:Bash"], time: at(2) });
  await run.act({ run: RUN, place: "tool:Bash", time: at(4), kind: "tool", by: "agent", ok: true, input: { command: "ls /home/me" }, output: "a b" });
  await run.act({ run: RUN, place: "tool:mcp__archipelago__get", time: at(6), kind: "tool", by: "agent", ok: false, input: { ids: ["x"] }, output: "boom" });
  await run.act({ run: RUN, place: "reply_end", time: at(8), kind: "reply", by: "agent", output: "done" });
  await run.end(RUN, at(9));
}

const attr = (s: { attributes: KeyValue[] }, key: string) => {
  const v = s.attributes.find((a) => a.key === key)?.value as Record<string, unknown> | undefined;
  return v ? Object.values(v)[0] : undefined;
};

async function until(check: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!check()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("spans: a UUID run is its own trace id; places keep only their kind without content; endpoints", () => {
  assert.equal(traceOf(RUN), RUN.replace(/-/g, ""));
  assert.match(traceOf("r1"), /^[0-9a-f]{32}$/);
  assert.equal(traceOf("r1"), traceOf("r1"));
  assert.equal(placeOf("file:/home/me/secret.txt", false), "file");
  assert.equal(placeOf("tool:Bash", false), "tool:Bash");
  assert.equal(placeOf("file:/home/me/secret.txt", true), "file:/home/me/secret.txt");
  assert.equal(tracesUrl("http://127.0.0.1:4318"), "http://127.0.0.1:4318/v1/traces");
  assert.equal(tracesUrl("https://x.example.org/otlp/v1/traces"), "https://x.example.org/otlp/v1/traces");
  assert.equal(shownUrl("https://me:pw@x.example.org/otlp?key=1"), "https://x.example.org/otlp/v1/traces");
});

test("otel: the exchange as OTLP JSON: a run span with tokens and a parent link, acts as children; no words by default", async () => {
  const rx = await receiver();
  const { ctx, invoke, errors, stop } = await start({ endpoint: rx.endpoint, headers: { authorization: "Bearer t" }, batch_ms: 5 });
  try {
    await play(ctx);
    await until(() => rx.got.flatMap((g) => g.body.resourceSpans[0].scopeSpans[0].spans).length >= 5);
    assert.equal(rx.got[0]!.url, "/v1/traces");
    assert.equal(rx.got[0]!.headers["content-type"], "application/json");
    assert.equal(rx.got[0]!.headers.authorization, "Bearer t");
    assert.equal(attr(rx.got[0]!.body.resourceSpans[0].resource, "service.name"), "archipelago");
    const spans: Span[] = rx.got.flatMap((g) => g.body.resourceSpans[0].scopeSpans[0].spans);
    const root = spans.find((s) => !s.parentSpanId)!;
    const kids = spans.filter((s) => s.parentSpanId);
    const trace = RUN.replace(/-/g, "");

    assert.equal(root.name, "invoke_agent claude-code");
    assert.equal(root.traceId, trace);
    assert.equal(attr(root, "gen_ai.operation.name"), "invoke_agent");
    assert.equal(attr(root, "gen_ai.conversation.id"), RUN);
    assert.equal(attr(root, "gen_ai.usage.input_tokens"), String(15 + 300 + 50), "input counts the cache too");
    assert.equal(attr(root, "gen_ai.usage.output_tokens"), "10");
    assert.equal(attr(root, "gen_ai.usage.cache_read.input_tokens"), "300");
    assert.equal(attr(root, "gen_ai.response.model"), "claude-test");
    assert.equal(attr(root, "archipelago.task"), "i_task");
    assert.equal(attr(root, "archipelago.acts"), "4");
    assert.equal(root.endTimeUnixNano, String(Date.parse(at(9)) * 1e6));
    assert.equal(root.links?.[0]?.traceId, traceOf("p-run"), "a subrun links to its parent run");

    assert.equal(kids.length, 4);
    assert.ok(kids.every((k) => k.traceId === trace && k.parentSpanId === root.spanId));
    assert.deepEqual(kids.map((k) => k.name).sort(), ["execute_tool Bash", "execute_tool mcp__archipelago__get", "prompt", "reply"]);
    const bash = kids.find((k) => k.name === "execute_tool Bash")!;
    assert.equal(attr(bash, "gen_ai.operation.name"), "execute_tool");
    assert.equal(attr(bash, "gen_ai.tool.name"), "Bash");
    assert.equal(attr(bash, "gen_ai.tool.type"), "function");
    assert.equal(bash.startTimeUnixNano, String(Date.parse(at(2)) * 1e6), "a tool call starts when the map was reached at its place");
    assert.equal(bash.endTimeUnixNano, String(Date.parse(at(4)) * 1e6));
    assert.equal(root.events?.[0]?.name, "archipelago.say");
    assert.equal(attr(root.events![0]!, "archipelago.node"), "speaker/hint");
    assert.equal(attr(root.events![0]!, "archipelago.text"), undefined);
    const failed = kids.find((k) => k.name === "execute_tool mcp__archipelago__get")!;
    assert.deepEqual(failed.status, { code: 2 });
    assert.equal(attr(failed, "error.type"), "tool_error");
    assert.equal(attr(failed, "gen_ai.tool.type"), "extension");

    // Without include_content, none of the words leave: no input, output, title or folder.
    const sent = JSON.stringify(rx.got.map((g) => g.body));
    for (const words of ["the map's said words", "the map's words", "ls /home/me", "boom", "done", "Secret title", "/home/me/project"]) assert.ok(!sent.includes(words), `${words} was sent`);

    // The receiver holds the spans a moment before the sender hears back.
    let st = await invoke("otel.status", { runs: [RUN, "other"] });
    for (let i = 0; i < 100 && st.ok && (st.output as any).runs[0].spans < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      st = await invoke("otel.status", { runs: [RUN, "other"] });
    }
    assert.ok(st.ok);
    const o = st.output as any;
    assert.equal(o.on, true);
    assert.equal(o.endpoint, `${rx.endpoint}/v1/traces`);
    assert.equal(o.include_content, false);
    assert.equal(o.runs[0].spans, 5);
    assert.equal(o.runs[0].whole, true);
    assert.equal(o.runs[1].spans, 0);
    assert.equal(st.change, undefined, "a read writes nothing");
    const mark = markOf(o, RUN)!;
    assert.equal(mark.text, `otel · 127.0.0.1:${rx.endpoint.split(":").pop()}`);
    assert.match(mark.title, /without the map's words/);
    assert.equal(markOf(o, "other")!.text, "otel · waiting");
    assert.deepEqual(errors, []);
  } finally {
    await stop();
    await rx.close();
  }
});

test("otel: with include_content the words go, as gen_ai tool arguments and results; a say's words on its event on the run", async () => {
  const rx = await receiver();
  const { ctx, stop } = await start({ endpoint: rx.endpoint + "/v1/traces", include_content: true, batch_ms: 5 });
  try {
    await play(ctx);
    await until(() => rx.got.flatMap((g) => g.body.resourceSpans[0].scopeSpans[0].spans).some((s: Span) => !s.parentSpanId));
    const spans: Span[] = rx.got.flatMap((g) => g.body.resourceSpans[0].scopeSpans[0].spans);
    const bash = spans.find((k) => k.name === "execute_tool Bash")!;
    assert.equal(attr(bash, "gen_ai.tool.call.arguments"), JSON.stringify({ command: "ls /home/me" }));
    assert.equal(attr(bash, "gen_ai.tool.call.result"), "a b");
    const root = spans.find((s) => !s.parentSpanId)!;
    assert.equal(attr(root, "archipelago.title"), "Secret title");
    assert.equal(attr(root.events![0]!, "archipelago.text"), "the map's said words");
  } finally {
    await stop();
    await rx.close();
  }
});

test("otel: off without an endpoint; a failed send is tried once more, and its status says so", async () => {
  const off = await start({});
  try {
    await play(off.ctx);
    const st = await off.invoke("otel.status", { runs: [RUN] });
    assert.ok(st.ok);
    assert.equal((st.output as any).on, false);
    assert.equal(markOf(st.output as any, RUN), undefined, "nothing shows while off");
    // Not a list: the action plugin refuses it against the declared input, before otel sees it.
    const bad = await off.invoke("otel.status", { runs: "x" });
    assert.ok(!bad.ok && bad.refused.code === "action.input");
    // A list past the read limit: otel's own refusal.
    const long = await off.invoke("otel.status", { runs: Array.from({ length: LIMIT_MAX + 1 }, (_, i) => `r${i}`) });
    assert.ok(!long.ok && long.refused.code === "otel.runs");
  } finally {
    await off.stop();
  }

  const rx = await receiver(1);
  const { ctx, invoke, stop } = await start({ endpoint: rx.endpoint, batch_ms: 5 });
  try {
    const run = ctx(SUB).get("agent.run") as AgentRun;
    await run.begin({ run: SUB, agent: { id: "e_agent", kind: "agent" }, harness: "claude-code", reaches: [], facts: { agent_type: "Explore" } });
    await run.act({ run: SUB, place: "tool:Read", time: at(2), kind: "tool", by: "agent", ok: true });
    await until(() => rx.got.length >= 1);
    let st = await invoke("otel.status", { runs: [SUB] });
    for (let i = 0; i < 100 && (st as any).output.runs[0].spans < 1; i++) {
      await new Promise((r) => setTimeout(r, 10));
      st = await invoke("otel.status", { runs: [SUB] });
    }
    const r = (st as any).output.runs[0];
    assert.equal(r.spans, 1, "taken on the second try");
    assert.equal(r.failed, 0);
    assert.equal(r.error, undefined);
    assert.equal(r.whole, false, "the run's own span waits for its end");
    await run.end(SUB, at(3));
    await until(() => rx.got.length >= 2);
    const root = rx.got[1]!.body.resourceSpans[0].scopeSpans[0].spans[0] as Span;
    assert.equal(root.name, "invoke_agent Explore");
    assert.equal(attr(root, "gen_ai.usage.input_tokens"), undefined, "no transcript, no tokens");
  } finally {
    await stop();
    await rx.close();
  }
});

test("otelFromEnv: the standard OTLP variables; words only when asked", () => {
  assert.deepEqual(otelFromEnv({}), {});
  assert.deepEqual(otelFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", OTEL_EXPORTER_OTLP_HEADERS: "x-key=abc,y=1%3D2", OTEL_SERVICE_NAME: "me" }), {
    endpoint: "http://127.0.0.1:4318",
    headers: { "x-key": "abc", y: "1=2" },
    service: "me",
    include_content: false,
  });
  assert.equal(otelFromEnv({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://a/v1/traces", OTEL_EXPORTER_OTLP_ENDPOINT: "http://b", ARCHIPELAGO_OTEL_CONTENT: "1" }).endpoint, "http://a/v1/traces");
});
