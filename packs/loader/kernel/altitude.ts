// Altitude: how high an item sits in the hierarchy, read from its type (docs/ui-strategy.md). A page lists the level
// below it and says deeper ones as counts, so a project is never shown beside a task. Packs declare it on a type or
// a kind; a flavour inherits it.

/** The levels, highest first. */
export const ALTITUDES = ['workspace', 'project', 'stream', 'step'] as const;
export type Altitude = (typeof ALTITUDES)[number];

/** The altitude a type declares, checked: a pack that names another level stops the server, as a bad field does. */
export function altitudeOf(type: string, value: unknown): Altitude {
  if (!ALTITUDES.includes(value as Altitude)) throw new Error(`Type "${type}" has altitude "${String(value)}": it must be one of ${ALTITUDES.join(', ')}`);
  return value as Altitude;
}
