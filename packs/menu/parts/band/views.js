// What the band reads of the views kept and the page's address: which view is up, whether what is up has moved from
// it, and what a Save sends. The address is the host's (`go`): the query the canvas draws (null for Home) and the
// layout it is drawn in, with the kept view's id when one is up (`layout.canvas`). A view is one the saved_views view
// answers as a person picks: its id (`lens`), title, life, shape, filter and walk, and whether a pack ships it.

/** Words for a value, its keys in order: two queries said alike are the same query. */
export const said = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const queryOf = (c) => ({ filter: c?.filter ?? {}, walk: c?.walk ?? { over: [], steps: 0 } });
const asked = (address) => queryOf(address?.query ?? {});

/** The views the answer holds, or none. */
export const viewsIn = (input) => {
  const pictures = input?.views?.saved_views?.pictures;
  return Array.isArray(pictures) ? pictures.filter((c) => typeof c?.lens === 'string' && typeof c?.title === 'string') : [];
};

/** The view up: the one the address names (or the piece), else one a pack ships whose query is the one up. */
export function upOf(input) {
  const all = viewsIn(input);
  const id = input?.address?.layout?.canvas ?? input?.piece?.current;
  if (typeof id === 'string') return all.find((c) => c.lens === id) ?? null;
  if (!input?.address?.query) return null;
  const now = said(asked(input.address));
  return all.find((c) => c.preset && said(queryOf(c)) === now) ?? null;
}

/** Whether what is up has moved from the view kept: its query, or the shape it is drawn in. */
export function changedFrom(c, address) {
  if (!c || !address?.query) return false;
  if (said(queryOf(c)) !== said(asked(address))) return true;
  const shape = address.layout?.shape;
  return typeof shape === 'string' && typeof c.shape === 'string' && shape !== c.shape;
}

/** What menu.save_view is sent to keep what is up under `title`, into the view `into` when there is one; null with nothing up. */
export function saveInput(input, title, into) {
  const q = input?.address?.query;
  if (!q?.filter) return null;
  const up = upOf(input);
  const layout = input.address.layout ?? {};
  return {
    ...(into && !into.preset && { id: into.lens }),
    title,
    filter: q.filter,
    walk: q.walk ?? { over: [], steps: 0 },
    ...(Number.isInteger(q.limit) && { limit: q.limit }),
    ...(q.time && typeof q.time === 'object' && { time: q.time }),
    ...(q.sessions === false && { sessions: false }),
    style: Object.fromEntries(['shape', 'style', 'lit'].filter((k) => typeof layout[k] === 'string').map((k) => [k, layout[k]])),
    // A view a pack ships, saved under its own name, is the owner's version of it.
    ...(up?.preset && !into && up.title === title && { preset: up.lens }),
  };
}
