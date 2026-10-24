// What a lens is, and how one is read from what is asked: the fields a lens has, the built-in one, and each field
// checked. src/lens.ts answers a lens; this is only how it is read.

import type { Archipelago } from './pelago.ts';
import { readAxis, type TimeAxis } from './timeaxis.ts';

export interface Lens {
  /** Where it starts: one item. Without it, the whole map. */
  from?: string;
  /** Or the story a session told (a run): what its standing beats are about, with the ties it drew. */
  story?: string;
  /** With story: one beat only (its number), as its finding is drawn. */
  beat?: number;
  /** Which types are in it: a type (flavours included) or "work"; with a leading "-", left out. */
  kinds?: string[];
  /** The one kind of link that says what is inside what. */
  by: string;
  /** The kinds of link sent along as links, or "all". */
  over: string[] | 'all';
  /** How many steps down from the start, or from what is inside nothing. */
  far?: number;
  /** In place of what is inside it: what the start is tied to, this many steps along the links sent, either way. */
  near?: number;
  /** What each item is filed under: its stage of work, its link to the start, its owner, or the value of one of its fields (field:<name>). */
  lanes?: 'stage' | 'link' | 'person' | `field:${string}`;
  /** The number field that orders the things beside each other. */
  order: string;
  /** What size counts. */
  measure: 'work' | 'tokens';
  /** What is left out until asked for. */
  fold: string[];
  /** A time axis: only what falls in the window, each item with where (time). */
  time?: TimeAxis;
}

/** The kinds of link that say one thing cannot move until another has. */
export const WAITS = ['depends_on', 'waits_on', 'needs'];

export const LENS_DEFAULT: Lens = { by: 'part_of', over: ['depends_on', 'waits_on'], order: 'order', measure: 'work', fold: ['closed', 'system', 'unlinked'] };
/** The fields a lens kept on the map may name: all but where it starts, which is what it is about. */
export const LENS_KEPT = { kinds: 1, by: 1, over: 1, far: 1, near: 1, lanes: 1, order: 1, measure: 1, fold: 1, time: 1 };
const FOLDS = ['closed', 'system', 'unlinked'];
const LANES = ['stage', 'link', 'person'];

/** The lens asked for, over the built-in one: a field that is named replaces it whole. */
export function readLens(l: Archipelago, input: Record<string, unknown>, under: Lens = LENS_DEFAULT): Lens {
  const lens: Lens = { ...under };
  const known = (kind: unknown, field: string) => {
    if (typeof kind !== 'string' || !l.registry.relations.has(kind)) throw new Error(`${field}: unknown kind of link "${kind}". Known: ${[...l.registry.relations.keys()].join(', ')}`);
    return kind;
  };
  const list = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`${field} must be a list of names`);
    return value as string[];
  };
  if (input.from !== undefined) lens.from = String(input.from);
  if (input.story !== undefined) lens.story = String(input.story);
  if (input.beat !== undefined) {
    if (!Number.isInteger(input.beat) || (input.beat as number) < 1) throw new Error('beat must be the number of a beat, from 1');
    lens.beat = input.beat as number;
  }
  if (input.kinds !== undefined) lens.kinds = list(input.kinds, 'kinds');
  if (input.by !== undefined) lens.by = known(input.by, 'by');
  if (input.over !== undefined) lens.over = input.over === 'all' ? 'all' : list(input.over, 'over').map((kind) => known(kind, 'over'));
  if (input.far !== undefined) {
    if (!Number.isInteger(input.far) || (input.far as number) < 0 || (input.far as number) > 12) throw new Error('far must be a whole number from 0 to 12');
    lens.far = input.far as number;
  }
  if (input.near !== undefined) {
    if (!Number.isInteger(input.near) || (input.near as number) < 1 || (input.near as number) > 4) throw new Error('near must be a whole number from 1 to 4');
    lens.near = input.near as number;
  }
  if (input.lanes !== undefined) {
    const lanes = String(input.lanes);
    const field = /^field:([a-z][a-z0-9_]*)$/.exec(lanes)?.[1];
    if (field !== undefined && ![...l.registry.types.values()].some((t) => t.fields[field])) throw new Error(`lanes: no type has a field "${field}"`);
    if (field === undefined && !LANES.includes(lanes)) throw new Error(`lanes must be one of: ${LANES.join(', ')}, or field:<name>`);
    lens.lanes = lanes as Lens['lanes'];
  }
  if (input.order !== undefined) lens.order = String(input.order);
  if (input.measure !== undefined) {
    if (input.measure !== 'work' && input.measure !== 'tokens') throw new Error('measure must be one of: work, tokens');
    lens.measure = input.measure;
  }
  if (input.time !== undefined) lens.time = readAxis(input.time);
  if (input.fold !== undefined) {
    lens.fold = list(input.fold, 'fold');
    const unknown = lens.fold.filter((f) => !FOLDS.includes(f));
    if (unknown.length) throw new Error(`fold must be of: ${FOLDS.join(', ')}; not ${unknown.join(', ')}`);
  }
  return lens;
}
