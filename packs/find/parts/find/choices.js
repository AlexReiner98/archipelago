// What words typed in find could be (decision e_2a4mddx8), each choice said by its kind so nothing is guessed (decision
// e_45sgrfqd). Find has a mode for each part of the lens, by its word: typing "only " (or Not, Walk, Limit) puts find in
// that part, and its choices are that part's; "view " and "style " put it in the views and layouts kept, every one
// offered until what is typed narrows them, so one bar sets up the whole canvas.
//
// In Find: Words first, always, and lit, so Enter takes the words unless another is chosen; then, for the items found by
// name, all that is In each, the Item itself and what is Related to it (what the lens leaves out, a style say, as the
// Item alone, whose page opens over the canvas and changes nothing); a View by its name, which opens in the pane; the
// types and the links whose names hold the words. In Only and Not: the plain words, a Status, and all that Find takes.
// In Walk: a link, out, in or either way, or every link. In Limit: a number. In Style: a style or layout kept, whose
// page opens, and the layouts the packs ship, which draw the canvas at once.
//
// A choice is { kind, label, note, title, and one of: words, term (added to the filter), walk, limit, view (a view to
// open), item (a page to open over the canvas), shape (the canvas drawn in it), mode (find goes into that part) }.
// What is read as the person types is asked through `read(name, params)`, the host's, answering null when it cannot.

import { ARROW, notOf, offered, withWay } from './lens.js';

/** The parts find can be in, by the word that puts it there. */
export const MODES = ['Find', 'Only', 'Not', 'Walk', 'Limit', 'View', 'Style'];
const MEANS = { Find: 'What adds to the view', Only: 'What must all hold of what Find finds', Not: 'What is left out of everything', Walk: 'The links followed from what Find finds', Limit: 'The most items drawn', View: 'A saved view to open', Style: 'A layout for this view, or a style on the map' };

const has = (name, q) => String(name ?? '').toLowerCase().includes(q.toLowerCase());
const asList = (x) => (Array.isArray(x) ? x : Array.isArray(x?.items) ? x.items : []);

/** The words themselves, Find's first choice: drawn at once, before anything is read, so Enter never waits on it. */
export const wordsChoice = (q) => ({ kind: 'Words', label: `“${q}”`, note: '', title: `Words to find in titles and notes: “${q}”`, words: q });

/** The other parts whose word starts with what is typed, each a choice that puts find in it. */
const modeChoices = (mode, q) => (q.length < 2 ? [] : MODES.filter((m) => m !== mode && m.toLowerCase().startsWith(q.toLowerCase())))
  .map((m) => ({ kind: m, label: `${MEANS[m].toLowerCase()} ›`, note: '', title: `${m}: ${MEANS[m].toLowerCase()} (type “${m.toLowerCase()} ” to go there)`, mode: m }));

/** The kinds of choice in each part: one's word first in what is typed ("within archipelago") offers that kind alone. */
const TERMS = ['Words', 'In', 'Item', 'Related', 'Tag', 'Type', 'Link', 'Owner'];
const KINDS = { Find: ['View', ...TERMS], Only: ['Word', 'Status', ...TERMS], Not: ['Word', 'Status', ...TERMS], Walk: [], Limit: [], View: [], Style: [] };

/** The kind whose word leads what is typed in `mode`, and the rest; or nothing. */
export function ledBy(mode, q) {
  const [, lead, rest] = /^(\S+)\s+(.*)$/.exec(q) ?? [];
  const kind = lead && KINDS[mode]?.find((k) => k.toLowerCase() === (lead.toLowerCase() === 'within' ? 'in' : lead.toLowerCase()));
  return kind ? { kind, rest: rest.trim() } : null;
}

/** The last words of a name that name a type ("archipelago project", "roof tasks") narrow the search to it. */
function typeNamed(q, schema) {
  const words = q.split(/\s+/);
  for (const n of [2, 1]) {
    if (words.length <= n) continue;
    const said = words.slice(-n).join(' ').toLowerCase();
    const t = schema.types.find((x) => !schema.system(x.id) && [x.title.toLowerCase(), `${x.title.toLowerCase()}s`].includes(said));
    if (t) return { q: words.slice(0, -n).join(' '), type: t.id };
  }
  return { q };
}

/** The type of what is opened, not found: a view (core's lens). */
const KEPT_VIEW = 'lens';

/**
 * The choices for `q` in `mode`, in order. `c` is { most, wide, lens, schema, read, views, shapes }: how many of each
 * are offered, how many of the one kind a kind's word asks for, the lens up (what it holds is not offered again), the
 * schema's words (lens.js schemaOf), the host's live reads, the views the person may pick (saved_views' pictures), and
 * the layouts the packs ship ({ title, shape }).
 */
export async function choicesFor(mode, q, c) {
  const led = !c.narrowed && ledBy(mode, q);
  if (led) {
    const all = (await choicesFor(mode, led.rest, { ...c, most: c.wide, narrowed: true })).filter((x) => x.kind === led.kind);
    return [...all, ...(mode === 'Find' && led.kind !== 'Words' ? [wordsChoice(q)] : [])];
  }
  const { schema } = c;
  const found = async (typed, most, given) => {
    const { q: name, type } = given ? { q: typed, type: given } : typeNamed(typed, schema);
    return name ? asList(await c.read('search', { q: name, limit: most, ...(type && { type }) })).filter((e) => typeof e?.id === 'string') : [];
  };
  const views = (words, most) => (c.views ?? []).filter((v) => !words || has(`${v.title} ${v.note ?? ''}`, words)).slice(0, most)
    .map((v) => ({ kind: 'View', label: v.title, note: '', title: `Open the view ${v.title}`, view: v.lens }));
  const typeList = (most) => schema.types.filter((t) => !schema.system(t.id) && has(t.title, q)).slice(0, most);
  const linkList = (most) => schema.links.filter((r) => !r.id.startsWith('sys.') && has(r.title ?? r.id, q)).slice(0, most);
  const f = c.lens?.filter ?? {};
  if (mode === 'Find' || mode === 'Only' || mode === 'Not') {
    const part = mode.toLowerCase();
    const have = part === 'not' ? notOf(f) : (f[part] ?? []);
    const adds = (term) => ({ term: { [part]: term } });
    const [hits, people] = await Promise.all([found(q, c.most), found(q, c.most, 'actor')]);
    // What the lens leaves out (the system's own, a style say) is no term it could draw: Find opens its page instead.
    const leftOut = notOf(f).includes('kind system');
    const items = hits.filter((e) => !schema.isA(e.type, KEPT_VIEW)).flatMap((e) => {
      const what = schema.title(e.type);
      if (leftOut && schema.system(e.type)) return mode === 'Find' ? [{ kind: 'Item', label: e.title, note: what, title: `Open ${e.title} (${what})`, item: e.id }] : [];
      return [
        { kind: 'In', label: e.title, note: what, title: `All that is in ${e.title} (${what}), at any depth`, ...adds(`in ${e.id}`) },
        { kind: 'Item', label: e.title, note: what, title: `${e.title} (${what}) alone`, ...adds(`id ${e.id}`) },
        { kind: 'Related', label: e.title, note: what, title: `What has any link to ${e.title} (${what}), either way`, ...adds(`related ${e.id}`) },
      ];
    });
    const typed = typeList(c.most).map((t) => ({ kind: 'Type', label: schema.choice(t), note: '', title: `Items of the type ${t.title}`, ...adds(`type ${t.id}`) }));
    const linked = linkList(c.most).map((r) => ({ kind: 'Link', label: `${r.title ?? r.id} → me`, note: '', title: `What has ${r.title ?? r.id} to me`, ...adds(`${r.id} me`) }));
    const mine = has('owner me', q) && !have.includes('owner me') ? [{ kind: 'Owner', label: 'me', note: '', title: 'What is mine', ...adds('owner me') }] : [];
    const owners = people.map((e) => ({ kind: 'Owner', label: e.title, note: schema.title(e.type), title: `What ${e.title} owns`, ...adds(`owner ${e.id}`) }));
    if (mode === 'Find') return [wordsChoice(q), ...modeChoices(mode, q), ...views(q, c.most), ...items, ...typed, ...linked, ...mine, ...owners];
    const words = offered(have).filter((w) => has(w.word, q)).map((w) => ({ kind: 'Word', label: w.word, note: '', title: w.title, ...adds(w.word) }));
    const system = has('system', q) && !have.includes('kind system') ? [{ kind: 'Word', label: 'system', note: '', title: 'What the system keeps', ...adds('kind system') }] : [];
    const statuses = [...new Set(schema.types.flatMap((t) => [...(t.open ?? []), ...(t.closed ?? [])]))].filter((s) => (q ? has(s, q) : c.narrowed)).slice(0, c.most)
      .map((s) => ({ kind: 'Status', label: s, note: '', title: `What is ${s}`, ...adds(`status ${s}`) }));
    const text = q ? [{ kind: 'Words', label: `“${q}”`, note: '', title: `Words in titles and notes: “${q}”`, ...adds(`text ${q}`) }] : [];
    return [...modeChoices(mode, q), ...words, ...system, ...mine, ...statuses, ...typed, ...items, ...owners, ...linked, ...text];
  }
  // View or Style: every one of that kind, narrowed by what is typed.
  if (mode === 'View') return [...modeChoices(mode, q), ...views(q, c.wide)];
  if (mode === 'Style') {
    const [layouts, styles] = await Promise.all(['layout', 'style'].map((type) => c.read('search', { ...(q && { q }), type, open: true, limit: c.wide }).then(asList)));
    const kept = [...layouts.filter((s) => !s.props?.preset).map((s) => ({ ...s, layout: true })), ...styles];
    const shapes = (c.shapes ?? []).filter((s) => has(s.title, q));
    return [
      ...modeChoices(mode, q),
      ...[
        ...kept.map((s) => ({ kind: s.layout ? 'Layout' : 'Style', label: s.title, note: '', title: `Open ${s.title}`, item: s.id })),
        ...shapes.map((s) => ({ kind: 'Layout', label: s.title, note: '', title: `Draw this view in ${s.title}`, shape: s.shape })),
      ].slice(0, c.wide),
    ];
  }
  if (mode === 'Walk') {
    const every = has('every link', q) && c.lens?.walk?.over !== 'all' ? [{ kind: 'Walk', label: 'every link', note: '', title: 'Every link, either way', walk: 'all' }] : [];
    const ways = linkList(c.most).flatMap((r) => ['out', 'in', 'either'].map((way) => ({ kind: 'Walk', label: `${ARROW[way]} ${r.title ?? r.id}`, note: '', title: { out: 'Out along this link', in: 'In along this link', either: 'Either way along this link' }[way], walk: withWay(r.id, way) })));
    return [...modeChoices(mode, q), ...every, ...ways];
  }
  // Limit: a whole number, the most items drawn.
  const n = Number(q);
  return [...modeChoices(mode, q), ...(Number.isInteger(n) && n >= 1 ? [{ kind: 'Limit', label: String(n), note: '', title: `Draw at most ${n} items`, limit: n }] : [])];
}
