// A place shown as a colour on its parts, never as a step (the owner, 26 Oct 2026: e_cp7hq4dv), so depth is still not
// drawn (e_ktdensts) and no tie runs from every part to where it is. An item of the place kind that holds parts in the
// picture (a part is an item of the place kind too: a component, a part of a mechanism; work about it stays tied to
// it) is left out of it; each of its parts takes its colour, and the key names it. The colours are the style's
// (place_hues), given in the order the places come; with none, a place is a step like any other. The place the
// picture was opened from stays a step. Pure: an answer in, the items to draw and each part's place out.

import { flatten, NEAR } from './graph.js';

/**
 * The items left to draw, the place each part is coloured by (`of`: part id to place id) and the places so shown, in
 * order, each with its colour and what it is part of when that is a place shown so too (`within`).
 */
export function placesAsColours({ items, links = [] }, hues, keep = new Set()) {
  if (!hues.length) return { items, of: new Map(), places: [] };
  const flat = flatten({ items, links });
  const byId = new Map(flat.items.map((i) => [i.id, i]));
  const isPlace = (id) => byId.get(id)?.kind === 'place';
  // A part is coloured by the first place it is part of; a link held for the owner stays a tie, drawn as a ghost.
  const placeOf = new Map();
  for (const l of flat.links) if (l.type === NEAR && !l.pending && isPlace(l.from) && isPlace(l.to) && !keep.has(l.to) && !placeOf.has(l.from)) placeOf.set(l.from, l.to);
  const gone = new Set(placeOf.values());
  const order = items.map((i) => i.id).filter((id) => gone.has(id));
  const places = order.map((id, k) => ({ id, title: byId.get(id).title, hex: hues[k % hues.length], ...(gone.has(placeOf.get(id)) && { within: byId.get(placeOf.get(id)).title }) }));
  const of = new Map([...placeOf].filter(([part]) => !gone.has(part)));
  return { items: items.filter((i) => !gone.has(i.id)), of, places };
}
