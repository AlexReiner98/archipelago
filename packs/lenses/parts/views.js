// What the lenses pack's parts share (task e_x8b2d8yb): a view as a row, said in words from the schema's words the host
// hands every part, and its age. A view is one the `saved_views` view answers as a person picks (`pick`): its id
// (`lens`), title, life, note, why it cannot draw, the document that brings it in, when it changed, its filter and
// walk, and whether a pack ships it (`preset`). A row names its view; the host opens it when pressed and draws its
// thumbnail (a `thumb` mark), so a part never writes an address or paints a picture.

/** Newest first: a view changed or kept lately is the one most likely looked for. */
export const newest = (a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));

/** A working view: an agent's, retired with what it is about unless the owner keeps it. */
export const working = (c) => c.life === 'working' && !c.preset;

/** The views a person picks from: not those a document brings in, unless up. */
export const pickable = (all, up) => all.filter((c) => !c.document || c.lens === up);

/** The views the answer holds, or none. */
export const viewsIn = (input) => {
  const pictures = input?.views?.saved_views?.pictures;
  return Array.isArray(pictures) ? pictures.filter((c) => typeof c?.lens === 'string' && typeof c?.title === 'string') : [];
};

const ARROW = { either: '↔', out: '→', in: '←' };
const wayOf = (term) => {
  const way = term.endsWith('>') ? 'out' : term.endsWith('<') ? 'in' : 'either';
  return { link: way === 'either' ? term : term.slice(0, -1), way };
};

/** What a view's query finds, in a few words: its terms, then its walk, types by the names the schema gives them. */
export function lensWords(c, words) {
  const f = c.filter && typeof c.filter === 'object' ? c.filter : {};
  const typeTitle = (x) => words?.types?.[x]?.title ?? x;
  const terms = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string') : []);
  const said = [...terms(f.find), ...terms(f.only).map((t) => `only ${t}`)].map((t) => t.replace(/^text (.*)$/, '“$1”').replace(/^type (.*)$/, (_, x) => typeTitle(x)).replace(/^id .*$/, 'an item'));
  const over = c.walk?.over;
  if (over === 'all' || (Array.isArray(over) && over.length)) {
    const ways = over === 'all' ? 'every link' : over.map((t) => ((w) => `${ARROW[w.way]} ${w.link}`)(wayOf(String(t)))).join(', ').replaceAll('_', ' ');
    said.push(`${ways} × ${c.walk.steps}`);
  }
  return said.join(' · ');
}

/** How long ago, in a word or two, and the whole time for its tip; null for no time. */
export function age(ts) {
  const then = new Date(ts);
  if (Number.isNaN(then.getTime())) return null;
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
  const text = mins < 1 ? 'now' : mins < 60 ? `${mins} min` : mins < 24 * 60 ? `${Math.floor(mins / 60)} h` : mins < 48 * 60 ? 'yesterday' : then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return { text, tip: then.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) };
}

/** A fold: a press naming what is behind it and how many, open or shut. */
export const fold = (key, name, count, open, tip) => ['button', { key, look: 'quiet', tip }, `${open ? '▾' : '▸'} ${name} (${count})`];

/** The tip of a fold of agents' views. */
export const AGENTS_TIP = 'Agents’ views: each retires with what it is about, or after two weeks untouched, unless you keep it';
