// The page's address for what an agent asks to show or to look at: a kept view (a lens item, a saved canvas), a
// lens and style of its own, an item's page or a screen. The page reads the same address (ui/lens.js, readFlatLens),
// so what an agent names is drawn as the owner would draw it. A lens the canvas could not draw is refused here.

import { z } from 'zod';
import { readFlat } from './lens-flat.ts';
import type { Archipelago } from './pelago.ts';

/** What names a view, as show and query look take it. */
export const VIEW_INPUT = {
  entity: z.string().optional().describe('An item id: its page; a view kept on the map (type lens, a saved canvas) is drawn as the canvas it is, its lens in the query bar.'),
  lens: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('What the canvas draws: a flat lens, as query flat takes it ({ filter: { text, types, ids, links, in, only, within, exclude }, walk: { over, steps }, limit }), shown in the query bar as if written there. With entity, under that item\'s page. {} is the canvas as it opens.'),
  style: z
    .object({
      lit: z.enum(['all', 'you', 'blocked']).optional().describe('What stays lit: everything, only what waits on the person looking, or only what is blocked.'),
      shape: z.enum(['list', 'flow', 'grid', 'time', 'architecture']).optional().describe('One of the built-in drawings. list: each thing one line, what holds others a box that folds. flow: a process map, top down, wires at right angles. grid: rows by what the start holds, columns by lane, each thing a card. time: along the lens\x27s time axis, a calendar or bars. architecture: a system, each part a box inside a box for where it runs, wires down to what it calls, each part and wire marked with its health.'),
      id: z.string().optional().describe('A style kept on the map (an item of type style), drawn with for this one look.'),
    })
    .optional()
    .describe('How the view is drawn, for this one look. The style a view opens in is kept on the map: an item of type style, about the project or item it is for, or about nothing for the whole workspace; change it with change.'),
};

export interface ViewAsked {
  entity?: string;
  screen?: string;
  lens?: Record<string, unknown>;
  style?: { lit?: string; shape?: string; id?: string };
}

/** The page's address (after "#/") for what is asked. */
export async function viewAddress(l: Archipelago, input: ViewAsked): Promise<string> {
  // A saved canvas is opened as what the canvas draws: the page reads its lens and style from the map.
  const kept = input.entity && (await l.entity(input.entity));
  if (input.entity && !kept) throw new Error(`No item "${input.entity}"`);
  if (kept && !input.lens && !input.style && l.registry.isA(kept.type, 'lens')) return `v?canvas=${input.entity}`;
  if (input.lens || input.style) {
    // Read as the flat lens reads it, so a lens the canvas could not draw is refused here and not on a screen.
    const asked = (input.lens ?? {}) as { filter?: { exclude?: unknown }; limit?: unknown };
    const lens = Object.keys(asked).length ? readFlat(l, asked) : undefined;
    for (const id of [...(lens?.include.ids ?? []), ...(lens?.include.in ?? [])]) if (!(await l.entity(id))) throw new Error(`No item "${id}"`);
    // The address says the lens as the page reads it: each term of the filter, the walk, the limit.
    const query = new URLSearchParams();
    if (lens) {
      const { text, types, ids, links, in: inside } = lens.include;
      const walked = lens.walk.over === 'all' || lens.walk.over.length > 0;
      for (const words of text ?? []) query.append('text', words);
      if (types?.length) query.set('types', types.join(','));
      if (ids?.length) query.set('ids', ids.join(','));
      if (inside?.length) query.set('in', inside.join(','));
      for (const t of links ?? []) query.append('link', `${t.link} ${t.to ?? t.from}`);
      if (asked.filter?.exclude !== undefined) query.set('exclude', lens.exclude.join(','));
      if (walked) query.set('over', lens.walk.over === 'all' ? 'all' : (lens.walk.over as string[]).join(','));
      if (walked) query.set('steps', String(lens.walk.steps));
      if (asked.limit !== undefined) query.set('limit', String(lens.limit));
    }
    if (input.style?.lit) query.set('lit', input.style.lit);
    if (input.style?.shape) query.set('shape', input.style.shape);
    if (input.style?.id) query.set('style', input.style.id);
    // The canvas draws it, under the item's page when one is named.
    return `${input.entity ? `e/${input.entity}` : 'v'}${query.size ? `?${query}` : ''}`;
  }
  if (!input.entity && !input.screen) throw new Error('A look or a show needs "entity", "screen" or "lens".');
  return input.entity ? `e/${input.entity}` : input.screen!;
}
