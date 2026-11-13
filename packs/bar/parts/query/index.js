// The query in find (decisions e_sdsaxxq4, e_2a4mddx8), as the bar pack's part (task e_yxkdcdh6; was ui/query-bar.js
// and the modules beside it): the lens the canvas draws, said in one line, and pressed, a row for each of its parts,
// each saying what it is in a word (decision e_drt4g872): Find (any of its terms adds), Only (all must hold), Not (left
// out of everything, the walk's reach included), Walk (the links it follows, each its own way, and how many steps) and
// the limit. A term's × takes it out; a row's + offers its kinds, then the things of that kind (./kinds.js), never
// words taken for a term, those used on this canvas first (./rank.js). Every change is a new lens, named to the page
// as its address (`go`), which the canvas checks and draws. No term or part is a box inside a box (rule e_vgs9vt5j).
//
// It is handed the page's address (the lens, how many it drew), the schema's words and the style's numbers; where the
// host hands the answer too (`answer`: items and links), it ranks by what is used here and says what a term brought.

import { ranked, uses } from './rank.js';
import { litBy } from './lit-by.js';
import { findKinds, onlyKinds } from './kinds.js';
import { ARROW, MEANT, NEXT_WAY, TONE, added, inOrder, namer, notOf, sortOf, wayOf, withWay, without } from './terms.js';

const BLANK = { filter: {}, walk: { over: [], steps: 0 } };
/** How many choices a pick holds: the host takes 200 values, one of them the pick's own word. */
const CHOICES = 199;
/** How many names of items the part keeps between pages. */
const NAMES = 200;
const cut = (s, n = 200) => String(s ?? '').slice(0, n);
const PARTS = { find: 'Find', only: 'Only', not: 'Not' };
const WAY_TIP = { either: 'Either way along this link', out: 'Out along this link, from what it starts at', in: 'In along this link, to what it starts at' };

/** The state a mounted bar keeps: whether its rows are open, what is being added, the names it knows, a word refused. */
const fresh = (input) => ({ input, open: false, adding: null, wrong: false, names: new Map(Object.entries({ ...(input?.kept?.names ?? {}), ...(input?.names ?? {}) }).filter(([, v]) => typeof v === 'string')) });

/** What the bar reads of its input: the lens (none on Home), how many were drawn, and the answer where it is handed. */
function read(input) {
  const address = input?.address ?? null;
  const lens = address?.query ?? null;
  return { lens, home: !lens, drawn: address?.drawn ?? null, answer: input?.answer ?? null, words: input?.words ?? { types: {}, links: {} }, numbers: input?.style?.numbers ?? {} };
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

/** The line: the lens in one line, each part by its row's word, and how many are drawn. */
function lineMarks(s, said) {
  const { lens, drawn, home } = read(s.input);
  const f = lens?.filter ?? {};
  const { over = [], steps = 0 } = lens?.walk ?? {};
  const walked = over === 'all' ? ['every link'] : over.map(said.waySaid);
  const parts = [
    f.find?.length > 0 && `Find ${inOrder(f.find).map(said.termSaid).join(' or ')}`,
    f.only?.length > 0 && `Only ${inOrder(f.only).map(said.termSaid).join(', ')}`,
    notOf(f).filter((t) => t !== 'kind system').length > 0 && `Not ${inOrder(notOf(f).filter((t) => t !== 'kind system')).map(said.termSaid).join(', ')}`,
    walked.length > 0 && steps > 0 && `Walk ${walked.join(', ')} ×${steps}`,
  ].filter(Boolean);
  const words = parts.length ? parts.join(' · ') : 'Find on the map';
  const limit = lens?.limit ?? '';
  const count = drawn && !home ? [['text', { look: 'muted', size: 2, ...(drawn.cut && { tone: 'warn' }), tip: drawn.cut ? 'The limit cut what the lens finds' : 'Items drawn, of the limit' }, `${drawn.count ?? 0}${drawn.cut ? '+' : ''}${limit ? ` of ${limit}` : ''}`]] : [];
  return ['box', { flow: 'row', gap: 3, align: 'between' },
    ['button', { key: 'line', look: 'quiet', tip: cut(parts.length ? `${words}: change it` : 'Find on the map') }, cut(words)],
    ...count];
}

/** A term: its words, toned by its sort, and an × to take it away. */
function termMark(s, said, part, t, i) {
  const { answer } = read(s.input);
  const brought = part === 'find' && answer?.items ? litBy(answer, t).size : null;
  const tip = `${MEANT[sortOf(t)] ?? ''}${brought === null ? '' : `: ${brought} drawn`}`;
  const sort = sortOf(t);
  const tone = part === 'not' ? 'muted' : part === 'only' ? 'warn' : TONE[sort];
  return ['box', { flow: 'row', gap: 1, tip: cut(tip) },
    ['text', { ...(tone && { tone }) }, cut(said.termSaid(t))],
    ['button', { key: `x:${part}:${i}`, look: 'quiet', tip: 'Take it out' }, '×']];
}

/** What is being added to a row, drawn in it after its +: the step's choices, what may be written, an item found by name. */
function addingMarks(s) {
  const steps = s.adding.steps;
  const step = steps.at(-1);
  const depth = steps.length;
  const choices = step.choices.slice(0, CHOICES);
  return [
    ...(depth > 1 ? [['button', { key: 'back', look: 'quiet', tip: 'Back' }, `‹ ${cut(step.label, 60)}`]] : []),
    ...(choices.length ? [['input', { key: `pick:${depth}`, kind: 'pick', label: cut(step.label), tip: cut(step.label), values: ['', ...choices.map((c) => cut(c.id))], names: [`${cut(step.label, 60)}…`, ...choices.map((c) => cut(c.label))], focus: true }]] : []),
    ...(step.typed ? [['input', { key: `typed:${depth}`, kind: 'text', label: cut(step.label), hint: cut(step.typed.hint), tip: cut(step.typed.tip), focus: !choices.length }]] : []),
    ...(step.search ? [['input', { key: `search:${depth}`, kind: 'item', label: cut(step.label), hint: cut(step.search.hint), ...(step.search.types && { types: step.search.types }), focus: !choices.length && !step.typed }]] : []),
    ...(s.wrong ? [['text', { tone: 'bad', size: 2 }, 'Not what this takes']] : []),
    ['button', { key: 'cancel', look: 'quiet', tip: 'Leave it' }, '×'],
  ];
}

/** A row of the editor: its word, its terms, its own + and, while something is added to it, that. */
function row(s, key, word, tip, terms, extra = []) {
  return ['box', { flow: 'row', gap: 3, tip: cut(tip) },
    ['text', { look: 'muted', bold: true, tip: cut(tip) }, word],
    ['box', { flow: 'row', gap: 2, wrap: true, grow: true },
      ...terms,
      ['button', { key: `add:${key}`, look: 'quiet', tip: cut(`${word}: add a term`) }, '+'],
      ...(s.adding?.part === key ? addingMarks(s) : [])],
    ...extra];
}

/** The rows: Find, Only, Not, Walk and the limit. */
function rowsMarks(s, said) {
  const { lens, drawn } = read(s.input);
  const l = lens ?? BLANK;
  const f = l.filter ?? {};
  const terms = (part, list) => inOrder(list).map((t, i) => termMark(s, said, part, t, i));
  const { over = [], steps = 0 } = l.walk ?? {};
  const walked = over === 'all' ? [] : over;
  const walking = over === 'all' || walked.length > 0;
  const walkTerms = over === 'all'
    ? [['box', { flow: 'row', gap: 1, tip: 'Every link, either way' }, ['text', {}, 'every link'], ['button', { key: 'wx:all', look: 'quiet', tip: 'Take it out' }, '×']]]
    : walked.map((t, i) => {
      const w = wayOf(t);
      return ['box', { flow: 'row', gap: 1, tip: WAY_TIP[w.way] },
        ['button', { key: `way:${i}`, look: 'quiet', tip: `${WAY_TIP[w.way]}: turn it` }, ARROW[w.way]],
        ['text', {}, cut(said.linkTitle(w.link))],
        ['button', { key: `wx:${i}`, look: 'quiet', tip: 'Take it out' }, '×']];
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

/** Everything the part draws: the line, and its rows while open. */
export function barMarks(s) {
  const { words } = read(s.input);
  const said = namer(words, s.names);
  return ['box', { flow: 'column', gap: 2 }, lineMarks(s, said), ...(s.open ? [rowsMarks(s, said)] : [])];
}

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
  if (head === 'line' && name === 'press') return { ...s, open: !s.open, adding: null, wrong: false };
  if (head === 'add' && name === 'press') return s.adding?.part === a ? { ...s, adding: null } : { ...s, wrong: false, adding: { part: a, steps: [a === 'walk' ? walkKinds(s) : kindsFor(a, s)] } };
  if (head === 'cancel' || (head === 'search' && name === 'leave')) return { ...s, adding: null, wrong: false };
  if (head === 'back' && s.adding) return { ...s, wrong: false, adding: { ...s.adding, steps: s.adding.steps.slice(0, -1) } };
  if (head === 'x' && name === 'press') {
    const list = inOrder(a === 'not' ? notOf(f) : (f[a] ?? []));
    return list[Number(b)] === undefined ? s : done(without(l, a, list[Number(b)]));
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
  if (!s.adding) return s;
  const step = s.adding.steps.at(-1);
  const part = s.adding.part;
  const add = (term) => done(added(l, { [part]: term }));
  if (head === 'pick' && name === 'pick') {
    const choice = step.choices.find((c) => c.id === event.value);
    if (!choice) return s;
    if (choice.next) return { ...s, wrong: false, adding: { ...s.adding, steps: [...s.adding.steps, choice.next()] } };
    if (choice.walk) return walk(choice.walk);
    return add(choice.term);
  }
  if (head === 'typed' && name === 'submit' && step.typed) {
    const term = step.typed.term(String(event.value ?? '').trim());
    return term ? add(term) : { ...s, wrong: true };
  }
  if (head === 'search' && name === 'pick' && step.search && typeof event.value?.id === 'string') {
    const names = new Map(s.names).set(event.value.id, cut(event.value.title, 120));
    return { ...add(step.search.term(event.value.id)), names, keepNames: true };
  }
  return s;
}

export default function query(input, tools) {
  let s = fresh(input);
  return {
    marks: barMarks(s),
    update(next) {
      s = { ...s, input: next, names: new Map([...s.names, ...Object.entries(next?.names ?? {}).filter(([, v]) => typeof v === 'string')]) };
      return barMarks(s);
    },
    on(event) {
      const next = heard(s, event);
      if (next === s) return undefined;
      const { go, keepNames, ...rest } = next;
      s = rest;
      if (keepNames) tools?.keep?.(Object.fromEntries([...s.names].slice(-NAMES)), 'names');
      if (go) tools?.go?.({ query: go });
      return barMarks(s);
    },
  };
}
