// Capabilities: what the kernel computes from a type, declared by the type with the field each reads. The kernel
// knows the ones listed in CAPABILITIES; a pack adds another by providing its behaviour as the service
// `capability.<name>` (packs/loader/kernel/services.ts), and a type may then carry it where its pack provides or requires that name.
// A flavour inherits its parent's; a sibling does not. Each the kernel knows is checked against the type's own fields
// when its pack loads, so a capability naming a field the type lacks stops the pack; one a pack provides is checked by
// its provider. The check of the list stays here; what each one does moves to its provider.

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
  /** When it ends on each day; without it, each occurrence is a moment (a reminder at 08:00). */
  to?: string;
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
 * an address (a remote, a URL) and a folder on a machine, the keys a session finds it by (packs/runs/kernel/places.ts).
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
 * A promise to whatever reads it (a link of a type that crosses, as core's reads): these fields are kept current,
 * and when one moves after a reader last changed or checked itself, attention says so on the reader (packs/attention/kernel/moved.ts).
 */
export interface Promised {
  fields: string[];
  /** A boolean field the item stands by itself with: only one it marks true is read from another island. Left out, every one is. */
  published?: string;
}

/** It lives with what it is about (packs/placement/kernel/subject.ts): made with a link of this type to its subject, on its island and as visible as it. */
export interface Subject {
  link: string;
}

export interface Capabilities {
  subject?: Subject;
  bound?: Bound;
  when?: When;
  where?: Where;
  capacity?: Capacity;
  settles?: Settles;
  watch?: Watch;
  promised?: Promised;
  /** Someone answers for it: it has an owner, kept in its row (packs/loader/kernel/head.ts, ownHead). */
  owned?: true;
  /** Something to do or answer: what attention counts as ready, holding up or unowned. */
  actionable?: true;
  /** Work to be planned and done, not a question to answer: what is estimated, rolled up and published as a product. */
  plannable?: true;
  /** The kernel's own (views, styles, runs, rules): what views of the work leave out. Only a kernel pack's types carry it. */
  kernel?: true;
}

export const CAPABILITIES = ['bound', 'when', 'where', 'capacity', 'settles', 'watch', 'promised', 'owned', 'actionable', 'plannable', 'kernel', 'subject'] as const;

const DATES = ['date', 'datetime'];

/**
 * Problems with a type's capabilities, given its resolved fields, statuses and the relations known, and the
 * capabilities its pack has opened (provided or required as `capability.<name>`). Empty means they hold.
 */
export function checkCapabilities(caps: Capabilities, fields: Record<string, FieldDef>, relations: Set<string>, statuses: string[] = [], opened: readonly string[] = []): string[] {
  const problems: string[] = [];
  const has = (what: string, field: string | undefined, types: string[]) => {
    if (field === undefined) return;
    const def = fields[field];
    if (!def) problems.push(`${what} reads "${field}", which it has no field of`);
    else if (!types.includes(def.type)) problems.push(`${what} reads "${field}", a ${def.type}, not a ${types.join(' or ')}`);
  };
  for (const name of Object.keys(caps)) if (!(CAPABILITIES as readonly string[]).includes(name) && !opened.includes(name)) problems.push(`"${name}" is not a capability: one of ${CAPABILITIES.join(', ')}, or one its pack provides or requires as service:capability.<name>`);
  const { bound, when, where, capacity, settles, watch, promised } = caps;
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
      if (!r.from) problems.push('when.repeat needs from');
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
  for (const flag of ['owned', 'actionable', 'plannable', 'kernel'] as const) if (caps[flag] !== undefined && caps[flag] !== true) problems.push(`${flag} is true, or left out`);
  if (caps.subject && !relations.has(caps.subject.link)) problems.push(`subject is linked by "${caps.subject.link}", which is no relation`);
  if (promised) {
    if (!Array.isArray(promised.fields) || !promised.fields.length) problems.push('promised names the fields its readers rely on');
    else for (const f of promised.fields) if (!fields[f]) problems.push(`promised reads "${f}", which it has no field of`);
    if (promised.published !== undefined && fields[promised.published]?.type !== 'boolean') problems.push(`promised marks what is published by "${promised.published}", which is no boolean field of it`);
  }
  return problems;
}

/** How many may hold one item at once: a number, Infinity for any number, or undefined when it cannot be held (a place that says nothing of it is no resource). */
export function capacityOf(caps: Capabilities | undefined, props: Record<string, unknown>): number | undefined {
  const capacity = caps?.capacity;
  if (capacity === undefined) return undefined;
  if (typeof capacity === 'number') return capacity;
  const value = props[capacity.field];
  if (typeof value === 'number') return value;
  return value === false ? Infinity : value === undefined ? undefined : 1;
}

/** Hours since midnight from a time of day: 17.5 from "17:30"; undefined for anything else. */
const clockHours = (t: unknown) => {
  const m = typeof t === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(t.trim()) : null;
  const n = m ? Number(m[1]) + Number(m[2]) / 60 : NaN;
  return n >= 0 && n <= 24 ? n : undefined;
};

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/** A day of the week as 1 (Monday) to 7: a number, or a name or its first three letters ("mon"). */
const dayNumber = (d: unknown) => (typeof d === 'string' && d.trim().length >= 3 && !/^\d+$/.test(d.trim()) ? DAY_NAMES.findIndex((n) => n.startsWith(d.trim().toLowerCase())) + 1 : Number(d));

/**
 * The hours a repeating thing holds on a day, if it falls on it: not before it starts or after it ends, not on a
 * day skipped or done. `made` is the day it was made, the start when it names none.
 */
export function occurs(repeat: Repeat, p: Record<string, unknown>, day: string, made?: string): [number, number] | undefined {
  const list = (key: string | undefined) => (key && Array.isArray(p[key]) ? (p[key] as unknown[]) : undefined);
  const days = list(repeat.days)?.length ? list(repeat.days)!.map(dayNumber) : [1, 2, 3, 4, 5, 6, 7];
  if (!days.includes(new Date(`${day}T12:00:00Z`).getUTCDay() || 7)) return undefined;
  const text = (key: string | undefined) => (key && typeof p[key] === 'string' ? (p[key] as string) : undefined);
  const starts = text(repeat.starts) ?? made;
  const until = text(repeat.until);
  if ((starts && day < starts) || (until && day > until)) return undefined;
  if (list(repeat.skip)?.includes(day) || list(repeat.done)?.includes(day)) return undefined;
  const all = repeat.moved ? p[repeat.moved] : undefined;
  const moved = all && typeof all === 'object' ? (all as Record<string, unknown>)[day] : undefined;
  const [a, b] = Array.isArray(moved) ? moved.map(clockHours) : [clockHours(p[repeat.from]), repeat.to === undefined ? clockHours(p[repeat.from]) : clockHours(p[repeat.to])];
  // A repeat with no end is a moment each day it falls on; one with an end holds from one hour to a later one.
  return a !== undefined && b !== undefined && (b > a || (repeat.to === undefined && b === a)) ? [a, b] : undefined;
}
