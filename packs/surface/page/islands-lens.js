// A canvas that draws a list of islands, said as the list it is (decision e_n42s8jvn, task e_wnybzm7a): its address
// `islands=a,b`, not the find terms it is drawn by, and its name the islands' own. No page and no imports:
// test/islands-lens.test.ts runs it as it is.

const ISLAND = /^island (e_[a-z0-9]{8})$/;

/** The lens that draws these islands (an id each; a live read's name is left to the list, not drawn by a lens). */
export const islandsLens = (list) => ({ filter: { find: list.filter((x) => /^e_/.test(x)).map((id) => `island ${id}`) }, walk: { over: [], steps: 0 } });

/**
 * The islands a lens draws when it draws a list of islands and nothing else: its every find term an island, nothing
 * narrowed, walked, cut or timed. Null for any other lens, which keeps its own address and name.
 */
export function islandsOfLens(lens) {
  if (!lens || lens.view || lens.limit || lens.time || lens.sessions === false) return null;
  const { find, only, not, ...more } = lens.filter ?? {};
  if (!find?.length || only?.length || not || Object.keys(more).length) return null;
  const { over = [], steps = 0 } = lens.walk ?? {};
  if (over === 'all' || over.length || steps) return null;
  const ids = find.map((t) => ISLAND.exec(t)?.[1]);
  return ids.every(Boolean) ? [...new Set(ids)] : null;
}

/** A tab's name for a list of islands: the first's name, and how many more ("X growth + 2"). */
export const islandsName = (ids, titleOf) => (ids.length ? `${titleOf(ids[0])}${ids.length > 1 ? ` + ${ids.length - 1}` : ''}` : '');
