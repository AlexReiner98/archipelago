// What a row of today's tables says as facts (docs/log.md, section 2): an item's head fields and declared fields, one
// fact each, and a link's ends as one value. The write path reads back the rows it wrote and states them so; the
// projection (src/replay.ts) turns the facts back into the same rows.

import type { Fact } from './log.ts';
import { KEPT_FIELDS } from './operational.ts';

type Row = Record<string, any>;

/** An item's columns and the field each is in the log. Kernel defaults are not asserted: the value a field has unsaid. */
export const ITEM_COLUMNS: [column: string, field: string, unsaid: unknown][] = [
  ['type', 'type', undefined],
  ['kind', 'kind', null],
  ['title', 'title', undefined],
  ['body', 'body', ''],
  ['status', 'status', undefined],
  ['visibility', 'visibility', undefined],
  ['private_to', 'private_to', null],
  ['owner', 'owner', null],
  ['confidence', 'confidence', 1],
  ['source_id', 'source', null],
];

/** Fields no pack may declare: the head, and what the log says of an item beside its columns. */
export const RESERVED = [...ITEM_COLUMNS.map(([, f]) => f), 'archived', 'merged_into', 'forgotten', 'checked'];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Operational state is not a fact: it goes to its own stream later (section 4). */
const declared = (props: Row) => Object.entries(props ?? {}).filter(([k]) => !KEPT_FIELDS.includes(k));

/** A new item's facts, its type first: that assertion is its creation. */
export function itemFacts(row: Row): Fact[] {
  const facts: Fact[] = [];
  for (const [column, field, unsaid] of ITEM_COLUMNS) if (row[column] !== undefined && !same(row[column], unsaid)) facts.push(['+', row.id, field, row[column]]);
  for (const [k, v] of declared(row.props)) if (v !== null && v !== undefined) facts.push(['+', row.id, k, v]);
  return facts;
}

/** What changed between two readings of an item: one fact per field that moved, or `checked` when none did. */
export function changedFacts(before: Row, after: Row): Fact[] {
  const facts: Fact[] = [];
  for (const [column, field, unsaid] of ITEM_COLUMNS) {
    if (same(before[column], after[column])) continue;
    facts.push(after[column] === null || same(after[column], unsaid) ? ['-', after.id, field] : ['+', after.id, field, after[column]]);
  }
  const was = Object.fromEntries(declared(before.props));
  const now = Object.fromEntries(declared(after.props));
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (same(was[k], now[k])) continue;
    facts.push(now[k] === undefined || now[k] === null ? ['-', after.id, k] : ['+', after.id, k, now[k]]);
  }
  return facts.length ? facts : [['+', after.id, 'checked', true]];
}

/** A new link's facts: its ends as one value, then its own fields. */
export function linkFacts(row: Row): Fact[] {
  const facts: Fact[] = [['+', row.id, 'link', [row.type, row.from_id, row.to_id]]];
  for (const [k, v] of Object.entries(row.props ?? {})) if (v !== null && v !== undefined) facts.push(['+', row.id, k, v]);
  if (row.confidence !== 1) facts.push(['+', row.id, 'confidence', row.confidence]);
  if (row.source_id) facts.push(['+', row.id, 'source', row.source_id]);
  return facts;
}
