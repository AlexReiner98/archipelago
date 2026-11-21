/**
 * The harness view's rows opened in place (packs/harness/expand.ts): an
 * exchange event in, its labelled parts out, both directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExchangeEvent } from "../spec/exchange.ts";
import { asText, expand, fold, pretty } from "../packs/harness/expand.ts";

const base = { id: "e1", run: "r", seq: 3, time: "2026-11-21T09:00:00Z" };
const labels = (e: ExchangeEvent) => expand(e).map((p) => p.label);

test("a say: its node, place, pack and the words whole", () => {
  const words = "One line per row.\nA row never wraps.";
  const parts = expand({ ...base, direction: "to_agent", kind: "say", node: "words/one-line", place: "file:packs/x.ts", pack: "words", text: words });
  assert.deepEqual(parts.map((p) => p.label), ["kind", "node", "place", "pack", "said", "at"]);
  assert.equal(parts.find((p) => p.label === "said")!.text, words);
});

test("a refusal is labelled refused", () => {
  assert.ok(labels({ ...base, direction: "to_agent", kind: "refuse", node: "n", place: "tool:Bash", text: "No secrets" }).includes("refused"));
});

test("a tool call by the agent: its input field by field, its MCP output as text", () => {
  const parts = expand({
    ...base,
    direction: "from_agent",
    kind: "act",
    place: "tool:mcp__archipelago__tell",
    act: { kind: "tool", by: "agent", ok: true, input: { said: "Activity built", about: ["i_1"] }, output: { content: [{ type: "text", text: '{"id":"i_2"}' }] } },
  });
  const by = new Map(parts.map((p) => [p.label, p.text]));
  assert.equal(by.get("act"), "tool by agent");
  assert.equal(by.get("input.said"), "Activity built");
  assert.equal(by.get("input.about"), '[\n  "i_1"\n]');
  assert.equal(by.get("output"), '{\n  "id": "i_2"\n}');
});

test("an output kept as JSON text is indented", () => {
  const parts = expand({ ...base, direction: "from_agent", kind: "act", place: "tool:x", act: { kind: "tool", by: "agent", output: '{"change":"c1"}' } });
  assert.equal(parts.find((p) => p.label === "output")!.text, '{\n  "change": "c1"\n}');
});

test("a failed act says so; a prompt and a reply are their text", () => {
  assert.equal(expand({ ...base, direction: "from_agent", kind: "act", place: "tool:Edit", act: { kind: "tool", by: "agent", ok: false, input: {} } })[0]!.text, "tool by agent · did not work");
  const prompt = expand({ ...base, direction: "from_agent", kind: "act", place: "prompt", act: { kind: "prompt", by: "person", input: "Build it\nwith tests" } });
  assert.deepEqual(prompt.find((p) => p.label === "prompt"), { label: "prompt", text: "Build it\nwith tests" });
  const reply = expand({ ...base, direction: "from_agent", kind: "act", place: "reply_end", act: { kind: "reply", by: "agent", output: "Done." } });
  assert.equal(reply.find((p) => p.label === "reply")!.text, "Done.");
});

test("detail is shown field by field; empty values are left out", () => {
  const parts = expand({ ...base, direction: "to_agent", kind: "gated", node: "n", text: "held back", detail: { gate: "profile", trial: true, note: "" } });
  const ls = parts.map((p) => p.label);
  assert.ok(ls.includes("detail.gate") && ls.includes("detail.trial"));
  assert.ok(!ls.includes("detail.note"));
});

test("fold: a dozen lines show, the rest is counted", () => {
  const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const f = fold(text);
  assert.equal(f.head.split("\n").length, 12);
  assert.equal(f.more, 8);
  assert.deepEqual(fold("short"), { head: "short", more: 0 });
  const long = fold("x".repeat(2000));
  assert.ok(long.head.endsWith("…") && long.more === 1);
});

test("pretty: JSON text indented, other text as it is", () => {
  assert.equal(pretty('{"a":[1]}'), '{\n  "a": [\n    1\n  ]\n}');
  assert.equal(pretty("{not json"), "{not json");
  assert.equal(pretty("plain words"), "plain words");
});

test("asText: strings as they are, values as indented JSON", () => {
  assert.equal(asText("a\nb"), "a\nb");
  assert.equal(asText({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(asText(undefined), "");
});
