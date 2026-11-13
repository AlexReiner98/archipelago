// A lens as find changes it (task e_rfjwstnu): its filter's terms (find, only, not), its walk and its limit, as the
// query the page draws says them (packs/surface/page/canvas.js `hooks.address`). A part imports nothing of the page, so
// what find needs of the bar's words is said again here, as data in and data out.

/** What Not leaves out unless the lens says otherwise. */
export const notOf = (filter) => (Array.isArray(filter?.not) ? filter.not : ['kind system']);

/** The words a filter finds, each set of them. */
export const wordsOf = (filter) => (filter?.find ?? []).filter((t) => t.startsWith('text ')).map((t) => t.slice(5));

/** The filter with its words these sets, in the place words have among Find's terms. */
export const withWords = (filter, sets) => ({
  ...filter,
  find: [...new Set(sets.map((s) => s.trim()).filter(Boolean))].map((w) => `text ${w}`).concat((filter?.find ?? []).filter((t) => !t.startsWith('text '))),
});

/** The lens with a term added to one part of its filter; one added to a lens that names a view makes it a filter of the map again. */
export function added(lens, term) {
  const f = { ...lens.filter };
  for (const part of ['find', 'only', 'not']) if (term[part]) f[part] = [...new Set([...(part === 'not' ? notOf(f) : (f[part] ?? [])), term[part]])];
  // Only what is done finds nothing while Not leaves the done out: it takes that away.
  if (term.only === 'done' && f.not?.includes('done')) f.not = f.not.filter((x) => x !== 'done');
  const { view: _view, ...rest } = lens;
  return { ...rest, filter: f };
}

/** The lens with a link to walk along, or every link. */
export function walked(lens, walk) {
  const { over = [], steps = 0 } = lens.walk ?? {};
  return { ...lens, walk: { over: walk === 'all' ? 'all' : [...(over === 'all' ? [] : over), walk], steps: steps || 1 } };
}

/** A link term with its way: out (>), in (<) or either. */
export const withWay = (link, way) => `${link}${{ out: '>', in: '<' }[way] ?? ''}`;
/** Each way's arrow. */
export const ARROW = { either: '↔', out: '→', in: '←' };

/** Only's plain words that take nothing after them (decision e_xe5dx55e), those already in the lens left out. */
const PLAIN = {
  done: 'What is done or closed',
  blocked: 'What waits on something open, someone, or a resource that is not free',
  'no owner': 'What nobody owns',
  'over estimate': 'What has used more tokens than it was estimated to take',
  'by owner': 'What the owner last set the status of, or an agent on their word',
  'by agent': 'What an agent last set the status of, on its own judgment',
};
export const offered = (have) => Object.keys(PLAIN).filter((word) => !have.includes(word)).map((word) => ({ word, title: PLAIN[word] }));

/** The schema's words as find reads them: types and links, from what the host hands every part (part-words.ts). */
export function schemaOf(words) {
  const types = Object.entries(words?.types ?? {}).map(([id, t]) => ({ id, ...t }));
  const links = Object.entries(words?.links ?? {}).map(([id, title]) => ({ id, title }));
  const byId = new Map(types.map((t) => [t.id, t]));
  /** Whether a type is a flavour of another, or is it. */
  const isA = (type, of) => {
    for (let t = type, seen = 0; t && seen < 50; t = byId.get(t)?.of, seen++) if (t === of) return true;
    return false;
  };
  /** The system's own types: those that come from core's system starter. */
  const system = (type) => isA(type, 'system');
  const title = (type) => byId.get(type)?.title ?? type;
  /** A type as a choice: its title, and its id where another type has the same title. */
  const choice = (t) => `${t.title}${types.some((o) => o.id !== t.id && o.title === t.title) ? ` (${t.id})` : ''}`;
  return { types, links, isA, system, title, choice };
}
