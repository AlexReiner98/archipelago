// What a watched query's edge meets (decision e_esqevwkf; the shape e_52e35bft): given the items an automation's
// query matches now and what its edge met before, which firings that makes and what to remember. Pure: the clock
// (packs/automation_triggers/kernel/due-on.ts) reads the query, keeps the memory and writes item.due; this says only what came due.
//
// The first pass over an `on` only learns what already matches: a query starts to match after it is set, never before.

import type { Edge } from './automation-rules.ts';

/** What an edge has met, kept between passes. */
export interface Memory {
  /** The `on` it was met under: another `on` starts again from what matches then. */
  on: string;
  /** The log's position when the query was last asked: until the log moves, nothing can start to match. */
  pos: number;
  /** first: whether it has fired (or matched when first asked). */
  done?: boolean;
  /** each: the items that have matched. first_per: the values met. crosses: the items at or over n. */
  seen?: (string | number | boolean)[];
}

/** One firing of a query's edge: the automation, the edge met and what met it. */
export interface Met {
  item: string;
  type: string;
  title: string;
  at: string;
  edge: string;
  matched: string[];
  value?: unknown;
}

/** An item as an edge reads it: its id, its fields, and the columns of its head. */
export interface Matched { id: string; props?: Record<string, unknown> | null }

/** The value of a field of an item: a field its type declares, else a column of its head (status, owner, title). */
const valueOf = (e: Matched, field: string): unknown => (field in (e.props ?? {}) ? e.props![field] : (e as unknown as Record<string, unknown>)[field]);
const key = (v: unknown): string | number | boolean => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v));

/**
 * What an edge meets, given the items its query matches now and what it remembered: the firings, and what to remember.
 * Without memory (the first pass over this `on`) it only learns what matches.
 */
export function meet(edge: Edge, now: Matched[], was: Memory | undefined, on: string, pos: number): { met: Omit<Met, 'item' | 'type' | 'title' | 'at'>[]; keep: Memory } {
  const met: Omit<Met, 'item' | 'type' | 'title' | 'at'>[] = [];
  const first = !was;
  const seen = new Set(was?.seen ?? []);
  switch (edge.kind) {
    case 'first': {
      const done = Boolean(was?.done) || (now.length > 0 && first);
      if (!done && now.length) met.push({ edge: 'first', matched: now.map((e) => e.id) });
      return { met, keep: { on, pos, done: done || now.length > 0 } };
    }
    case 'each': {
      for (const e of now) if (!seen.has(e.id) && !first) met.push({ edge: 'each', matched: [e.id] });
      // What left the query may match again later, and then it starts to match again.
      return { met, keep: { on, pos, seen: now.map((e) => e.id) } };
    }
    case 'first_per': {
      const values = new Map<string | number | boolean, string[]>();
      for (const e of now) {
        const v = valueOf(e, edge.field);
        if (v === undefined || v === null || v === '') continue;
        values.set(key(v), [...(values.get(key(v)) ?? []), e.id]);
      }
      for (const [v, ids] of values) if (!seen.has(v) && !first) met.push({ edge: `first_per:${edge.field}`, matched: ids, value: v });
      // A value once met stays met: one firing for each value, ever.
      return { met, keep: { on, pos, seen: [...new Set([...seen, ...values.keys()])] } };
    }
    case 'crosses': {
      const over: string[] = [];
      for (const e of now) {
        const v = Number(valueOf(e, edge.field));
        if (!Number.isFinite(v) || v < edge.n) continue;
        over.push(e.id);
        if (!seen.has(e.id) && !first) met.push({ edge: `crosses:${edge.n}`, matched: [e.id], value: v });
      }
      // An item back under n may cross it again: it is no longer remembered as over.
      return { met, keep: { on, pos, seen: over } };
    }
  }
}
