// A session's name: a short word the run type declares among the values of its field `name`, minted when it starts,
// none held by another open session. Where it stands among those values picks its mark among the style's hues
// (ui/session.js), so the name is chosen to step past a hue another open session holds: two at work at once are told
// apart by name and at a glance. The words are the pack's; the colours are the style's.

import type { Archipelago } from './pelago.ts';
import { pageStyle } from './styles.ts';

/** The words a session may be named, in the order their marks take the style's hues. */
export function sessionNames(l: Archipelago): string[] {
  const values = l.registry.type('run')?.fields.name?.values;
  return Array.isArray(values) ? values : [];
}

/** How many hues the workspace's style tells things apart by. */
async function hueCount(l: Archipelago): Promise<number> {
  const hues = (await pageStyle(l, {}, false).catch(() => undefined))?.style.hues;
  return Array.isArray(hues) && hues.length ? hues.length : 1;
}

/**
 * A name for a session starting now: one no open session holds, whose hue none holds either while there is one,
 * picked at random among those so that two maps do not name their first session alike. With every word held, any.
 */
export async function mintName(l: Archipelago, pick = Math.random): Promise<string | undefined> {
  const names = sessionNames(l);
  if (!names.length) return undefined;
  const { rows } = await l.db.query<{ name: string }>(
    `select props->>'name' as name from entity where type = any($1::text[]) and is_open and archived_at is null and props ? 'name'`,
    [l.registry.family('run')],
  );
  const held = rows.map((r) => r.name);
  const hues = await hueCount(l);
  const heldHues = new Set(held.map((n) => names.indexOf(n)).filter((i) => i >= 0).map((i) => i % hues));
  const free = names.filter((n) => !held.includes(n));
  const apart = free.filter((n) => !heldHues.has(names.indexOf(n) % hues));
  const from = apart.length ? apart : free.length ? free : names;
  return from[Math.floor(pick() * from.length)];
}
