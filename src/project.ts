// The projection of facts onto items and links as pure code: a run of facts on one id, and what that row was, in;
// what becomes of the row, out. The server's projector (src/replay.ts) writes it into its tables; the page runs the
// same file (served as /project.js, its types stripped, src/ui-files.ts) over the rows it holds (ui/replica.js).
// It imports nothing, so it runs in a browser as it is: keep it so.

import type { Fact } from './log.ts';

type Row = Record<string, any>;

/** What the projector asks of the types: whether a status is open, and a type's kind. The registry answers; so does a backup's type table, and the page's schema. */
export interface Kinds {
  isOpen(type: string, status: string): boolean;
  type(id: string): { kind?: string | null } | undefined;
  /** The link types a closure follows from these roots: part_of and those a pack makes of it. */
  relationFamily(...roots: string[]): string[];
}

/** The types as a list of definitions (a backup's type_def rows, or the schema's types) answering what the projector asks. */
export function kindsOf(defs: { id: string; def: { kind?: string | null; statuses?: { open?: string[] } } }[]): Kinds {
  const by = new Map(defs.map((d) => [d.id, d.def]));
  return { isOpen: (type, status) => by.get(type)?.statuses?.open?.includes(status) ?? true, type: (id) => by.get(id), relationFamily: (...roots) => roots };
}

/**
 * An item's columns and the field each is in the log. Kernel defaults are not asserted: the value a field has unsaid.
 * Its kind is not one: it is read from its type, as whether it is open is, and a field named kind is a pack's own.
 */
export const ITEM_COLUMNS: [column: string, field: string, unsaid: unknown][] = [
  ['type', 'type', undefined],
  ['title', 'title', undefined],
  ['body', 'body', ''],
  ['status', 'status', undefined],
  ['visibility', 'visibility', undefined],
  ['private_to', 'private_to', null],
  ['owner', 'owner', null],
  ['confidence', 'confidence', 1],
  ['source_id', 'source', null],
];

/** How much of a note a lens answer sends (src/lens-flat.ts), and so how much a page that holds one shows. */
export const NOTE_START = 280;

/** Whether an id is a link's (r_…), whose `link` field is its ends; an item's id is e_…. */
export const isLink = (id: string) => id.startsWith('r_');

/** Entries the system writes when a pack moves a type or its kind: the items did not change, so their time does not move. */
export const MOVED = ['type.moved', 'kind.moved', 'owner.linked'];

const COLUMN = new Map(ITEM_COLUMNS.map(([column, field, unsaid]) => [field, { column, unsaid }]));
/** What the log says of an item beside its columns: they move its time only. */
const ABOUT = ['checked', 'merged_into', 'forgotten'];
const LINK_COLUMNS: Record<string, [column: string, unsaid: unknown]> = { confidence: ['confidence', 1], source: ['source_id', null] };

/** A declared field said or cleared: what is set, and what is taken away. */
function fold(props: Row, unset: Set<string>, f: Fact) {
  if (f[0] === '+') {
    props[f[2]] = f[3];
    unset.delete(f[2]);
  } else {
    delete props[f[2]];
    unset.add(f[2]);
  }
}

/** Runs of facts on one id, in the order they were said. */
export function runs(facts: Fact[]): Fact[][] {
  const out: Fact[][] = [];
  for (const f of facts) {
    const last = out.at(-1);
    if (last && last[0][1] === f[1]) last.push(f);
    else out.push([f]);
  }
  return out;
}

/** What one run of facts does to an item: nothing (not an item), forget it, make it, or set some of it. */
export type ItemStep =
  | { skip: true }
  | { forget: true }
  | { insert: Row }
  | { update: Row; props: Row; unset: string[]; archived?: boolean; is_open: boolean; mentions: boolean };

/** One run of facts on an item, folded into the columns and fields it sets. `was`: its type and status, if it is held. */
export function itemStep(reg: Kinds, at: string, id: string, run: Fact[], was?: { type: string; status: string }): ItemStep {
  if (!was && !run.some((f) => f[0] === '+' && f[2] === 'type')) return { skip: true }; // a type's definition, or another record: not an item
  if (run.some((f) => f[0] === '+' && f[2] === 'forgotten')) return { forget: true };
  const set: Row = {};
  const props: Row = {};
  const unset = new Set<string>();
  let archived: boolean | undefined;
  for (const f of run) {
    const [op, , field] = f;
    const head = COLUMN.get(field);
    if (head) set[head.column] = op === '+' ? f[3] : (head.unsaid ?? null);
    else if (field === 'archived') archived = op === '+';
    else if (ABOUT.includes(field)) continue;
    else fold(props, unset, f);
  }
  const type = (set.type ?? was?.type) as string;
  const is_open = reg.isOpen(type, (set.status ?? was?.status) as string);
  // What kind it is comes with its type, as whether it is open does with its status.
  if (set.type !== undefined) set.kind = reg.type(type)?.kind ?? null;
  if (!was) {
    const row: Row = { id, ...Object.fromEntries(ITEM_COLUMNS.map(([column, , unsaid]) => [column, unsaid ?? null])), kind: null, ...set };
    return { insert: { ...row, is_open, props, created_at: at, updated_at: at, archived_at: archived ? at : null } };
  }
  // What it names is read again when its note or fields were written.
  return { update: set, props, unset: [...unset], archived, is_open, mentions: set.body !== undefined || Object.keys(props).length > 0 || unset.size > 0 };
}

/** What one run of facts does to a link: nothing, make it, or set some of it (`moved`: its ends, its type or its end in time). */
export type LinkStep = { skip: true } | { insert: Row } | { update: Row; props: Row; unset: string[]; moved: boolean };

/** One run of facts on a link: made with its ends, moved, ended, or one of its fields set. `held`: whether the link is. */
export function linkStep(at: string, id: string, run: Fact[], held: boolean): LinkStep {
  let made = !held ? undefined : false;
  const set: Row = {};
  const props: Row = {};
  const unset = new Set<string>();
  for (const f of run) {
    const [op, , field] = f;
    if (field === 'link') {
      if (op === '-') set.valid_to = at;
      else {
        // A link said again with other ends has moved (a merge) or been retyped; it is not made again, nor brought back.
        const [type, from, to] = f[3] as [string, string, string];
        Object.assign(set, { type, from_id: from, to_id: to });
        if (made === undefined) made = true;
      }
    } else if (LINK_COLUMNS[field]) set[LINK_COLUMNS[field][0]] = op === '+' ? f[3] : LINK_COLUMNS[field][1];
    else fold(props, unset, f);
  }
  if (made === undefined) return { skip: true }; // nothing said of it is a link
  if (made) return { insert: { id, confidence: 1, source_id: null, valid_to: null, ...set, props, valid_from: at } };
  const moved = set.valid_to !== undefined || set.type !== undefined || set.from_id !== undefined || set.to_id !== undefined;
  return { update: set, props, unset: [...unset], moved };
}

/** Fields set and fields taken away, merged into what a row's props were. */
const merged = (was: Row | null | undefined, props: Row, unset: string[]) => {
  const out: Row = { ...(was ?? {}), ...props };
  for (const k of unset) delete out[k];
  return out;
};

/** Rows held in memory, by id: what the page keeps of the map (ui/replica.js), or a whole projection made again in a test. */
export interface Held {
  items: Map<string, Row>;
  links: Map<string, Row>;
}

/** What projecting facts onto held rows did: the items and links made or changed, and those that left (forgotten). */
export interface Moved {
  items: Set<string>;
  links: Set<string>;
  gone: Set<string>;
}

/**
 * Facts said at a moment, projected onto rows held in memory, as src/replay.ts projects them into its tables: the
 * same steps, applied to a Map instead of a table. moved: a pack moved a type or a kind, and the items' time stays.
 */
export function project(held: Held, reg: Kinds, at: string, facts: Fact[], moved = false, out: Moved = { items: new Set(), links: new Set(), gone: new Set() }): Moved {
  for (const run of runs(facts)) {
    const id = run[0][1];
    if (isLink(id)) {
      const was = held.links.get(id);
      const step = linkStep(at, id, run, Boolean(was));
      if ('skip' in step) continue;
      if ('insert' in step) held.links.set(id, step.insert);
      else held.links.set(id, { ...was, ...step.update, props: merged(was!.props, step.props, step.unset) });
      out.links.add(id);
      continue;
    }
    const was = held.items.get(id);
    const step = itemStep(reg, at, id, run, was as { type: string; status: string } | undefined);
    if ('skip' in step) continue;
    if ('forget' in step) {
      // Its row leaves, its links with it, and what named it as owner or source names nothing.
      held.items.delete(id);
      out.gone.add(id);
      for (const [rid, r] of held.links) {
        if (r.from_id === id || r.to_id === id) (held.links.delete(rid), out.gone.add(rid));
        else if (r.source_id === id) held.links.set(rid, { ...r, source_id: null });
      }
      for (const [iid, r] of held.items) if (r.owner === id || r.source_id === id) held.items.set(iid, { ...r, ...(r.owner === id && { owner: null }), ...(r.source_id === id && { source_id: null }) });
      continue;
    }
    if ('insert' in step) held.items.set(id, step.insert);
    else {
      const row: Row = { ...was, ...step.update, is_open: step.is_open, props: merged(was!.props, step.props, step.unset) };
      if (step.archived !== undefined) row.archived_at = step.archived ? at : null;
      if (!moved) row.updated_at = at;
      held.items.set(id, row);
    }
    out.items.add(id);
  }
  return out;
}
