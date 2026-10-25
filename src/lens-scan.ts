// What the old lens reads around an item, for the views of it a page may choose (src/region.ts reads it).

import type { Kept } from './lens-kept.ts';
import { LENS_DEFAULT, WAITS, type Lens } from './lens-read.ts';
import { stepIds } from './lens-steps.ts';
import type { Archipelago } from './pelago.ts';
import type { Around } from './region.ts';

/**
 * What a lens from an item reads around it: inside the item and where any view of it starts, down the links any of
 * them says what is inside what by; what the item waits on; near it, for a preset that goes near; and what a link any of them
 * may send ties to that.
 */
export function aroundOf(l: Archipelago, hub: string, input: Record<string, unknown>, early: Lens | undefined, kept: Kept[]): Around {
  const asked = [input, ...kept.map((one) => one.props)];
  const named = (key: string) => asked.flatMap((x) => (typeof x[key] === 'string' ? [x[key] as string] : []));
  const by = [...new Set([LENS_DEFAULT.by, ...(early ? [early.by] : named('by'))])].filter((kind) => l.registry.relations.has(kind));
  const overs = early ? [early.over] : [LENS_DEFAULT.over, WAITS, ...asked.map((x) => x.over).filter((x) => x !== undefined)];
  const over = overs.some((x) => x === 'all' || !Array.isArray(x)) ? null : l.registry.relationFamily(...new Set((overs as string[][]).flat().filter((kind) => l.registry.relations.has(kind))));
  // A view of it that goes near, among the others to choose from: what it walks to is read too.
  const nears = asked.map((x) => x.near).filter((n): n is number => typeof n === 'number');
  return {
    starts: [hub, ...named('from').filter((id) => id !== hub)],
    by: l.registry.relationFamily(...by),
    over,
    // What holds an item is a view of it a page may choose; a preset is no page.
    waits: early ? [] : l.registry.relationFamily(...WAITS),
    near: early?.near ?? (nears.length ? Math.max(...nears) : 0),
    wide: !early && nears.length > 0,
    ids: kept.flatMap((one) => stepIds(one.props.steps)),
  };
}
