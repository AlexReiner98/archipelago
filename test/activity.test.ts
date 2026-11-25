/**
 * The activity view's model: runs and journal entries in, groups and lines
 * out (plugins/activity/model.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunInfo } from "../spec/agent.ts";
import type { Fact } from "../spec/changeset.ts";
import { brief, group, liveness, openAtFirst, standing, status, touches, type Change } from "../plugins/activity/model.ts";

const agent = { id: "agent:claude", kind: "agent" as const };
const owner = { id: "person:owner", kind: "person" as const };

const run = (id: string, started: string, ended?: string, title?: string): RunInfo => ({
  run: id,
  agent,
  harness: "claude-code",
  reaches: [],
  started,
  ...(ended ? { ended } : {}),
  ...(title ? { title } : {}),
});

let seq = 0;
const change = (o: { run?: string; actor?: typeof agent | typeof owner; at: string; facts?: Fact[]; undoes?: string; undoneBy?: string }): Change => {
  seq++;
  return {
    id: `c${seq}`,
    seq,
    committed: o.at,
    header: {
      actor: o.actor ?? agent,
      authority: { of: "agent" },
      plugin: { id: "items" },
      action: "items.set",
      reason: "because",
      time: o.at,
      ...(o.run ? { run: o.run } : {}),
      ...(o.undoes ? { undoes: o.undoes } : {}),
    },
    facts: o.facts ?? [],
    ...(o.undoneBy ? { undoneBy: o.undoneBy } : {}),
  };
};

test("a run's changes go under it, newest first; groups newest first", () => {
  seq = 0;
  const runs = [run("r2", "2026-11-21T10:00:00Z"), run("r1", "2026-11-21T09:00:00Z", "2026-11-21T09:30:00Z", "first")];
  const cs = [
    change({ run: "r1", at: "2026-11-21T09:10:00Z" }),
    change({ run: "r1", at: "2026-11-21T09:20:00Z" }),
    change({ run: "r2", at: "2026-11-21T10:05:00Z" }),
  ];
  const g = group(runs, cs);
  assert.deepEqual(g.map((x) => x.key), ["run:r2", "run:r1"]);
  assert.deepEqual(g[1]!.changes.map((c) => c.id), ["c2", "c1"]);
  assert.equal(g[0]!.open, true);
  assert.equal(g[1]!.open, false);
  assert.equal(g[0]!.last, "2026-11-21T10:05:00Z");
});

test("a run that changed nothing is a group of its own; a run not read still groups its changes", () => {
  seq = 0;
  const g = group([run("quiet", "2026-11-21T08:00:00Z")], [change({ run: "old", at: "2026-11-20T08:00:00Z" })]);
  assert.deepEqual(g.map((x) => [x.key, x.changes.length, !!x.run]), [
    ["run:quiet", 0, true],
    ["run:old", 1, false],
  ]);
});

test("changes outside a run group by actor while they follow one another", () => {
  seq = 0;
  const cs = [
    change({ actor: owner, at: "2026-11-21T09:00:00Z" }),
    change({ actor: owner, at: "2026-11-21T09:01:00Z" }),
    change({ run: "r", at: "2026-11-21T09:02:00Z" }),
    change({ actor: owner, at: "2026-11-21T09:03:00Z" }),
  ];
  const g = group([], cs);
  assert.deepEqual(g.map((x) => [x.actor ?? x.key, x.changes.map((c) => c.id)]), [
    ["person:owner", ["c4"]],
    ["run:r", ["c3"]],
    ["person:owner", ["c2", "c1"]],
  ]);
});

test("open at first: the newest group, live runs, and the run picked; the rest fold", () => {
  seq = 0;
  const runs = [run("live", "2026-11-21T07:00:00Z"), run("setup", "2026-11-20T09:00:00Z", "2026-11-20T09:30:00Z"), run("picked", "2026-11-19T09:00:00Z", "2026-11-19T09:30:00Z")];
  const cs = [
    change({ run: "setup", at: "2026-11-20T09:10:00Z" }),
    change({ run: "picked", at: "2026-11-19T09:10:00Z" }),
    change({ actor: owner, at: "2026-11-21T10:00:00Z" }),
  ];
  const g = group(runs, cs);
  assert.equal(g[0]!.actor, "person:owner", "an undo outside any run is the newest");
  const open = openAtFirst(g, (x) => x.run?.run === "live", "picked");
  assert.deepEqual([...open].sort(), [g[0]!.key, "run:live", "run:picked"].sort());
  assert.equal(open.has("run:setup"), false, "an ended run, not picked, folds");
});

test("touches: made, removed, and fields set, each once per item", () => {
  const t = touches([
    ["+", "a", "type", "work"],
    ["+", "a", "title", "Do it"],
    ["+", "a", "status", "todo"],
    ["-", "b", "status", "todo"],
    ["+", "b", "status", "done"],
    ["-", "b", "note", "old"],
    ["-", "c", "type", "work"],
    ["-", "c", "title", "Gone one"],
  ]);
  assert.deepEqual(t, [
    { id: "a", kind: "new", fields: [["title", "Do it"], ["status", "todo"]], title: "Do it", type: "work" },
    { id: "b", kind: "set", fields: [["status", "done"], ["note", null]] },
    { id: "c", kind: "gone", fields: [], title: "Gone one", type: "work" },
  ]);
});

test("standing: an undo redoes, an undone set has no button", () => {
  seq = 0;
  assert.deepEqual(standing(change({ at: "t" })), { mark: "●", state: "stands", button: "undo" });
  assert.deepEqual(standing(change({ at: "t", undoes: "c1" })), { mark: "↶", state: "undo", button: "redo" });
  assert.deepEqual(standing(change({ at: "t", undoneBy: "c9" })), { mark: "⊖", state: "undone", button: undefined });
});

test("liveness: live while begun or heard from lately, open when quiet, ended when it says so", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  assert.equal(liveness(run("r", "2026-11-21T11:50:00Z"), undefined, now), "live");
  assert.equal(liveness(run("r", "2026-11-21T09:00:00Z"), undefined, now), "open");
  assert.equal(liveness(run("r", "2026-11-21T09:00:00Z"), now - 60_000, now), "live");
  assert.equal(liveness(run("r", "2026-11-21T11:59:00Z", "2026-11-21T11:59:30Z"), now, now), "ended");
});

test("status: the live and open runs, and the newest change", () => {
  seq = 0;
  const now = Date.parse("2026-11-21T12:00:00Z");
  const cs = [change({ at: "a" }), change({ at: "b" })];
  const runs = [run("r1", "2026-11-21T11:58:00Z"), run("r2", "2026-11-20T08:00:00Z"), run("r3", "2026-11-20T08:00:00Z", "2026-11-20T09:00:00Z")];
  const s = status(runs, [cs[1]!, cs[0]!], new Map(), now);
  assert.deepEqual(s.live.map((r) => r.run), ["r1"]);
  assert.deepEqual(s.open.map((r) => r.run), ["r2"]);
  assert.equal(s.last?.id, "c2");
  assert.equal(status([], []).last, undefined);
});

test("brief: one line, cut, null as ∅", () => {
  assert.equal(brief(null), "∅");
  assert.equal(brief("a\n  b"), "a b");
  assert.equal(brief("x".repeat(70), 10), `${"x".repeat(10)}…`);
  assert.equal(brief({ k: 1 }), '{"k":1}');
});
