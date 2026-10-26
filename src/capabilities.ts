// Capabilities: what the kernel computes from a type, declared by the type with the field each reads. There are
// six and packs cannot add a seventh. A flavour inherits its parent's; a sibling does not. Each is checked against
// the type's own fields when its pack loads, so a capability naming a field the type lacks stops the pack.

import type { FieldDef } from './packs.ts';

/** A field against a limit: a deadline is a bound on a date ({ field: 'due', limit: 'today' }), a reorder level one on a quantity ({ field: 'on_hand', below: 'reorder_at' }). */
export interface Bound {
  field: string;
  limit?: 'today';
  below?: string;
}

/** The days a thing repeats on, and the hours it holds on each: the fields that say so. */
export interface Repeat {
  from: string;
  to: string;
  days?: string;
  starts?: string;
  until?: string;
  skip?: string;
  moved?: string;
  /** Days that happened and were recorded on their own: no longer drawn from the repeat. */
  done?: string;
}

/** Happens at a time: a moment (at), a span (start and end), or a repeat. */
export interface When {
  at?: string;
  start?: string;
  end?: string;
  repeat?: Repeat;
}

/**
 * Is somewhere: by a field (an address, a name) or by a link to a place. A place says what it is known by instead:
 * an address (a remote, a URL) and a folder on a machine, the keys a session finds it by (src/places.ts).
 */
export interface Where {
  field?: string;
  link?: string;
  address?: string;
  folder?: string;
}

/** How many at once: a number field, a boolean field (true for one, false for any number), or a fixed number. */
export type Capacity = number | { field: string };

/**
 * A question settled by someone's word or by evidence, whose word it is, the field that lists the choices weighed,
 * the field that says which was chosen, the field that says why and the day field it was settled on: so a page settles
 * it by picking one (Rule 11).
 */
export interface Settles {
  by: 'word' | 'evidence';
  whose?: 'owner' | 'waits_on';
  choices?: string;
  chosen?: string;
  why?: string;
  on?: string;
}

/**
 * Its health is watched from outside: a monitor reports on the address in `field`, and the item's status follows,
 * to `down` when it fails and back to `up` when it answers. Only while its status is `up`, `down` or one of `also`:
 * a part still being built is left alone. A deploy reports a part live at a commit (up, the commit kept in
 * `commit`), or stopped on purpose (`idle`, where monitors leave it alone too).
 */
export interface Watch {
  field: string;
  up: string;
  down: string;
  also?: string[];
  idle?: string;
  commit?: string;
}

/**
 * Each item of this type accounts for one commit of a repository: the field holds the commit's full id. An item
 * whose boolean field `accounted` (when named) is false was only heard of, from a push: it accounts for nothing yet.
 */
export interface Accounts {
  field: string;
  accounted?: string;
}

export interface Capabilities {
  bound?: Bound;
  when?: When;
  where?: Where;
  capacity?: Capacity;
  settles?: Settles;
  watch?: Watch;
  accounts?: Accounts;
}

export const CAPABILITIES = ['bound', 'when', 'where', 'capacity', 'settles', 'watch', 'accounts'] as const;

const DATES = ['date', 'datetime'];

/** Problems with a type's capabilities, given its resolved fields, statuses and the relations known. Empty means they hold. */
export function checkCapabilities(caps: Capabilities, fields: Record<string, FieldDef>, relations: Set<string>, statuses: string[] = []): string[] {
  const problems: string[] = [];
  const has = (what: string, field: string | undefined, types: string[]) => {
    if (field === undefined) return;
    const def = fields[field];
    if (!def) problems.push(`${what} reads "${field}", which it has no field of`);
    else if (!types.includes(def.type)) problems.push(`${what} reads "${field}", a ${def.type}, not a ${types.join(' or ')}`);
  };
  for (const name of Object.keys(caps)) if (!(CAPABILITIES as readonly string[]).includes(name)) problems.push(`"${name}" is not a capability: one of ${CAPABILITIES.join(', ')}`);
  const { bound, when, where, capacity, settles, watch, accounts } = caps;
  if (bound) {
    if (!bound.field) problems.push('bound needs a field');
    if (bound.limit !== undefined && bound.below !== undefined) problems.push('bound has a limit or a field it stays above, not both');
    if (bound.limit !== undefined && bound.limit !== 'today') problems.push('bound.limit can only be "today"');
    has('bound', bound.field, bound.below !== undefined ? ['number'] : DATES);
    has('bound.below', bound.below, ['number']);
  }
  if (when) {
    if (!when.at && !when.start && !when.repeat) problems.push('when needs at, start or repeat');
    has('when.at', when.at, DATES);
    has('when.start', when.start, DATES);
    has('when.end', when.end, DATES);
    if (when.repeat) {
      const r = when.repeat;
      for (const key of ['from', 'to'] as const) if (!r[key]) problems.push(`when.repeat needs ${key}`);
      for (const key of ['from', 'to'] as const) has(`when.repeat.${key}`, r[key], ['string']);
      for (const key of ['starts', 'until'] as const) has(`when.repeat.${key}`, r[key], ['date']);
      for (const key of ['days', 'skip', 'moved', 'done'] as const) has(`when.repeat.${key}`, r[key], ['json']);
    }
  }
  if (where) {
    const known = Boolean(where.address || where.folder);
    if (where.field && where.link) problems.push('where reads a field or a link, one of them');
    if (!where.field && !where.link && !known) problems.push('where reads a field or a link, or names the address or folder a place is known by');
    if (known && (where.field || where.link)) problems.push('a place is known by its address or folder; where it is itself is another thing');
    has('where', where.field, ['string', 'json']);
    has('where.address', where.address, ['string', 'url']);
    has('where.folder', where.folder, ['string']);
    if (where.link && !relations.has(where.link)) problems.push(`where follows "${where.link}", which is no relation`);
  }
  if (capacity !== undefined) {
    if (typeof capacity === 'number') {
      if (!Number.isInteger(capacity) || capacity < 1) problems.push('capacity is a whole number, one or more');
    } else has('capacity', capacity.field, ['number', 'boolean']);
  }
  if (settles) {
    if (!['word', 'evidence'].includes(settles.by)) problems.push('settles.by is "word" or "evidence"');
    if (settles.whose !== undefined && !['owner', 'waits_on'].includes(settles.whose)) problems.push('settles.whose is "owner" or "waits_on"');
    has('settles.choices', settles.choices, ['json']);
    has('settles.chosen', settles.chosen, ['string']);
    has('settles.why', settles.why, ['string']);
    has('settles.on', settles.on, ['date']);
    if (settles.chosen && !settles.choices) problems.push('settles.chosen says which of the choices was chosen: name the choices too');
  }
  if (watch) {
    if (!watch.field) problems.push('watch needs the field its address is in');
    has('watch', watch.field, ['url', 'string']);
    for (const s of [watch.up, watch.down, ...(watch.also ?? []), ...(watch.idle ? [watch.idle] : [])]) if (!statuses.includes(s)) problems.push(`watch names "${s}", which is no status of it`);
    has('watch.commit', watch.commit, ['string']);
  }
  if (accounts) has('accounts', accounts.field, ['string']);
  if (accounts?.accounted) has('accounts.accounted', accounts.accounted, ['boolean']);
  return problems;
}

/** How many may hold one item at once: a number, Infinity for any number, or undefined when it cannot be held. */
export function capacityOf(caps: Capabilities | undefined, props: Record<string, unknown>): number | undefined {
  const capacity = caps?.capacity;
  if (capacity === undefined) return undefined;
  if (typeof capacity === 'number') return capacity;
  const value = props[capacity.field];
  if (typeof value === 'number') return value;
  return value === false ? Infinity : 1;
}

/** Hours since midnight from a time of day: 17.5 from "17:30"; undefined for anything else. */
const clockHours = (t: unknown) => {
  const m = typeof t === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(t.trim()) : null;
  const n = m ? Number(m[1]) + Number(m[2]) / 60 : NaN;
  return n >= 0 && n <= 24 ? n : undefined;
};

/**
 * The hours a repeating thing holds on a day, if it falls on it: not before it starts or after it ends, not on a
 * day skipped or done. `made` is the day it was made, the start when it names none.
 */
export function occurs(repeat: Repeat, p: Record<string, unknown>, day: string, made?: string): [number, number] | undefined {
  const list = (key: string | undefined) => (key && Array.isArray(p[key]) ? (p[key] as unknown[]) : undefined);
  const days = list(repeat.days)?.length ? list(repeat.days)!.map(Number) : [1, 2, 3, 4, 5, 6, 7];
  if (!days.includes(new Date(`${day}T12:00:00Z`).getUTCDay() || 7)) return undefined;
  const text = (key: string | undefined) => (key && typeof p[key] === 'string' ? (p[key] as string) : undefined);
  const starts = text(repeat.starts) ?? made;
  const until = text(repeat.until);
  if ((starts && day < starts) || (until && day > until)) return undefined;
  if (list(repeat.skip)?.includes(day) || list(repeat.done)?.includes(day)) return undefined;
  const all = repeat.moved ? p[repeat.moved] : undefined;
  const moved = all && typeof all === 'object' ? (all as Record<string, unknown>)[day] : undefined;
  const [a, b] = Array.isArray(moved) ? moved.map(clockHours) : [clockHours(p[repeat.from]), clockHours(p[repeat.to])];
  return a !== undefined && b !== undefined && b > a ? [a, b] : undefined;
}
