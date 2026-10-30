// What words typed in find could be (decision e_2a4mddx8), each choice said by its kind so nothing is guessed (decision
// e_45sgrfqd). Find has a mode for each part of the lens, by its word: typing "only " (or Not, Walk, Limit) puts find
// in that part, and its choices are that part's; "view " and "style " put it in choosing the canvas's view or style,
// every one offered until what is typed narrows them, so one bar sets up the whole canvas. In Find: Words first, always, and lit, so Enter takes the words
// unless another is chosen; then, for the items the search read finds by name, all that is In each and the Item
// itself (a tag as a Tag); a View kept on the map by its name, which opens in the pane, and a Style (one kept by name,
// a shape a drawing draws, or the house's), which the canvas is then drawn in; the types and the links whose names
// hold the words (a link to me). In Only and Not: the plain words, a Status, and all that Find takes. A word can only be checked of what is found, so Find offers none. In Walk: a link, out, in or either way,
// or every link. In Limit: a number. Each choice says the change it makes, kept by id.

import { api, notOf, state } from './base.js';
import { canvasAt } from './canvases.js';
import { offered } from './only-words.js';
import { ARROW, isA, relations, titles, typeChoice, typeTitle, types, withWay } from './words.js';

/** The parts find can be in, by the word that puts it there. */
export const MODES = ['Find', 'Only', 'Not', 'Walk', 'Limit', 'View', 'Style'];
const MEANS = { Find: 'What adds to the canvas', Only: 'What must all hold of what Find finds', Not: 'What is left out of everything', Walk: 'The links followed from what Find finds', Limit: 'The most items drawn', View: 'A saved view to open', Style: 'The style the canvas is drawn in' };

const has = (name, q) => String(name ?? '').toLowerCase().includes(q.toLowerCase());
const typeList = (q, most) => [...types.values()].filter((t) => !t.system && t.kind !== 'system' && has(t.title, q)).slice(0, most);
const linkList = (q, most) => [...relations.values()].filter((r) => !r.id.startsWith('sys.') && r.id !== 'tagged' && has(r.title ?? r.id, q)).slice(0, most);
/**
 * Items found by name. A name's last words that name a type (one or two, as typed or with an s: "archipelago project",
 * "roof tasks") narrow the search to that type, the rest the name; each choice says its type, so what was read is in sight.
 */
const typeNamed = (q) => {
  const words = q.split(/\s+/);
  for (const n of [2, 1]) {
    if (words.length <= n) continue;
    const said = words.slice(-n).join(' ').toLowerCase();
    const t = [...types.values()].find((x) => !x.system && x.kind !== 'system' && [x.title.toLowerCase(), `${x.title.toLowerCase()}s`].includes(said));
    if (t) return { q: words.slice(0, -n).join(' '), type: t.id };
  }
  return { q };
};
const found = async (typed, most, given) => {
  const { q, type } = given ? { q: typed, type: given } : typeNamed(typed);
  return (q ? await api('search', { q, limit: most, ...(type && { type }) }).catch(() => []) : []).map((e) => (titles.set(e.id, e.title), e));
};

/** The types of what is kept to be opened, not found: a view (core's lens) and a style. */
const KEPT = { View: 'lens', Style: 'style' };
const keptAs = (type) => Object.keys(KEPT).find((k) => isA(type, KEPT[k]));
/**
 * Views and styles by name. They are system items, so the words never find them (task e_933ptgfc): each is its own
 * choice. A view opens in the pane; a pack's view not kept on the map is offered by its title too, opened by its lens.
 * A style is the canvas's: the shapes the drawings draw and the styles kept by name, as the bar's style switch offers
 * them (ui/look-switch.js), and the house's.
 */
const keptFound = async (q, most, kinds = Object.keys(KEPT)) => {
  const [views, kept] = await Promise.all(Object.keys(KEPT).map((k) => (kinds.includes(k) ? api('search', { ...(q && { q }), type: KEPT[k], open: true, limit: most }).catch(() => []) : [])));
  const shapes = [{ shape: 'list', title: 'List' }, ...(state.schema?.shapes ?? [])].filter((s) => has(s.title, q)).map((s) => ({ title: s.title, style: { shape: s.shape } }));
  const named = kept.filter((s) => !s.props?.preset && !s.props?.on?.length).map((s) => ({ title: s.title, style: { style: s.id } }));
  const styles = kinds.includes('Style') ? [...shapes, ...named, ...(has('House', q) ? [{ title: 'House', style: {} }] : [])].slice(0, most) : [];
  const mine = new Set(views.map((v) => v.props?.preset).filter(Boolean));
  const presets = (kinds.includes('View') ? (state.schema?.canvases ?? []) : []).filter((p) => !mine.has(p.id) && has(p.title, q)).map((p) => ({ ...p, preset: true, props: { ...p.props, preset: p.id } }));
  return [
    ...[...views, ...presets].slice(0, most).map((v) => ({ kind: 'View', label: v.title, note: '', title: `Open the view ${v.title}`, href: canvasAt(v) })),
    ...styles.map((s) => ({ kind: 'Style', label: s.title, note: '', title: `Draw this canvas in the style ${s.title}`, style: s.style })),
  ];
};

/** The words themselves, Find's first choice: drawn at once, before the search answers, so Enter never waits on it. */
export function wordsChoice(q) {
  return { kind: 'Words', label: `“${q}”`, note: '', title: `Words to find in titles and notes: “${q}”`, words: q };
}

/** The other parts whose word starts with what is typed, each a choice that puts find in it. */
const modeChoices = (mode, q) => (q.length < 2 ? [] : MODES.filter((m) => m !== mode && m.toLowerCase().startsWith(q.toLowerCase())))
  .map((m) => ({ kind: m, label: `${MEANS[m].toLowerCase()} ›`, note: '', title: `${m}: ${MEANS[m].toLowerCase()} (type “${m.toLowerCase()} ” to go there)`, mode: m }));

/** The kinds of choice in each part: one's word first in what is typed ("within archipelago") offers that kind alone. */
const TERMS = ['Words', 'In', 'Item', 'Related', 'Tag', 'Type', 'Link', 'Owner'];
const KINDS = { Find: ['View', 'Style', ...TERMS], Only: ['Word', 'Status', ...TERMS], Not: ['Word', 'Status', ...TERMS], Walk: [], Limit: [], View: [], Style: [] };

/** The kind whose word leads what is typed in `mode`, and the rest; or nothing. */
export function ledBy(mode, q) {
  const [, lead, rest] = /^(\S+)\s+(.*)$/.exec(q) ?? [];
  const kind = lead && KINDS[mode].find((k) => k.toLowerCase() === (lead.toLowerCase() === 'within' ? 'in' : lead.toLowerCase()));
  return kind ? { kind, rest: rest.trim() } : null;
}

/**
 * The choices for `q` in `mode`, in order: { kind, label, note, title, and one of words, term (added to the filter),
 * walk (a link to follow), limit, href (a view to open), style (the canvas drawn in it), mode (find goes into that part) }. `c` is { most, wide, lens }: how many of each are
 * offered, how many of the one kind a kind's word asks for, and the lens up, so what it holds already is not offered
 * again. Led by a kind's word, only that kind is offered, found by the rest; in Find the whole of what was typed is
 * still offered as words, last.
 */
export async function choicesFor(mode, q, c) {
  const led = !c.narrowed && ledBy(mode, q);
  if (led) {
    const all = (await choicesFor(mode, led.rest, { ...c, most: c.wide, narrowed: true })).filter((x) => x.kind === led.kind);
    return [...all, ...(mode === 'Find' && led.kind !== 'Words' ? [wordsChoice(q)] : [])];
  }
  const f = c.lens.filter;
  if (mode === 'Find' || mode === 'Only' || mode === 'Not') {
    const part = mode.toLowerCase();
    const have = part === 'not' ? notOf(f) : (f[part] ?? []);
    const adds = (term) => ({ term: { [part]: term } });
    const [hits, kept] = await Promise.all([found(q, c.most), mode === 'Find' ? keptFound(q, c.most) : []]);
    const items = hits.filter((e) => !keptAs(e.type)).flatMap((e) => {
      const what = typeTitle(e.type);
      if (e.type === 'tag') return [{ kind: 'Tag', label: `#${e.title}`, note: '', title: `Items tagged ${e.title}`, ...adds(`tagged ${e.id}`) }];
      return [
        { kind: 'In', label: e.title, note: what, title: `All that is in ${e.title} (${what}), at any depth`, ...adds(`in ${e.id}`) },
        { kind: 'Item', label: e.title, note: what, title: `${e.title} (${what}) alone`, ...adds(`id ${e.id}`) },
        { kind: 'Related', label: e.title, note: what, title: `What has any link to ${e.title} (${what}), either way`, ...adds(`related ${e.id}`) },
      ];
    });
    const typed = typeList(q, c.most).map((t) => ({ kind: 'Type', label: typeChoice(t), note: '', title: `Items of the type ${t.title}`, ...adds(`type ${t.id}`) }));
    const linked = linkList(q, c.most).map((r) => ({ kind: 'Link', label: `${r.title ?? r.id} → me`, note: '', title: `What has ${r.title ?? r.id} to me`, ...adds(`${r.id} me`) }));
    const mine = has('owner me', q) && !have.includes('owner me') ? [{ kind: 'Owner', label: 'me', note: '', title: 'What is mine', ...adds('owner me') }] : [];
    const people = (await found(q, c.most, 'actor')).map((e) => ({ kind: 'Owner', label: e.title, note: typeTitle(e.type), title: `What ${e.title} owns`, ...adds(`owner ${e.id}`) }));
    if (mode === 'Find' && !c.signs) return [wordsChoice(q), ...modeChoices(mode, q), ...kept, ...items, ...typed, ...linked, ...mine, ...people];
    // What can only be checked of what is found goes to Only when find is not in a part of its own (the bar's signs).
    const checks = part === 'find' ? { term: (t) => ({ term: { only: t } }), have: f.only ?? [] } : { term: adds, have };
    const words = offered(checks.have).filter((w) => has(w.word, q)).map((w) => ({ kind: 'Word', label: w.word, note: '', title: w.title, ...checks.term(w.word) }));
    const system = has('system', q) && !checks.have.includes('kind system') ? [{ kind: 'Word', label: 'system', note: '', title: 'What the system keeps', ...checks.term('kind system') }] : [];
    const statuses = [...new Set([...types.values()].flatMap((t) => [...(t.statuses?.open ?? []), ...(t.statuses?.closed ?? [])]))].filter((s) => (q ? has(s, q) : c.narrowed)).slice(0, c.most)
      .map((s) => ({ kind: 'Status', label: s, note: '', title: `What is ${s}`, ...checks.term(`status ${s}`) }));
    if (mode === 'Find') return [wordsChoice(q), ...modeChoices(mode, q), ...kept, ...items, ...typed, ...linked, ...mine, ...people, ...words, ...system, ...statuses];
    const text = q ? [{ kind: 'Words', label: `“${q}”`, note: '', title: `Words in titles and notes: “${q}”`, ...adds(`text ${q}`) }] : [];
    return [...modeChoices(mode, q), ...words, ...system, ...mine, ...statuses, ...typed, ...items, ...people, ...linked, ...text];
  }
  // View or Style: every one of that kind, narrowed by what is typed.
  if (mode === 'View' || mode === 'Style') return [...modeChoices(mode, q), ...(await keptFound(q, c.wide, [mode]))];
  if (mode === 'Walk') {
    const every = has('every link', q) && c.lens.walk?.over !== 'all' ? [{ kind: 'Walk', label: 'every link', note: '', title: 'Every link, either way', walk: 'all' }] : [];
    const ways = linkList(q, c.most).flatMap((r) => ['out', 'in', 'either'].map((way) => ({ kind: 'Walk', label: `${ARROW[way]} ${r.title ?? r.id}`, note: '', title: { out: 'Out along this link', in: 'In along this link', either: 'Either way along this link' }[way], walk: withWay(r.id, way) })));
    return [...modeChoices(mode, q), ...every, ...ways];
  }
  // Limit: a whole number, the most items drawn.
  const n = Number(q);
  return [...modeChoices(mode, q), ...(Number.isInteger(n) && n >= 1 ? [{ kind: 'Limit', label: String(n), note: '', title: `Draw at most ${n} items`, limit: n }] : [])];
}
