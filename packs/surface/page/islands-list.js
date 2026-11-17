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

/** Island `id` on, whatever it was: what the canvas draws with it added, and whether the canvas then goes Home. */
export const turnedOn = (hash, mine, id) => {
  const drawn = drawnAt(hash, mine);
  return { list: drawn.includes(id) ? drawn : [...drawn, id], home: !atHome(hash) };
};
/** Island `id` alone on the canvas. */
export const only = (hash, id) => ({ list: [id], home: !atHome(hash) });

/** The words of a text, as search reads them: lower case, split on what is not a letter or a digit. */
const words = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The one search the side list and the palette share: every island (`{ id, title, pack: { id, title } }`) whose name or
 * pack holds each word typed (a word's start), best first. A name matched before a pack, the start of the name first,
 * then a word of it, then the shorter name; with nothing typed, all of them by name.
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
  return scored.sort(([a, x], [b, y]) => b - a || String(x.title).length - String(y.title).length || byName(x, y)).map(([, i]) => i);
}

/** The islands in groups by pack, each its pack's id, title and islands by name; packs by title. */
export function byPack(islands) {
  const groups = new Map();
  for (const i of islands) {
    const id = i.pack?.id || '';
    (groups.get(id) ?? groups.set(id, { id, title: i.pack?.title || id, islands: [] }).get(id)).islands.push(i);
  }
  return [...groups.values()].sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

/** A pack's title as the list shows it: as the pack says it, its first letter a capital. */
export const capital = (s) => String(s ?? '').replace(/^\p{Ll}/u, (c) => c.toUpperCase());

/**
 * Each pack's mark, by its id, told apart from every other's: its glyph where it has one, else its first two letters
 * (Co), else its first and a later letter no other pack's mark took (Cr), else its first alone. Packs are taken by id, so
 * a mark stays the same however the list is cut.
 */
export function packMarks(packs) {
  const marks = new Map(), taken = new Set();
  const all = [...new Map(packs.map((p) => [p?.id ?? '', p])).values()].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  for (const p of all.filter((p) => p?.glyph)) (marks.set(p.id ?? '', p.glyph), taken.add(p.glyph));
  for (const p of all.filter((p) => !p?.glyph)) {
    const letters = [...String(p?.title || p?.id || '·').replace(/[^\p{L}\p{N}]/gu, '')];
    const first = (letters[0] ?? '·').toUpperCase(), rest = letters.slice(1).map((c) => c.toLowerCase());
    const mark = [rest[0], ...rest.slice(1)].filter(Boolean).map((c) => first + c).find((m) => !taken.has(m)) ?? first;
    marks.set(p?.id ?? '', mark);
    taken.add(mark);
  }
  return marks;
}
