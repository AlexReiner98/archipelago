/**
 * The solve as a DAG of rules. A rule names the rules it needs and the
 * dials it reads, and makes one output from theirs. `order` puts them in
 * an order where each comes after what it needs (and refuses a cycle);
 * `evaluate` runs them in it, again only where a dial it reads changed or
 * a rule it needs ran again, so a change runs as little as it must and the
 * page can show which rules ran. A `live` rule is not run here: it is
 * stepped by whoever holds the outputs (the solve, frame by frame). Pure.
 */
import type { Settings } from "../field/graph.ts";

export interface Rule {
  name: string;
  /** One line: what it makes. */
  doc: string;
  needs: string[];
  /** The dials it reads; a key ending in `*` is every key with that start. */
  dials: string[];
  /** Stepped by its holder, not run here. */
  live?: boolean;
  run?(inputs: Record<string, unknown>, S: Settings): unknown;
  /** A few words on what it made, for the page. */
  summary?(out: unknown): string;
}

export interface Ran {
  /** Whether it ran in this evaluation, or kept what it made before. */
  ran: boolean;
  ms: number;
  summary: string;
  /** How many times it has run. */
  runs: number;
}

export interface Evaluation {
  out: Record<string, unknown>;
  ran: Record<string, Ran>;
  S: Settings;
}

/** The rules in an order where each comes after what it needs, and each one's depth (0: needs nothing). Throws on a cycle or a missing rule. */
export function order(rules: Rule[]): { names: string[]; depth: Record<string, number> } {
  const by = new Map(rules.map((r) => [r.name, r]));
  const names: string[] = [], depth: Record<string, number> = {}, state = new Map<string, 1 | 2>();
  const visit = (name: string, path: string[]) => {
    const r = by.get(name);
    if (!r) throw new Error(`rule ${path.at(-1)} needs ${name}, which is not a rule`);
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) throw new Error(`the rules have a cycle: ${[...path, name].join(" → ")}`);
    state.set(name, 1);
    for (const n of r.needs) visit(n, [...path, name]);
    state.set(name, 2);
    depth[name] = r.needs.length ? Math.max(...r.needs.map((n) => depth[n]! + 1)) : 0;
    names.push(name);
  };
  for (const r of rules) visit(r.name, []);
  return { names, depth };
}

const reads = (r: Rule, a: Settings, b: Settings) =>
  r.dials.some((k) =>
    k.endsWith("*")
      ? [...new Set([...Object.keys(a), ...Object.keys(b)])].some((key) => key.startsWith(k.slice(0, -1)) && a[key] !== b[key])
      : a[k] !== b[k],
  );

/** Runs what must run, in order; keeps the rest from `last`. */
export function evaluate(rules: Rule[], S: Settings, last?: Evaluation): Evaluation {
  const by = new Map(rules.map((r) => [r.name, r]));
  const out: Record<string, unknown> = {}, ran: Record<string, Ran> = {};
  for (const name of order(rules).names) {
    const r = by.get(name)!;
    const was = last?.ran[name];
    const again = !last || !(name in last.out) || reads(r, S, last.S) || r.needs.some((n) => ran[n]!.ran);
    if (r.live || !r.run) {
      out[name] = undefined;
      ran[name] = { ran: again, ms: 0, summary: was?.summary ?? "", runs: (was?.runs ?? 0) + (again ? 1 : 0) };
      continue;
    }
    if (!again) {
      out[name] = last!.out[name];
      ran[name] = { ...was!, ran: false };
      continue;
    }
    const t0 = performance.now();
    out[name] = r.run(Object.fromEntries(r.needs.map((n) => [n, out[n]])), S);
    ran[name] = { ran: true, ms: performance.now() - t0, summary: r.summary?.(out[name]) ?? "", runs: (was?.runs ?? 0) + 1 };
  }
  return { out, ran, S };
}
