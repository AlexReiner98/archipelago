/**
 * How what reaches between an agent and its tree is shown: by colour, not
 * by movement. When an agent is told a node, the
 * node's name and its branch from the root take the agent's colour, then
 * fade back. An act colours the bough of its place; a refusal or a failed
 * act is `failed`; a hold is `quiet`. Nothing travels.
 *
 * - `tintOf`: what an event colours, and in which tone.
 * - `wayOf`: the branches from the root to a node, the ones it colours.
 *
 * Every number is a dial (`DIALS`), with how long a switch of focus
 * takes (trees.ts), shown in the harness bar's ⋯ menu and
 * kept in the page key `harness.dials`. Colours are style tokens: the
 * run's hue, `failed`, `quiet`.
 */
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { lightOf, spotOf, type Placed, type Tree } from "./layout.ts";

export interface Dial {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  doc: string;
}

export const DIALS: readonly Dial[] = [
  { key: "tint_hold", label: "stays s", min: 0.2, max: 20, step: 0.1, value: 3, doc: "Seconds a branch keeps its agent's colour after it is told." },
  { key: "switch_s", label: "switch s", min: 0, max: 1.5, step: 0.05, value: 0.4, doc: "Seconds a tree takes to grow into focus while the old one shrinks into the column; 0 switches at once." },
  { key: "tint_fade", label: "fades s", min: 0, max: 5, step: 0.1, value: 1.2, doc: "Seconds the colour takes to come and to go." },
];

export type Dials = Record<string, number>;

/** The dials' values: each one given, within its range; else where it starts. */
export function dialsOf(given: unknown): Dials {
  const g = given && typeof given === "object" ? (given as Record<string, unknown>) : {};
  return Object.fromEntries(DIALS.map((d) => {
    const x = g[d.key];
    return [d.key, typeof x === "number" && Number.isFinite(x) ? Math.min(d.max, Math.max(d.min, x)) : d.value];
  }));
}

export interface Tint {
  /** node: a node told (or refused, or held); bough: where an act landed. */
  what: "node" | "bough";
  /** The tree node coloured, with its branch from the root. */
  at?: string;
  tone: "run" | "fail" | "hold";
}

/** What an event colours. Nothing when it has no place in the tree. */
export function tintOf(tree: Tree, e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">): Tint | undefined {
  if (e.kind === "gated") return { what: "node", at: e.node && tree.byId.has(e.node) ? e.node : spotOf(tree, e.place).id, tone: "hold" };
  const l = lightOf(tree, e);
  if (!l) return undefined;
  const tone = l.tone === "fail" ? "fail" : "run";
  return { what: e.kind === "say" || e.kind === "refuse" ? "node" : "bough", at: l.at, tone };
}

/** The branches from the root to a tree node, root side first: each named by the node it leads to. */
export function wayOf(tree: Tree, at: string): string[] {
  const out: string[] = [];
  for (let t = tree.byId.get(at); t?.parent; t = t.parent) out.push(t.id);
  return out.reverse();
}
