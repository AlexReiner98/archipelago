// Layer: graph. A lens answer as the model the rows layout lays out: items { id, w, h, island, made, lines }, links
// { id, from, to, type, order } and islands { id, title, made }. A stand-in for the shared kit's model (task e_7v52ek3c)
// until it lands: the same shape, so placement and routing read only this. Pure: an answer, a measure and the style's
// sizes in, the model out.

import { lines } from '../flow/lines.js';

const need = (sizes, name) => {
  if (typeof sizes?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the rows layout uses`);
  return sizes[name];
};

/** An item's type and what it is a flavour of, nearest first. */
const lineageOf = (i) => [i?.type, ...(Array.isArray(i?.is) ? i.is : [])].filter(Boolean);

/** When an item was made, as a string that sorts: what has no time yet comes after what has. */
const madeOf = (i) => (typeof i.created_at === 'string' ? i.created_at : i.created_at ? new Date(i.created_at).toISOString() : '~');

/**
 * The model of an answer. A link is in the order (`order: true`) when it is a dependency, or when it ties an item to an
 * actor (waits on, owned by), as the flow draws it: either way its `to` is drawn above its `from`. Links the style draws
 * no wire for (`undrawn`) and links to items not shown are left out.
 */
export function modelOf({ items = [], links = [], islands = [] }, { measure, sizes, undrawn = [] }) {
  const [MAX_TEXT, TEXT, BOX_PAD, BOX_H] = ['flow_max_text', 'flow_text', 'flow_box_pad', 'flow_box_height'].map((n) => need(sizes, n));
  const LINE = need(sizes, 'flow_line_height'), skip = new Set(undrawn);
  const shown = new Map(items.map((i) => [i.id, i]));
  const actor = (id) => lineageOf(shown.get(id)).includes('actor');
  const modelItems = items.map((i) => {
    const said = lines(i.title ?? i.id, MAX_TEXT, (t) => measure(t, TEXT));
    const w = Math.min(MAX_TEXT, said.reduce((m, t) => Math.max(m, measure(t, TEXT)), 0)) + BOX_PAD;
    return { id: i.id, w, h: BOX_H + (said.length - 1) * LINE, island: i.island ?? null, made: madeOf(i), lines: said, type: i.type };
  });
  const seen = new Set(), modelLinks = [];
  for (const l of links) {
    const type = l.type ?? l.kind;
    if (!type || skip.has(type) || l.from === l.to || !shown.has(l.from) || !shown.has(l.to)) continue;
    const key = `${type} ${l.from} ${l.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const order = type === 'depends_on' || (actor(l.to) && !actor(l.from));
    modelLinks.push({ id: l.id ?? key, from: l.from, to: l.to, type, order });
  }
  const firstMade = new Map();
  for (const i of modelItems) if (i.island && !(firstMade.get(i.island) <= i.made)) firstMade.set(i.island, i.made);
  const modelIslands = islands.filter((s) => firstMade.has(s.id)).map((s) => ({ id: s.id, title: s.title ?? s.id, made: firstMade.get(s.id) }));
  return { items: modelItems, links: modelLinks, islands: modelIslands };
}
