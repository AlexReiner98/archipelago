/**
 * Flow: reading order. What depends on something sits below it, so a
 * chain of work reads top to bottom.
 */
import { weight, type Behaviour } from "../behaviour.ts";

const flow: Behaviour = {
  name: "flow",
  doc: "What depends on something sits below it.",
  on: true,
  dials: () => [
    weight("flow"),
    { key: "flow_gap", label: "drop", min: 0, max: 100, step: 1, value: 22, doc: "How far below what it depends on an item wants to sit." },
    { key: "flow_k", label: "pull", min: 0, max: 0.5, step: 0.005, value: 0.08, doc: "How hard an item that sits too high is pushed down (and what it depends on, up)." },
    { key: "flow_waits", label: "waits_on too", min: 0, max: 1, step: 1, value: 0, choices: ["no", "yes"], doc: "Whether waits_on orders like depends_on." },
  ],
  apply(g, f, S) {
    const kinds = new Set([g.linkKinds.indexOf("depends_on"), S.flow_waits ? g.linkKinds.indexOf("waits_on") : -1]);
    kinds.delete(-1);
    if (!kinds.size) return;
    const gap = S.flow_gap!, k = S.flow_k!;
    for (let e = 0; e < g.m; e++) {
      if (!kinds.has(g.kind[e]!)) continue;
      // from depends on to: from goes below to by at least the gap.
      const a = g.a[e]!, b = g.b[e]!, short = g.y[b]! + gap - g.y[a]!;
      if (short <= 0) continue;
      const push = k * short;
      f.y[a]! += push / 2;
      f.y[b]! -= push / 2;
    }
  },
};

export default flow;
