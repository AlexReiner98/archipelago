// Promote and retire reflexes by their record (decided, e_qmx3v2bx: a trial node is only said; its record promotes
// it). Decided without the map: the nodes, their records, the thresholds and the time in, status ops out. The timer
// (tick.ts) reads and sends them as this pack's change, on the record's authority.

import type { Record_ } from './record.ts';

/** When a node moves, as the pack's settings (its memory, key thresholds): the owner may keep others. */
export interface Thresholds {
  /** Runs it held in (its miss stopped, or never came back) with none failed: a trial becomes current. */
  promote_held: number;
  /** Runs it failed in (its miss came back after it was said): it retires, trial or current, when they outnumber its held. */
  retire_failed: number;
  /** Days a node may go unsaid (since it was last said, or made) before it retires. */
  retire_unsaid_days: number;
}

export const DEFAULTS: Thresholds = { promote_held: 3, retire_failed: 2, retire_unsaid_days: 30 };

/** The owner's thresholds over the defaults: only whole numbers of at least 1 are taken. */
export const thresholdsOf = (kept: unknown): Thresholds => {
  const out = { ...DEFAULTS };
  if (kept && typeof kept === 'object') for (const k of Object.keys(DEFAULTS) as (keyof Thresholds)[]) {
    const v = (kept as Record<string, unknown>)[k];
    if (Number.isInteger(v) && (v as number) >= 1) out[k] = v as number;
  }
  return out;
};

export interface NodeHead {
  id: string;
  status: string;
  created_at: string;
  /** When its situation ends, when it says a date. */
  until?: string;
}

export interface Move {
  id: string;
  status: 'current' | 'retired';
  /** Why, from its record: the change's reason and the basis of its authority. */
  why: string;
}

const DAY = 86_400_000;

/** What becomes of one node, or nothing. */
export function moveOf(node: NodeHead, record: Pick<Record_, 'failed' | 'held' | 'quiet' | 'last'> | undefined, t: Thresholds, now: Date): Move | undefined {
  if (node.status !== 'trial' && node.status !== 'current') return undefined;
  const r = record ?? { failed: 0, held: 0, quiet: 0 };
  const held = r.held + r.quiet;
  const until = node.until && /^\d{4}-\d{2}-\d{2}/.test(node.until) ? Date.parse(node.until) : NaN;
  if (until < now.getTime()) return { id: node.id, status: 'retired', why: `its situation ended (until ${node.until})` };
  if (r.failed >= t.retire_failed && r.failed > held) return { id: node.id, status: 'retired', why: `its miss came back in ${r.failed} runs after it was said, held in ${held}` };
  const since = Date.parse(r.last ?? node.created_at);
  if (now.getTime() - since > t.retire_unsaid_days * DAY) return { id: node.id, status: 'retired', why: `not said in ${t.retire_unsaid_days} days` };
  if (node.status === 'trial' && r.failed === 0 && held >= t.promote_held) return { id: node.id, status: 'current', why: `held in ${held} runs (${r.held} where its miss stopped), failed in none` };
  return undefined;
}

/** Every move of these nodes, by their records. */
export const movesOf = (nodes: NodeHead[], records: Map<string, Pick<Record_, 'failed' | 'held' | 'quiet' | 'last'>>, t: Thresholds, now: Date): Move[] =>
  nodes.map((n) => moveOf(n, records.get(n.id), t, now)).filter((m): m is Move => !!m);
