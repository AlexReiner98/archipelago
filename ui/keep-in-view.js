// What a person makes on the canvas stays in sight, and the canvas stays the one they had (the owner, 10 Nov 2026):
// its query is kept as it was, and only what it would not find is added to it, a term each (an item by its id, a new
// island by `island <id>`), as a click adds to the filter. Whether the query finds it is the server's to judge (the
// page never runs a query, ui/membership.js): it is asked once, and the canvas read again either way.

import { api } from './base.js';
import { goQuery, queryNow, refreshCanvas } from './canvas.js';
import { added } from './query-bar.js';

/** Bring what was just made into the canvas up: `made` is [{ id, term }], the term that finds each if its query does not. */
export async function keepInView(made) {
  const lens = queryNow();
  if (!lens?.filter || !made.length) return refreshCanvas();
  const answer = await api('view', { name: 'flat', params: { filter: lens.filter, ...(lens.walk && { walk: lens.walk }), ...(lens.limit && { limit: lens.limit }) } }).catch(() => null);
  const found = new Set((answer?.items ?? []).map((i) => i.id));
  const missing = made.filter((m) => !found.has(m.id));
  if (!answer || !missing.length) return refreshCanvas();
  goQuery(missing.reduce((l, m) => added(l, { find: m.term }), lens));
}
