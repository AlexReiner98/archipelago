// What changed, as an agent is given it: how many of each kind, and the newest few, never the whole list. An agent
// reads what it is handed into its context; a list of every event since a moment grows with the map and says little
// that the counts do not. The list itself is one call away (events, or full: true).

/** How many of the newest an agent is given whole. */
export const NEWEST = 5;

/** Counts by a key, the most first. */
export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
}

/**
 * Items newest last (as they happened), summed up: their count by a key, the newest few in the order they came, and
 * how many were left out. Few enough, they are given whole and nothing is counted.
 */
export function summed<T>(items: T[], key: (item: T) => string, newest = NEWEST): { counts?: Record<string, number>; newest: T[]; more?: number } {
  if (items.length <= newest) return { newest: items };
  return { counts: countBy(items, key), newest: items.slice(-newest), more: items.length - newest };
}
