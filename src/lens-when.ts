// "When": the view every item with dated things in it has. What is inside it, placed in time (a week at a time, the
// page moves it), filed by who it is: each person a lane, and the sessions that worked on it a lane of their own.
// Drawn as a calendar. Also "in": what is inside an item, asked for by name when other views are offered beside it.

import type { Archipelago } from './pelago.ts';
import { spansOf, type TimeAxis } from './timeaxis.ts';

export const WHEN = 'when';
/** What is inside an item, by name: the picture an item with no view of its own opens on when nothing holds it. */
export const IN = 'in';
/** The lane the sessions on an item's work are filed in. */
export const SESSIONS = 'sessions';

const DAY = 86_400_000;
/** How far either side of today a dated thing counts toward offering the view. */
const NEAR = 365 * DAY;

interface Row {
  id: string;
  type: string;
  title: string;
  status: string;
  is_open: boolean;
  owner: string | null;
  props: Record<string, unknown>;
  created_at: Date;
}

/** Today as a date in a zone. */
const dayIn = (at: number, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The week that holds today, Monday to Sunday, as dates in the workspace's zone. */
export function thisWeek(zone: string, now = Date.now()): TimeAxis {
  const today = dayIn(now, zone);
  const back = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = Date.parse(`${today}T12:00:00Z`) - back * DAY;
  return { from: new Date(monday).toISOString().slice(0, 10), to: new Date(monday + 6 * DAY).toISOString().slice(0, 10) };
}

/**
 * Whether anything inside an item has a place in time near today: a date of its own (when or bound), or a session
 * at work on it now. Inside is down the links that say what is inside what (`by`).
 */
export function dated(l: Archipelago, hub: string, by: string, entities: Row[], relations: { type: string; from_id: string; to_id: string }[], zone: string): boolean {
  const root = (type: string) => l.registry.relations.get(type)?.root ?? type;
  const kids = new Map<string, string[]>();
  for (const r of relations) if (root(r.type) === by) kids.set(r.to_id, [...(kids.get(r.to_id) ?? []), r.from_id]);
  const inside = new Set<string>();
  for (const queue = [hub]; queue.length; ) for (const kid of kids.get(queue.pop()!) ?? []) if (!inside.has(kid)) (inside.add(kid), queue.push(kid));
  if (relations.some((r) => r.type === 'sys.works_on' && (inside.has(r.to_id) || r.to_id === hub))) return true;
  const axis = { from: dayIn(Date.now() - NEAR, zone), to: dayIn(Date.now() + NEAR, zone) };
  return entities.some((e) => inside.has(e.id) && spansOf(l, e, axis, zone).length > 0);
}

/** The lanes of a picture filed by person, each with a name: people by name, then what no one holds, then the sessions. */
export function personLanes(keys: (string | null)[], all: Map<string, { title: string }>) {
  const present = new Set(keys);
  const people = [...present].filter((k): k is string => k !== null && k !== SESSIONS).sort((a, b) => (all.get(a)?.title ?? a).localeCompare(all.get(b)?.title ?? b));
  return [
    ...people.map((key) => ({ key, title: all.get(key)?.title ?? 'Someone' })),
    ...(present.has(null) ? [{ key: null, title: 'No one' }] : []),
    ...(present.has(SESSIONS) ? [{ key: SESSIONS, title: 'Sessions' }] : []),
  ];
}
