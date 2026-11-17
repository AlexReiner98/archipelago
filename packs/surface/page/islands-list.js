// Which islands a canvas draws, as the page's address says, and what a press in the island picker makes of it
// (decision e_n42s8jvn). No page and no imports: test/islands-list.test.ts runs it as it is.

/** The live reads a person may toggle on beside islands, by the name the list keeps. */
export const READS = ['frontier', 'attention'];
/** What the list may hold: an island's id or a live read's name. */
const entry = (v) => typeof v === 'string' && (/^e_[a-z0-9]{8}$/.test(v) || READS.includes(v));
/** A list as kept: its entries once each, nothing else. */
export const clean = (v) => (Array.isArray(v) ? [...new Set(v.filter(entry))] : []);

/** The islands and reads an address's query names (`islands=a,b`), or null when it names none. */
export const islandsIn = (query) => {
  const named = new URLSearchParams(query ?? '').get('islands');
  return named === null ? null : clean(named.split(','));
};

/** Whether the page's address is Home: the canvas draws the person's own list. */
export const atHome = (hash) => /^#?\/?(v)?$/.test(String(hash ?? ''));

/** What the canvas at `hash` draws: the islands the address names, else the person's own (`mine`). */
export const drawnAt = (hash, mine) => islandsIn(String(hash ?? '').split('?')[1]) ?? mine;

/**
 * A press on island `id` in the picker, the canvas at `hash`: the list it draws with `id` put on or taken off, kept as
 * the person's own, and whether the canvas then goes Home to draw it (it stood at another list: an agent's show, an item).
 */
export const pressed = (hash, mine, id) => {
  const drawn = drawnAt(hash, mine);
  return { list: drawn.includes(id) ? drawn.filter((x) => x !== id) : [...drawn, id], home: !atHome(hash) };
};
