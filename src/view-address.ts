// The page's address for what an agent asks to show or to look at: a kept view (a lens item, a saved canvas), a
// lens and style of its own, an item's page or a screen. The page reads the same address (ui/query.js, readAddress),
// so what an agent names is drawn as the owner would draw it. A lens the canvas could not draw is refused here.

import { z } from 'zod';
import { readFlat } from './query-flat.ts';
import type { Archipelago } from './pelago.ts';

/** What names a view, as show and query look take it. */
export const VIEW_INPUT = {
  entity: z.string().optional().describe('An item id: its page; a view kept on the map (type lens, a saved canvas) is drawn as the canvas it is, its query in the query bar.'),
  query: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('What the view draws: a query, as query flat takes it ({ filter: { find, only, not }, walk: { over (depends_on> out, depends_on< in, depends_on either way), steps }, limit }), shown in the query bar as if written there. With entity, under that item\'s page. {} is the canvas as it opens.'),
  lens: z.record(z.string(), z.unknown()).optional().describe('The old name of query, still taken.'),
  style: z
    .object({
      lit: z.enum(['all', 'you', 'blocked']).optional().describe('What stays lit: everything, only what waits on the person looking, or only what is blocked.'),
      layout: z.enum(['list', 'flow', 'grid', 'time', 'architecture', 'pages']).optional().describe('One of the built-in layouts. list: each thing one line, what holds others a box that folds. flow: a process map, top down, wires at right angles. grid: rows by what the start holds, columns by lane, each thing a card. time: along the query\x27s time axis, a calendar or bars. architecture: a system, each part a box inside a box for where it runs, wires down to what it calls, each part and wire marked with its health. pages: each document its draft, as a reader reads it. plane: one flat plane placed by the shape of the graph, trees in combs and the knot from its planar part. rows: the plane with its rows set by the order, so no wire of the order runs up, each wire its own.'),
      shape: z.string().optional().describe('The old name of layout, still taken.'),
      id: z.string().optional().describe('A style kept on the map (an item of type style), drawn with for this one look.'),
    })
    .optional()
    .describe('How the view is drawn, for this one look. The style a view opens in is kept on the map: an item of type style, about the project or item it is for, or about nothing for the whole workspace; change it with change.'),
};

export interface ViewAsked {
  entity?: string;
  screen?: string;
  query?: Record<string, unknown>;
  lens?: Record<string, unknown>;
  style?: { lit?: string; layout?: string; shape?: string; id?: string };
}

/** The page's address (after "#/") for what is asked. */
export async function viewAddress(l: Archipelago, asked: ViewAsked): Promise<string> {
  const input = { ...asked, lens: asked.query ?? asked.lens, ...(asked.style && { style: { ...asked.style, shape: asked.style.layout ?? asked.style.shape } }) };
  // A saved canvas is opened as what the canvas draws: the page reads its lens and style from the map.
  const kept = input.entity && (await l.entity(input.entity));
  if (input.entity && !kept) throw new Error(`No item "${input.entity}"`);
  if (kept && !input.lens && !input.style && l.registry.isA(kept.type, 'lens')) return `v?canvas=${input.entity}`;
  if (input.lens || input.style) {
    // Read as the flat lens reads it, so a lens the canvas could not draw is refused here and not on a screen.
    const wanted = (input.lens ?? {}) as { limit?: unknown };
    const lens = Object.keys(wanted).length ? readFlat(l, wanted) : undefined;
    for (const term of lens?.find ?? []) {
      const [, id] = /^(?:id|in) (e_[a-z0-9]{8})$/.exec(term) ?? [];
      if (id && !(await l.entity(id))) throw new Error(`No item "${id}"`);
    }
    // The address says the lens as the page reads it: each term of the filter, the walk, the limit, the window of time.
    const query = new URLSearchParams();
    if (lens) {
      const walked = lens.walk.over === 'all' || lens.walk.over.length > 0;
      for (const term of lens.find) query.append('find', term);
      for (const term of lens.only) query.append('only', term);
      if (lens.not.join() !== 'kind system') {
        if (!lens.not.length) query.set('not', '');
        for (const term of lens.not) query.append('not', term);
      }
      if (walked) query.set('over', lens.walk.over === 'all' ? 'all' : (lens.walk.over as string[]).join(','));
      if (walked) query.set('steps', String(lens.walk.steps));
      if (wanted.limit !== undefined) query.set('limit', String(lens.limit));
      // A window of time as it was said (days from today stay so), as the page reads it back.
      if (lens.time) query.set('time', `${lens.time.from},${lens.time.to}`);
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
