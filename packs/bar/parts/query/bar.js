// The query in find (decisions e_sdsaxxq4, e_2a4mddx8), as the bar pack's two parts (task e_yxkdcdh6; was
// ui/query-bar.js and the modules beside it): the lens the canvas draws, said in one line in find (./line.js, slot
// bar.find), and while find is open a row for each of its parts above it (./rows.js, slot bar.find.rows), each saying
// what it is in a word (decision e_drt4g872): Find (any of its terms adds), Only (all must hold), Not (left out of
// everything, the walk's reach included), Walk (the links it follows, each its own way, and how many steps) and the
// limit. A term's × takes it out; a row's + offers its kinds, then the things of that kind (./kinds.js), never words
// taken for a term, those used on this canvas first (./rank.js). Every change is a new lens, named to the page as its
// address (`go`), which the canvas checks and draws. No term or part is a box inside a box (rule e_vgs9vt5j).
//
// Each is handed the canvas's lens (Home's when no query is up), the answer in brief, the names of the items the lens
// names, the schema's words and the style's numbers. A term of Find lights what it brought (`lights`), and what does
// not fit in a line is counted by the host (`fits`).

import { ranked, uses } from './rank.js';
import { litBy } from './lit-by.js';
import { findKinds, onlyKinds } from './kinds.js';
import { ARROW, MEANT, NEXT_WAY, TONE, added, inOrder, namer, notOf, sortOf, wayOf, withWay, without } from './terms.js';

const BLANK = { filter: {}, walk: { over: [], steps: 0 } };
/** How many choices a pick holds: the host takes 200 values, one of them the pick's own word. */
const CHOICES = 199;
/** How many names of items the part keeps between pages. */
const NAMES = 200;
/** How many items a term lights: the host takes 200. */
const LIT = 200;
const ITEM = /^e_[a-z0-9]{8}$/;
const cut = (s, n = 200) => String(s ?? '').slice(0, n);
const PARTS = { find: 'Find', only: 'Only', not: 'Not' };
const WAY_TIP = { either: 'Either way along this link', out: 'Out along this link, from what it starts at', in: 'In along this link, to what it starts at' };

/** The state a mounted part keeps: what is being added, the names it knows, a word refused. */
export const fresh = (input) => ({ input, adding: null, wrong: false, names: new Map(Object.entries({ ...(input?.kept?.names ?? {}), ...(input?.names ?? {}) }).filter(([, v]) => typeof v === 'string')) });

/**
 * What the bar reads of its input: the lens (the slot's, Home's when no query is up, else the address's), whether it
 * is Home's, how many were drawn, and the answer in brief.
 */
function read(input) {
  const address = input?.address ?? null;
  const lens = input?.query ?? address?.query ?? null;
  const answer = input?.answer ?? null;
  const drawn = address?.drawn ?? (answer?.items && { count: answer.items.length, ...(answer.cut && { cut: true }) }) ?? null;
  return { lens, home: input?.home ?? !address?.query, drawn, answer, words: input?.words ?? { types: {}, links: {} }, numbers: input?.style?.numbers ?? {} };
}

/** The kinds a part's + offers, ranked by what this canvas uses. */
function kindsFor(part, s) {
  const { lens, answer, words, numbers } = read(s.input);
  const f = (lens ?? BLANK).filter ?? {};
  const here = answer ? uses(answer.items, answer.links) : { types: new Map(), links: new Map() };
  const types = ranked(Object.entries(words.types ?? {}).filter(([id]) => !id.startsWith('sys.')).map(([id, t]) => ({ id, title: t.title ?? id })), here.types);
  const links = ranked(Object.entries(words.links ?? {}).filter(([id]) => !id.startsWith('sys.')).map(([id, title]) => ({ id, title: title ?? id })), here.links);
  if (part === 'find') return findKinds({ types, links });
  const typesNamed = [...(f.find ?? []), ...(f.only ?? [])].filter((t) => t.startsWith('type ')).map((t) => t.slice(5));
  const statuses = [...new Set([...(answer?.items ?? []).map((i) => i.status), ...typesNamed.flatMap((t) => [...(words.types?.[t]?.open ?? []), ...(words.types?.[t]?.closed ?? [])])])].filter(Boolean);
  const days = ['only_since_short', 'only_since_days', 'only_since_long'].map((n) => numbers[n]).filter(Number.isFinite);
  return onlyKinds({ types, links, label: PARTS[part], have: part === 'not' ? notOf(f) : (f[part] ?? []), statuses, days: days.length ? days : [1, 7, 30] });
}

/** What the walk's + offers: every link, or one more link type, those used here first. */
function walkKinds(s) {
  const { lens, answer, words } = read(s.input);
  const { over = [], steps = 0 } = (lens ?? BLANK).walk ?? {};
  const walked = over === 'all' ? [] : over;
  const here = answer ? uses(answer.items, answer.links) : { links: new Map() };
  const links = ranked(Object.entries(words.links ?? {}).filter(([id]) => !id.startsWith('sys.') && !walked.some((t) => wayOf(t).link === id)).map(([id, title]) => ({ id, title: title ?? id })), here.links);
  return {
    label: 'Walk',
    choices: [
      ...(over === 'all' ? [] : [{ id: 'all', label: 'every link', tip: 'Every link, either way', walk: { over: 'all', steps: steps || 1 } }]),
      ...links.map((r) => ({ id: r.id, label: r.title, tip: 'Along this link, either way: its arrow turns it', walk: { over: [...walked, r.id], steps: steps || 1 } })),
    ],
  };
}

/** What a term of Find lit on the canvas while it is pointed at: what it brought, or nothing without the answer. */
function litOf(answer, part, t) {
  return part === 'find' && answer?.items ? [...litBy(answer, t)].filter((id) => ITEM.test(id)) : null;
}

/**
 * The line in find: each part of the lens by its row's word and its terms, as many as fit (the host counts the rest),
 * a term of Find lighting what it brought; and how many are drawn. Pressed, find opens (ui/find.js holds the row).
 */
function lineOf(s, said) {
  const { lens, drawn, answer } = read(s.input);
  const f = lens?.filter ?? {};
  const { over = [], steps = 0 } = lens?.walk ?? {};
  const word = (w) => ['text', { look: 'muted', bold: true }, w];
  const terms = (part, list) => inOrder(list).map((t) => {
    const lit = litOf(answer, part, t);
    return ['text', { tip: cut(said.termSaid(t)), ...(lit?.length && { lights: lit.slice(0, LIT) }) }, cut(said.termSaid(t), 80)];
  });
  // Find's terms are joined by "or" (any of them adds), the others' by commas (all must hold), as the line said them.
  const or = (list) => list.flatMap((m, i) => (i ? [['text', { look: 'muted' }, 'or'], m] : [m]));
  const comma = (list) => list.map((m, i) => (i < list.length - 1 ? [m[0], m[1], `${m[2]},`] : m));
  const out = notOf(f).filter((t) => t !== 'kind system');
  const walked = over === 'all' ? ['every link'] : over.map(said.waySaid);
  const parts = [
    ...(f.find?.length ? [word('Find'), ...or(terms('find', f.find))] : []),
    ...(f.only?.length ? [word('Only'), ...comma(terms('only', f.only))] : []),
    ...(out.length ? [word('Not'), ...comma(terms('not', out))] : []),
    ...(walked.length && steps > 0 ? [word('Walk'), ...comma(walked.map((w) => ['text', {}, cut(w, 80)]))] : []),
  ];
  const limit = lens?.limit ?? '';
  const count = drawn ? [['text', { look: 'muted', size: 2, ...(drawn.cut && { tone: 'warn' }), tip: drawn.cut ? 'The limit cut what the lens finds' : 'Items drawn, of the limit' }, `${drawn.count ?? 0}${drawn.cut ? '+' : ''}${limit ? ` of ${limit}` : ''}`]] : [];
  const failed = answer?.failed ? [['text', { tone: 'bad', tip: cut(answer.failed) }, '!']] : [];
  return ['box', { flow: 'row', gap: 3, align: 'between', tip: cut(lens?.said ? `${lens.said}: change it` : 'Find on the map') },
    parts.length ? ['box', { flow: 'row', gap: 2, fits: true, grow: true }, ...parts] : ['text', { look: 'muted' }, 'Find on the map'],
    // The walk's steps stand past what fits, so they are never what is cut.
    ...(walked.length && steps > 0 ? [['text', { look: 'muted' }, `×${steps}`]] : []),
    ...count, ...failed];
}

/** A term: its words, toned by its sort, and an × to take it away. */
function termMark(s, said, part, t, i) {
  const { answer } = read(s.input);
  const lit = litOf(answer, part, t);
  // Its own words first, so a count of what did not fit names what it holds; then what such a term finds, and how many it drew.
  const tip = `${said.termSaid(t)}: ${MEANT[sortOf(t)] ?? ''}${lit === null ? '' : `, ${lit.length} drawn`}`;
  const sort = sortOf(t);
  const tone = part === 'not' ? 'muted' : part === 'only' ? 'warn' : TONE[sort];
  // Pointing at a term of Find lights what it brought on the canvas (was ui/query-light.js): the host does it.
  return ['box', { flow: 'row', gap: 1, tip: cut(tip), ...(lit?.length && { lights: lit.slice(0, LIT) }) },
    ['text', { ...(tone && { tone }) }, cut(said.termSaid(t))],
    ['button', { key: `x:${part}:${i}`, look: 'quiet', tip: 'Take it out', label: cut(`Take out ${said.termSaid(t)}`) }, '×']];
}

/** What a row's + offers, as far as the person has gone: one step for each kind picked, then the last step's own. */
export function stepsOf(s, part) {
  const path = s.adding?.part === part ? s.adding.path : [];
  const steps = [part === 'walk' ? walkKinds(s) : kindsFor(part, s)];
  for (const id of path) {
    const next = steps.at(-1).choices.find((c) => c.id === id)?.next;
    if (!next) break;
    steps.push(next());
  }
  return steps;
}

/** How many choices the menu lists before it offers a field to narrow them. */
const NARROW_FROM = 8;

/**
 * A row's +: a menu (decision e_45sgrfqd; was ui/term-pick.js). Each step that leads on is a pick, so choosing a kind
 * keeps the menu open and draws its things under it; the last step's things are buttons, each adding its term (and
 * shutting the menu), narrowed by a field when there are many, or what may be written, or an item found by name.
 */
function plusMenu(s, part, word) {
  const adding = s.adding?.part === part ? s.adding : { path: [], q: '' };
  const steps = stepsOf(s, part);
  const last = steps.at(-1);
  const q = adding.q.toLowerCase();
  const finals = last.choices.map((c, i) => [c, i]).filter(([c]) => !c.next && (!q || c.label.toLowerCase().includes(q)));
  const many = last.choices.filter((c) => !c.next).length > NARROW_FROM;
  const picks = steps.map((step, d) => {
    const on = step.choices.filter((c) => c.next).slice(0, CHOICES);
    return on.length ? [['input', { key: `kind:${part}:${d}`, kind: 'pick', label: cut(step.label), tip: cut(step.label), values: ['', ...on.map((c) => cut(c.id))], names: [`${cut(step.label, 60)}…`, ...on.map((c) => cut(c.label))], value: cut(adding.path[d] ?? '') }]] : [];
  }).flat();
  return ['menu', { key: `add:${part}`, label: '+', look: 'quiet', tip: cut(`${word}: add a term`) },
    ['text', { look: 'muted', bold: true }, cut(last.label, 60)],
    ...picks,
    ...(last.typed ? [['input', { key: `typed:${part}`, kind: 'text', label: cut(last.label), hint: cut(last.typed.hint), tip: cut(last.typed.tip), focus: true }]] : []),
    ...(last.search ? [['input', { key: `item:${part}`, kind: 'item', label: cut(last.label), hint: cut(last.search.hint), ...(last.search.types && { types: last.search.types }), focus: true }]] : []),
    // A plain field, not a search box: find's own box is the one search box in find (tests and the keyboard look for it so).
    ...(!last.typed && !last.search && many ? [['input', { key: `narrow:${part}`, kind: 'text', label: 'Find a choice', hint: 'Find a choice', value: cut(adding.q), focus: true }]] : []),
    ...(s.wrong && s.adding?.part === part ? [['text', { tone: 'bad', size: 2 }, 'Not what this takes']] : []),
    ['list', { look: 'rows' }, ...finals.slice(0, CHOICES).map(([c, i]) => ['button', { key: `choice:${part}:${i}`, look: 'quiet', tip: cut(c.tip ?? c.label) }, cut(c.label)])],
  ];
}

/**
 * A row of the editor: its word, its terms as many as fit (the host counts the rest; pressed, the count shows them all,
 * each with its ×, until pressed again), and its own +.
 */
function row(s, key, word, tip, terms, extra = []) {
  const all = s.expanded === key;
  return ['box', { flow: 'row', gap: 3, tip: cut(tip) },
    ['text', { look: 'muted', bold: true, tip: cut(tip) }, word],
    all
      ? ['box', { flow: 'row', gap: 2, wrap: true, grow: true }, ...terms, ['button', { key: `more:${key}`, look: 'quiet', tip: 'Fewer' }, '‹']]
      : ['box', { flow: 'row', gap: 2, fits: true, more: `more:${key}`, grow: true }, ...terms],
    plusMenu(s, key, word),
    ...extra];
}

/** The rows: Find, Only, Not, Walk and the limit. */
function rowsOf(s, said) {
  const { lens, drawn } = read(s.input);
  const l = lens ?? BLANK;
  const f = l.filter ?? {};
  const terms = (part, list) => inOrder(list).map((t, i) => termMark(s, said, part, t, i));
  const { over = [], steps = 0 } = l.walk ?? {};
  const walked = over === 'all' ? [] : over;
  const walking = over === 'all' || walked.length > 0;
  const walkTerms = over === 'all'
    ? [['box', { flow: 'row', gap: 1, tip: 'Every link, either way' }, ['text', {}, 'every link'], ['button', { key: 'wx:all', look: 'quiet', tip: 'Take it out', label: 'Take out every link' }, '×']]]
    : walked.map((t, i) => {
      const w = wayOf(t);
      return ['box', { flow: 'row', gap: 1, tip: WAY_TIP[w.way] },
        ['button', { key: `way:${i}`, look: 'quiet', tip: `${WAY_TIP[w.way]}: turn it` }, ARROW[w.way]],
        ['text', {}, cut(said.linkTitle(w.link))],
        ['button', { key: `wx:${i}`, look: 'quiet', tip: 'Take it out', label: cut(`Take out ${said.linkTitle(w.link)}`) }, '×']];
    });
  const stepper = walking ? [['box', { flow: 'row', gap: 1, tip: 'How many steps the walk takes' },
    ['button', { key: 'steps:less', look: 'quiet', tip: 'One step fewer' }, '−'],
    ['text', {}, `×${steps}`],
    ['button', { key: 'steps:more', look: 'quiet', tip: 'One step more' }, '+']]] : [];
  const limit = l.limit ?? '';
  return ['list', { look: 'rows', gap: 1 },
    row(s, 'find', 'Find', 'What any of these finds is drawn', terms('find', f.find ?? [])),
    row(s, 'only', 'Only', 'What Find finds must all be so', terms('only', f.only ?? [])),
    row(s, 'not', 'Not', 'Left out of everything, what the walk reaches included', terms('not', notOf(f))),
    row(s, 'walk', 'Walk', 'From what Find finds, along these links, each its own way', walkTerms, stepper),
    ['box', { flow: 'row', gap: 3, tip: 'The limit: the most items drawn' },
      ['text', { look: 'muted', bold: true }, 'Limit'],
      ['input', { key: 'limit', kind: 'number', value: String(limit), label: 'The most items drawn', tip: 'The most items drawn' }],
      ...(drawn ? [['text', { look: 'muted', size: 2 }, `${drawn.count ?? 0}${drawn.cut ? '+' : ''} drawn`]] : [])],
  ];
}

/** The words the part names things by: the schema's, and the names it was handed or found. */
const saidFor = (s) => namer(read(s.input).words, s.names);
/** What bar.query draws: the line. */
export const lineMarks = (s) => lineOf(s, saidFor(s));
/** What bar.rows draws: the rows. */
export const rowsMarks = (s) => rowsOf(s, saidFor(s));

/**
 * What a gesture does to the bar: the state it leaves, and the lens to go to, if any. Plain, so a test runs it: `s` the
 * state, `event` what the host told ({ key, name, value }).
 */
export function heard(s, event) {
  const { lens } = read(s.input);
  const l = lens ?? BLANK;
  const key = String(event?.key ?? '');
  const name = event?.name;
  const [head, a, b] = key.split(':');
  const done = (next) => ({ ...s, adding: null, wrong: false, go: next });
  const f = l.filter ?? {};
  const { over = [], steps = 0 } = l.walk ?? {};
  const walked = over === 'all' ? [] : over;
  const walk = (change) => done({ ...l, walk: { over, steps, ...change } });
  if (head === 'x' && name === 'press') {
    const list = inOrder(a === 'not' ? notOf(f) : (f[a] ?? []));
    const value = list[Number(b)];
    return value === undefined ? s : { ...done(without(l, a, value)), move: { take: { part: a, value } } };
  }
  if (head === 'wx' && name === 'press') {
    if (a === 'all') return walk({ over: [], steps: 0 });
    const t = walked[Number(a)];
    return t === undefined ? s : walk({ over: walked.filter((o) => o !== t), steps: walked.length > 1 ? steps : 0 });
  }
  if (head === 'way' && name === 'press') {
    const t = walked[Number(a)];
    if (t === undefined) return s;
    const w = wayOf(t);
    return walk({ over: walked.map((o) => (o === t ? withWay(w.link, NEXT_WAY[w.way]) : o)) });
  }
  if (head === 'steps' && name === 'press') return a === 'less' ? (steps > 1 ? walk({ steps: steps - 1 }) : s) : walk({ steps: steps + 1 });
  if (head === 'limit' && name === 'submit') {
    const n = Number(event.value);
    return n >= 1 ? done({ ...l, limit: Math.round(n) }) : s;
  }
  // What a row's + does: `a` is the row's part, `b` the step a pick is at.
  // A row's count of what did not fit, pressed: the row shows all its terms until pressed again.
  if (head === 'more' && name === 'press') return { ...s, expanded: s.expanded === a ? null : a };
  if (!['find', 'only', 'not', 'walk'].includes(a)) return s;
  const mine = s.adding?.part === a ? s.adding : { part: a, path: [], q: '' };
  if (head === 'kind' && name === 'pick') {
    const at = Number(b);
    const path = [...mine.path.slice(0, at), ...(event.value ? [String(event.value)] : [])];
    return { ...s, wrong: false, adding: { part: a, path, q: '' } };
  }
  if (head === 'narrow' && name === 'edit') return { ...s, adding: { ...mine, q: cut(event.value, 80) } };
  const last = stepsOf(s, a).at(-1);
  // A term is added by the runtime to the lens the canvas holds (`move`), not to this part's copy of it, which a hand
  // arriving late can leave behind; `go` is the lens it names, as a test reads it.
  const add = (term) => (a === 'walk' ? done(added(l, { [a]: term })) : { ...done(added(l, { [a]: term })), move: { add: { [a]: term } } });
  if (head === 'choice' && name === 'press') {
    const choice = last.choices[Number(b)];
    if (!choice || choice.next) return s;
    return choice.walk ? walk(choice.walk) : add(choice.term);
  }
  if (head === 'typed' && name === 'submit' && last.typed) {
    const term = last.typed.term(String(event.value ?? '').trim());
    return term ? add(term) : { ...s, wrong: true, adding: mine };
  }
  if (head === 'item' && name === 'pick' && last.search && typeof event.value?.id === 'string') {
    const names = new Map(s.names).set(event.value.id, cut(event.value.title, 120));
    return { ...add(last.search.term(event.value.id)), names, keepNames: true };
  }
  return s;
}

/** A part of the bar that draws with `draw` (lineMarks or rowsMarks): handed the lens as it moves, it answers gestures with a new lens. */
export function barPart(draw) {
  return function part(input, tools) {
    let s = fresh(input);
    return {
      marks: draw(s),
      update(next) {
        s = { ...s, input: next, names: new Map([...s.names, ...Object.entries(next?.names ?? {}).filter(([, v]) => typeof v === 'string')]) };
        return draw(s);
      },
      on(event) {
        const next = heard(s, event);
        if (next === s) return undefined;
        const { go, move, keepNames, ...rest } = next;
        s = rest;
        if (keepNames) tools?.keep?.(Object.fromEntries([...s.names].slice(-NAMES)), 'names');
        // A term in or out is said as that (`move`), so the runtime applies it to the lens the canvas holds: this part's
        // copy can be a hand behind. Only what has no term to say (the walk's steps, the limit) names a whole lens.
        if (move) tools?.go?.(move);
        else if (go) tools?.go?.({ query: go });
        return draw(s);
      },
    };
  };
}
