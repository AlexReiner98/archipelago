import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionsOf } from "../packs/sessions/index.ts";
import { sessionId, withFoundSessions, withSessions } from "../packs/field/sessions.ts";
import type { FieldIn } from "../packs/field/graph.ts";
import type { RunInfo } from "../spec/agent.ts";
import type { ProfileInfo } from "../spec/profile.ts";

const run = (id: string, title?: string, cwd?: string) => ({ run: id, title, cwd } as unknown as RunInfo);
const filter = (id: string) => ({ id } as unknown as ProfileInfo);

test("sessionsOf: each live run, named (its title, else its folder), with the filters it is in", () => {
  const out = sessionsOf([run("r1", "Add pricing"), run("r2", undefined, "/home/me/landing-page"), run("abcdef123456")], new Map([["r1", [filter("f1"), filter("f2")]]]));
  assert.deepEqual(out, [
    { run: "r1", title: "Add pricing", filters: ["f1", "f2"] },
    { run: "r2", title: "landing-page", filters: [] },
    { run: "abcdef123456", title: "abcdef12", filters: [] },
  ]);
});

const map: FieldIn = {
  items: [
    { id: "f1", title: "Frontend", type: "umwelt", status: "", closed: false },
    { id: "n1", title: "Semantic HTML", type: "record", status: "", closed: false },
  ],
  links: [{ id: "l1", type: "in_context_filter", from: "n1", to: "f1" }],
} as unknown as FieldIn;

test("withSessions: a session is drawn beside the map, linked to each of its filters on it", () => {
  const out = withSessions(map, [{ run: "r1", title: "landing-page", filters: ["f1", "gone"] }], true);
  assert.equal(out.items.length, 3);
  const s = out.items[2]!;
  assert.equal(s.id, sessionId("r1"));
  assert.equal(s.title, "landing-page");
  assert.equal(s.type, "session");
  // Only the filter the map holds gets a link.
  assert.deepEqual(out.links.slice(1).map((l) => [l.type, l.from, l.to]), [["runs_in", "session:r1", "f1"]]);
  // The map's own items and links are not touched.
  assert.equal(map.items.length, 2);
  assert.equal(map.links.length, 1);
});

test("withSessions: off, or none live, the map as it was", () => {
  const live = [{ run: "r1", title: "x", filters: ["f1"] }];
  assert.equal(withSessions(map, live, false), map);
  assert.equal(withSessions(map, [], true), map);
});

test("withFoundSessions: a session comes with a filter the find line found", () => {
  const live = [{ run: "r1", title: "a", filters: ["f1"] }, { run: "r2", title: "b", filters: ["f9"] }];
  assert.deepEqual([...withFoundSessions(new Set(["f1", "n1"]), live, true)!], ["f1", "n1", "session:r1"]);
  assert.equal(withFoundSessions(null, live, true), null);
  assert.deepEqual([...withFoundSessions(new Set(["f1"]), live, false)!], ["f1"]);
});

test("a session coming leaves every type's colour on the map as it was", async () => {
  const { inputColours } = await import("../packs/field/graph.ts");
  const typed = { ...map, types: ["record", "umwelt"] } as unknown as FieldIn;
  const before = new Map(inputColours(typed).map((t) => [t.name, t.colour]));
  const after = new Map(inputColours(withSessions(typed, [{ run: "r1", title: "a", filters: ["f1"] }], true)).map((t) => [t.name, t.colour]));
  for (const [name, colour] of before) assert.equal(after.get(name), colour, name);
  assert.ok(after.has("session"), "the session has a colour of its own, after theirs");
});

test("marksOf: each type's colour and the shape its items are drawn in, for other views to draw an item the same", async () => {
  const { marksOf } = await import("../packs/field/index.ts");
  const { inputColours } = await import("../packs/field/graph.ts");
  const shaped = { items: [{ id: "f1", title: "Frontend", type: "context_filter", status: "", closed: false, shape: 5 }, { id: "n1", title: "x", type: "record", status: "", closed: false }], links: [] } as unknown as FieldIn;
  const marks = marksOf(shaped, []);
  assert.equal(marks.context_filter!.shape, "hexagon");
  assert.equal(marks.record!.shape, "circle");
  assert.equal(marks.context_filter!.colour, inputColours(shaped).find((t) => t.name === "context_filter")!.colour, "the colour the particle is drawn in");
});
