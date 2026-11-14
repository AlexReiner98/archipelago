// Where a change to code is read (task e_vc5tpunk): an item's history (events, get with history) and the changes held
// for a person (proposals) say a field its type marks `code` as a line diff (./line-diff.ts), in place of the whole
// from and to. A person's page is given the diff as hunks to draw; an agent the same as compact text. `full: true`
// still answers the field whole, from the log.

import type { Archipelago } from '../../write/kernel/pelago.ts';
import { codeDiff, diffText, type CodeDiff } from './line-diff.ts';

/** The fields a type marks as code. */
export function codeFields(l: Pick<Archipelago, 'registry'>, type: string | null | undefined): Set<string> {
  const fields = (type && l.registry.type(type)?.fields) || {};
  return new Set(Object.entries(fields).filter(([, f]) => (f as { code?: boolean }).code).map(([k]) => k));
}

const size = (v: unknown) => (v === null || v === undefined ? 0 : typeof v === 'string' ? v.length : JSON.stringify(v).length);
const said = (d: CodeDiff, text: boolean) => (text ? diffText(d) : d);

type Ev = { target_type?: string | null; detail?: { changes?: Record<string, { from?: unknown; to?: unknown }> } | null };

/**
 * Each change to a code field in these events said as its diff and the sizes before and after (`diff`, `size`), not
 * its from and to; `text` for an agent's compact text. Other changes are left as they are.
 */
export function eventsWithDiffs<T>(l: Pick<Archipelago, 'registry'>, events: T[], text: boolean): T[] {
  return events.map((ev) => {
    const { target_type, detail } = ev as Ev;
    if (!detail?.changes || !target_type) return ev;
    const code = codeFields(l, target_type);
    if (!code.size) return ev;
    let touched = false;
    const changes = Object.fromEntries(
      Object.entries(detail.changes).map(([key, c]) => {
        if (!key.startsWith('props.') || !code.has(key.slice(6))) return [key, c];
        const d = codeDiff(c.from, c.to);
        if (!d) return [key, c];
        touched = true;
        return [key, { diff: said(d, text), size: [size(c.from), size(c.to)] }];
      }),
    );
    return touched ? { ...ev, detail: { ...detail, changes } } : ev;
  });
}

/** What one held op does to a code field, against what the item holds now. */
export interface OpDiff {
  /** The op's place in the change, from 0. */
  op: number;
  field: string;
  diff: CodeDiff | string;
}

/**
 * Each held change's updates to code fields, as diffs against what the items hold now (`diffs`); only of a change
 * still pending, whose diff is what applying it would do. `text` for an agent's compact text.
 */
export async function proposalsWithDiffs<P extends { status?: string; ops: unknown[] }>(l: Pick<Archipelago, 'registry' | 'entity'>, held: P[], text: boolean): Promise<(P & { diffs?: OpDiff[] })[]> {
  const items = new Map<string, Awaited<ReturnType<Archipelago['entity']>> | null>();
  const itemOf = async (id: string) => (items.has(id) ? items.get(id) : (items.set(id, await l.entity(id).catch(() => null)), items.get(id)));
  return Promise.all(
    held.map(async (p) => {
      if (p.status && p.status !== 'pending') return p;
      const diffs: OpDiff[] = [];
      for (const [i, raw] of p.ops.entries()) {
        const op = raw as { op?: string; id?: string; props?: Record<string, unknown> };
        if (op.op !== 'update' || !op.id || !op.props) continue;
        const item = await itemOf(op.id);
        if (!item) continue;
        const code = codeFields(l, item.type);
        for (const [field, to] of Object.entries(op.props)) {
          if (!code.has(field)) continue;
          const d = codeDiff(item.props?.[field], to);
          if (d) diffs.push({ op: i, field, diff: said(d, text) });
        }
      }
      return diffs.length ? { ...p, diffs } : p;
    }),
  );
}
