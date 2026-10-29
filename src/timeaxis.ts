// A time axis for lenses: where each item falls in a window of time, read from its when (a moment, a span or a
// repeat, worked out into its occurrences) and its bound (a deadline). At any scale: the window is days or years, and
// how it is drawn is the style's. A session falls where it ran. A date is a whole day in the workspace's time zone.

import { occurs } from './capabilities.ts';
import { runSpans } from './sessiontime.ts';
import type { Archipelago } from './pelago.ts';

/** A lens's time axis: the window, and what places an item in it. */
export interface TimeAxis {
  from: string;
  to: string;
  /** when, bound, or both (the default). */
  by?: ('when' | 'bound')[];
}

export interface Span {
  start: string;
  end: string;
  /** What placed it: when, bound, or a repeat's day. */
  by: 'when' | 'bound' | 'repeat';
  /** For a session: the work it was on then, or the place it ran in (src/sessiontime.ts). */
  on?: string | null;
}

interface Placed {
  id: string;
  type: string;
  status: string;
  is_open: boolean;
  props: Record<string, unknown>;
  created_at: Date;
}

const DAY = 86_400_000;
/** The most days a window may cover when repeats are worked out. */
const MAX_DAYS = 366 * 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A day said from today: today, or so many days before or after it (-6d, 7d). */
const FROM_TODAY = /^(today|[+-]?\d{1,4}d)$/;

/** Read and check a lens's time axis. Its ends may be said from today, worked out by `resolveAxis` when it is read. */
export function readAxis(input: unknown): TimeAxis {
  const t = input as Partial<TimeAxis> | undefined;
  const ok = (d: unknown) => typeof d === 'string' && (FROM_TODAY.test(d) || !Number.isNaN(Date.parse(d)));
  if (!t || !ok(t.from) || !ok(t.to)) throw new Error('time is { from, to } (dates, date-times, today, or days from today as -6d or 7d), and by: ["when", "bound"] if not both');
  const fixed = !FROM_TODAY.test(t.from!) && !FROM_TODAY.test(t.to!);
  if (fixed && Date.parse(t.to!) < Date.parse(t.from!)) throw new Error('time.to comes after time.from');
  if (t.by !== undefined && (!Array.isArray(t.by) || t.by.some((b) => b !== 'when' && b !== 'bound'))) throw new Error('time.by is a list of when and bound');
  return { from: t.from!, to: t.to!, ...(t.by && { by: t.by }) };
}

/** The day an end said from today falls on, in a zone, as a date; any other end as it is. */
function dayFrom(value: string, zone: string, now: number): string {
  const said = FROM_TODAY.exec(value);
  if (!said) return value;
  const parts = Object.fromEntries(clock(zone).formatToParts(now).map((p) => [p.type, p.value]));
  const today = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  return new Date(today + (said[1] === 'today' ? 0 : parseInt(said[1], 10)) * DAY).toISOString().slice(0, 10);
}

/** A time axis with its ends said from today worked out, in the workspace's zone. */
export function resolveAxis(axis: TimeAxis, zone: string, now = Date.now()): TimeAxis {
  const resolved = { ...axis, from: dayFrom(axis.from, zone, now), to: dayFrom(axis.to, zone, now) };
  if (Date.parse(resolved.to) < Date.parse(resolved.from)) throw new Error('time.to comes after time.from');
  return resolved;
}

/** One clock for each zone: making one is slow, and every item placed in time asks it. */
const clocks = new Map<string, Intl.DateTimeFormat>();
const clock = (zone: string) => clocks.get(zone) ?? clocks.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })).get(zone)!;

/** Milliseconds from UTC at an instant in a time zone: -4 h in Toronto in summer. */
function offset(zone: string, at: number): number {
  const parts = Object.fromEntries(clock(zone).formatToParts(at).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(at / 1000) * 1000;
}

/** The instant a day begins in a zone. */
export function dayStart(day: string, zone: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  return guess - offset(zone, guess - offset(zone, guess));
}

/** A field's value as an instant: a date-time as it is, a date as the start of its day. */
const instant = (value: unknown, zone: string): number | undefined =>
  typeof value !== 'string' ? undefined : DATE.test(value) ? dayStart(value, zone) : Number.isNaN(Date.parse(value)) ? undefined : Date.parse(value);

/** The window as instants: from its first moment to the end of its last day (or its last moment, given a date-time). */
export const windowOf = (axis: TimeAxis, zone: string): [number, number] => [instant(axis.from, zone)!, (instant(axis.to, zone) ?? 0) + (DATE.test(axis.to) ? DAY : 0)];

/** Where one item falls in the window, given its type's capabilities. Empty when it does not. A session is placed apart, where it was at work (runSpans). */
export function spansOf(l: Archipelago, e: Placed, axis: TimeAxis, zone: string): Span[] {
  const caps = l.registry.type(e.type)?.capabilities ?? {};
  const [from, to] = windowOf(axis, zone);
  const by = axis.by ?? ['when', 'bound'];
  const out: Span[] = [];
  const add = (start: number, end: number, kind: Span['by']) => {
    if (end >= from && start < to) out.push({ start: new Date(start).toISOString(), end: new Date(Math.max(end, start)).toISOString(), by: kind });
  };
  const wholeDay = (field: string | undefined) => (field !== undefined && typeof e.props[field] === 'string' && DATE.test(e.props[field] as string) ? DAY : 0);
  const when = caps.when;
  if (when && by.includes('when')) {
    if (when.repeat) {
      const made = new Date(e.created_at).toISOString().slice(0, 10);
      const days = Math.min(Math.ceil((to - from) / DAY) + 1, MAX_DAYS);
      for (let i = 0; i < days; i++) {
        const day = new Date(from + i * DAY + DAY / 2).toISOString().slice(0, 10);
        const hours = occurs(when.repeat, e.props, day, made);
        if (hours) add(dayStart(day, zone) + hours[0] * 3_600_000, dayStart(day, zone) + hours[1] * 3_600_000, 'repeat');
      }
    } else {
      const start = instant(e.props[when.start ?? when.at ?? ''], zone) ?? instant(e.props[when.at ?? ''], zone);
      const end = instant(e.props[when.end ?? ''], zone);
      if (start !== undefined) add(start, end ?? start + wholeDay(when.start ?? when.at), 'when');
    }
  }
  const bound = caps.bound;
  if (bound?.limit && by.includes('bound')) {
    const at = instant(e.props[bound.field], zone);
    if (at !== undefined) add(at, at + wholeDay(bound.field), 'bound');
  }
  return out;
}

/** Where each item falls in the window; a session where it was at work, each stretch with what it was on. */
export async function placeAll(l: Archipelago, items: (Placed & { updated_at?: Date })[], axis: TimeAxis, zone: string): Promise<Map<string, Span[]>> {
  const placed = new Map(items.map((e) => [e.id, spansOf(l, e, axis, zone)]));
  if ((axis.by ?? ['when']).includes('when')) for (const [id, found] of await runSpans(l, items.filter((e) => l.registry.isA(e.type, 'run')), ...windowOf(axis, zone))) placed.set(id, found);
  return placed;
}

export const DEFAULT_ZONE = 'America/Toronto';

/** The time zone days are counted in: the workspace's, or Toronto's as the time pack always has. */
export async function zoneOf(l: Archipelago): Promise<string> {
  return (await l.setting<string>('time_zone')) || DEFAULT_ZONE;
}

/** The lane the agents' sessions are filed in: each at work at once drawn beside the others in it. */
export const AGENTS = 'agents';

/**
 * The lanes of what is placed on a time axis, each item filed by who it is for: the person who holds it, what no one
 * holds the workspace owner's (`me`: it is their calendar), and the sessions the agents' lane. People by name, then
 * what no one holds when there is no owner to give it to, then the agents.
 */
export async function lanesOf(l: Archipelago, items: { id: string; type: string; owner: string | null }[], me: string | null) {
  const lane = new Map(items.map((e) => [e.id, l.registry.isA(e.type, 'run') ? AGENTS : (e.owner ?? me)]));
  const present = new Set(lane.values());
  const people = [...present].filter((k): k is string => k !== null && k !== AGENTS);
  const { rows } = await l.db.query<{ id: string; title: string }>('select id, title from entity where id = any($1::text[])', [people]);
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  const lanes = [
    ...people.map((key) => ({ key, title: titles.get(key) ?? 'Someone' })).sort((a, b) => a.title.localeCompare(b.title)),
    ...(present.has(null) ? [{ key: null, title: 'No one' }] : []),
    ...(present.has(AGENTS) ? [{ key: AGENTS, title: 'Agents' }] : []),
  ];
  return { lane, lanes };
}
