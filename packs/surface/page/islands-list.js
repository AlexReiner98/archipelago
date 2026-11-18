// Which islands a canvas draws, as the page's address says, and what a press in the island picker makes of it
// (decision e_n42s8jvn). No page and no imports: test/islands-list.test.ts runs it as it is.

/** The live reads a person may toggle on beside islands, by the name the list keeps. */
export const READS = ['frontier', 'attention'];
/**
 * Auto, kept in the list like a read (Alex, 18 Nov 2026): while it is there, Home also draws every island where work
 * changed in the last few minutes (`changedWithin`), on and off by itself as work moves.
 */
export const AUTO = 'auto';
/** What the list may hold: an island's id, a live read's name, or Auto. */
const entry = (v) => typeof v === 'string' && (/^e_[a-z0-9]{8}$/.test(v) || READS.includes(v) || v === AUTO);
/** A list as kept: its entries once each, nothing else. */
export const clean = (v) => (Array.isArray(v) ? [...new Set(v.filter(entry))] : []);

/** The islands and reads an address's query names (`islands=a,b`), or null when it names none. */
export const islandsIn = (query) => {
  const named = new URLSearchParams(query ?? '').get('islands');
  return named === null ? null : clean(named.split(','));
};

/** Whether a map keeps islands (its schema's types that live on one declare the field island): a map with them off has none. */
export const islandsOnMap = (schema) => (schema?.types ?? []).some((t) => t.fields?.island);

/** Whether the page's address is Home: the canvas draws the person's own list. */
export const atHome = (hash) => /^#?\/?(v)?$/.test(String(hash ?? ''));

/** What the canvas at `hash` draws: the islands the address names, else the person's own (`mine`). */
export const drawnAt = (hash, mine) => islandsIn(String(hash ?? '').split('?')[1]) ?? mine;

/**
 * What the canvas draws now: where it has drawn (`canvas`, its `home` and the `islands` of its lens), that, Home the
 * person's own list (reads among it); before it has, what the address says (an item's address names its island only
 * once the canvas has read it). The side bar marks this and a press acts on it, so the two never disagree.
 */
export const drawnBy = (hash, mine, canvas) => (canvas ? (canvas.home ? mine : canvas.islands) : drawnAt(hash, mine));

/**
 * A press on island `id` in the picker, the canvas drawing `drawn` (Home or not): the list it draws with `id` put on or
 * taken off, kept as the person's own, and whether the canvas then goes Home to draw it (it stood at another list: an
 * agent's show, an item).
 */
export const pressed = (drawn, home, id) => ({ list: drawn.includes(id) ? drawn.filter((x) => x !== id) : [...drawn, id], home: !home });

/** Island `id` on, whatever it was: what the canvas draws with it added, and whether the canvas then goes Home. */
export const turnedOn = (drawn, home, id) => ({ list: drawn.includes(id) ? drawn : [...drawn, id], home: !home });
/** Island `id` alone on the canvas. */
export const only = (home, id) => ({ list: [id], home: !home });

/** The islands as the side list keeps them, each read as search answers it. */
export const islandOf = (e) => ({ id: e.id, title: e.title, worked_at: e.worked_at ?? e.updated_at, pack: e.pack ?? { id: '', title: '' } });

/** The words of a text, as search reads them: lower case, split on what is not a letter or a digit. */
const words = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The one search the side list and the palette share: every island (`{ id, title, pack: { id, title } }`) whose name or
 * pack holds each word typed (a word's start), best first. A name matched before a pack, the start of the name first,
 * then a word of it; those that match equally well by name, so a family of islands stands together. With nothing
 * typed, all of them by name.
 */
export function rankIslands(islands, q) {
  const asked = words(q);
  const byName = (a, b) => String(a.title).localeCompare(String(b.title));
  if (!asked.length) return [...islands].sort(byName);
  const scored = [];
  for (const i of islands) {
    const name = words(i.title), pack = [...words(i.pack?.title), ...words(i.pack?.id)];
    let score = 0;
    for (const w of asked) {
      const inName = name.findIndex((n) => n.startsWith(w));
      if (inName === 0) score += 4;
      else if (inName > 0) score += 3;
      else if (pack.some((n) => n.startsWith(w))) score += 1;
      else if (String(i.title).toLowerCase().includes(w)) score += 0.5;
      else {
        score = -1;
        break;
      }
    }
    if (score >= 0) scored.push([score, i]);
  }
  return scored.sort(([a, x], [b, y]) => b - a || byName(x, y)).map(([, i]) => i);
}

/**
 * The islands as the side list lays them out (Alex, 17 Nov 2026, e_cr4haav9: recent first, then the rest by name; no
 * pack groups): those where work changed (`worked_at`: the latest change of an item on it) within `days` of `now`, the
 * latest first and `most` of them at most, then every other by name.
 */
export function recentFirst(islands, now, days, most = Infinity) {
  const since = now - days * 86_400_000, at = (i) => Date.parse(i.worked_at ?? '') || 0;
  const recent = islands.filter((i) => at(i) >= since).sort((a, b) => at(b) - at(a) || String(a.title).localeCompare(String(b.title))).slice(0, most);
  const kept = new Set(recent);
  const rest = islands.filter((i) => !kept.has(i)).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return { recent, rest };
}

/**
 * What Auto puts on: the ids of the islands where work changed (`worked_at`) within `minutes` of `now`, the latest
 * first, `most` of them at most.
 */
export function changedWithin(islands, now, minutes, most = Infinity) {
  const since = now - minutes * 60_000, at = (i) => Date.parse(i.worked_at ?? '') || 0;
  return islands.filter((i) => at(i) >= since).sort((a, b) => at(b) - at(a) || String(a.id).localeCompare(String(b.id))).slice(0, most).map((i) => i.id);
}

/** The list with Auto turned the other way. */
export const autoToggled = (list) => (list.includes(AUTO) ? list.filter((x) => x !== AUTO) : [...list, AUTO]);

/** A pack's title as the list shows it: as the pack says it, its first letter a capital. */
export const capital = (s) => String(s ?? '').replace(/^\p{Ll}/u, (c) => c.toUpperCase());
