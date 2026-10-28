// The query bar: the canvas's lens, always in sight and plain to read, on one row under the view's (decision
// e_sdsaxxq4). Its parts each say what they are in a word: the filter (text, types, tags, items, links; and what narrows
// them, only a type, within an item), what is left out, the walk (the links it follows, how many steps) and the limit.
// Each part shows its first terms and how many more, all of them a click away, and has its own + that opens one menu
// (ui/term-pick.js) to add to it; a term's words open it again to change that term, its × takes it away. Every change
// is a new lens, handed to `go` (the canvas puts it in the address and draws it). The menus lead with what this canvas
// and its neighbourhood use (ui/picker-rank.js). No term or part is a box inside a box (rule e_vgs9vt5j).

import { api, h, state } from './base.js';
import { numberOf } from './lens-base.js';
import { ranked, around, uses } from './picker-rank.js';
import { pickTerm } from './term-pick.js';
import { relations, titles, typeTitle, types } from './words.js';

const bar = document.getElementById('query');
/** Items the bar has asked the names of, so each is asked once. */
const asking = new Set();
/** What is used one step around the canvas, asked once for each lens (`key`), and the bar drawn last. */
let near = { key: '', uses: null };
let last = null;

/**
 * Ask what is used one step around what the canvas draws, and draw the bar again with it: once for each lens, so what
 * the log brings to the canvas later is never a read of its own (the page is a replica, docs/canvas.md).
 */
function lookAround(lens, answer) {
  const ids = answer.items.map((i) => i.id).slice(0, numberOf(state.style, 'picker_around_from'));
  const key = JSON.stringify([lens.filter, lens.walk, lens.limit]);
  if (!ids.length || key === near.key) return;
  near = { key, uses: null };
  const exclude = lens.filter.exclude;
  api('view', { name: 'flat', params: { filter: { ids, ...(exclude && { exclude }) }, walk: { over: 'all', steps: 1 }, limit: numberOf(state.style, 'picker_around_most') } })
    .then((wider) => near.key === key && ((near.uses = around(answer, wider)), last && drawQuery(...last)))
    .catch(() => {});
}

/** Choices in groups by where they are used, once anything is used here or around; else one group. */
function groupsOf(list, item) {
  if (!list.some((d) => d.near)) return [{ label: '', items: list.map(item) }];
  return [['Here', 'here'], ['Around', 'around'], ['Other', undefined]].map(([label, where]) => ({ label, items: list.filter((d) => d.near === where).map(item) })).filter((g) => g.items.length);
}

const isId = (s) => /^e_[a-z0-9]{8}$/.test(s);
/** A type by its id or its title, any case. */
const typeNamed = (s) => (types.has(s) ? s : [...types.values()].find((t) => !t.dormant && t.title.toLowerCase() === s.toLowerCase())?.id);
/** A link type by its id or its title, any case. */
const linkNamed = (s) => (relations.has(s) ? s : [...relations.values()].find((r) => r.title?.toLowerCase() === s.toLowerCase())?.id);
const linkTitle = (id) => relations.get(id)?.title ?? id.replaceAll('_', ' ');
/** An item named by its title, once the page knows it; until then a mark, and the name asked for. */
function nameOf(id, redraw) {
  if (titles.has(id)) return titles.get(id);
  if (!asking.has(id)) {
    asking.add(id);
    api('get', { id }).then((got) => (titles.set(id, got.entity.title), redraw())).catch(() => {});
  }
  return '…';
}

/** What a term written in the box is: `-x` leaves x out, `only <type>` and `within <id>` narrow, an id is an item, `#name` a tag, `<link> <end>` a link, a type by its name, else text. */
function termOf(written) {
  const s = written.trim();
  if (!s) return null;
  if (/^[-−]/.test(s)) {
    const x = s.slice(1).trim();
    const left = ['closed', 'system'].includes(x.toLowerCase()) ? x.toLowerCase() : typeNamed(x);
    return left ? { exclude: left } : null;
  }
  if (isId(s)) return { id: s };
  if (s.startsWith('#') && relations.has('tagged') && s.slice(1).trim()) return { link: `tagged ${s.slice(1).trim()}` };
  const [, first, rest] = /^(\S+)\s+(.+)$/.exec(s) ?? [];
  if (first?.toLowerCase() === 'only') return typeNamed(rest.trim()) ? { only: typeNamed(rest.trim()) } : null;
  if (first?.toLowerCase() === 'within') return isId(rest.trim()) ? { within: rest.trim() } : null;
  if (first && linkNamed(first)) return { link: `${linkNamed(first)} ${rest.trim()}` };
  if (typeNamed(s)) return { type: typeNamed(s) };
  return { text: s };
}

/** The lens with one term added to its filter. */
function added(lens, term) {
  const f = { ...lens.filter };
  if (term.text) f.text = term.text;
  if (term.type) f.types = [...new Set([...(f.types ?? []), term.type])];
  if (term.id) f.ids = [...new Set([...(f.ids ?? []), term.id])];
  if (term.link) f.links = [...new Set([...(f.links ?? []), term.link])];
  if (term.only) f.only = [...new Set([...(f.only ?? []), term.only])];
  if (term.within) f.within = [...new Set([...(f.within ?? []), term.within])];
  if (term.exclude) f.exclude = [...new Set([...(f.exclude ?? ['system']), term.exclude])];
  return { ...lens, filter: f };
}

/** The lens with one of its filter's terms taken out: `field` and the value it holds. */
function without(lens, field, value) {
  const f = { ...lens.filter };
  if (field === 'text') delete f.text;
  else f[field] = (f[field] ?? (field === 'exclude' ? ['system'] : [])).filter((v) => v !== value);
  if (field !== 'exclude' && !f[field]?.length) delete f[field];
  return { ...lens, filter: f };
}

/** A link term in words: a tag by its name with a #, any other link by its title and its end's name. */
function termWords(term, redraw) {
  const [, link, end] = /^(\S+)\s+(.+)$/.exec(term) ?? [null, term, ''];
  const endName = end === 'me' ? 'me' : isId(end) ? nameOf(end, redraw) : end;
  return link === 'tagged' ? `#${endName}` : `${linkTitle(link)} ${endName}`;
}

/** The filter's link terms but tags, by their link type, in order. */
function linkGroups(links) {
  const groups = new Map();
  for (const t of links.filter((l) => !l.startsWith('tagged '))) {
    const link = /^(\S+)/.exec(t)?.[1] ?? t;
    (groups.get(link) ?? groups.set(link, []).get(link)).push(t);
  }
  return groups;
}

/** What the filter finds, in a few words: each kind of term once, a second of the same counted ("is part of Server +3"). A tab is named by it (ui/tab-bar.js). */
export function filterSaid(f, redraw) {
  const some = (list, one, many) => (list?.length ? (list.length === 1 ? one(list[0]) : many(list)) : null);
  const tags = (f.links ?? []).filter((t) => t.startsWith('tagged '));
  return [
    f.text && `“${f.text}”`,
    some(f.types, typeTitle, (l) => `${l.length} types`),
    some(tags, (t) => termWords(t, redraw), (l) => `${termWords(l[0], redraw)} +${l.length - 1}`),
    ...[...linkGroups(f.links ?? []).values()].map((l) => `${termWords(l[0], redraw)}${l.length > 1 ? ` +${l.length - 1}` : ''}`),
    some(f.ids, (id) => nameOf(id, redraw), (l) => `${l.length} items`),
    some(f.only, (t) => `only ${typeTitle(t)}`, (l) => `only ${l.length} types`),
    some(f.within, (id) => `within ${nameOf(id, redraw)}`, (l) => `within ${l.length} items`),
  ].filter(Boolean).join(' · ');
}

/** Draw the bar for this lens, over the view that draws it (its answer names what the lens names); `lead` goes first (the saved canvas up, ui/canvases.js). */
export function drawQuery(lens, view, go, lead) {
  if (!bar) return;
  const redraw = () => drawQuery(lens, view, go, lead);
  last = [lens, view, go, lead];
  const f = lens.filter;
  const answer = view?.answer;
  if (answer) lookAround(lens, answer);
  const here = uses(answer?.items, answer?.links);
  const exclude = f.exclude ?? ['system'];
  const filled = (lens.filter.text || lens.filter.types?.length || lens.filter.ids?.length || lens.filter.links?.length);
  const includes = [f.text ? 1 : 0, f.types?.length ?? 0, f.ids?.length ?? 0, f.links?.length ?? 0].reduce((a, b) => a + b, 0);
  /** The lens with term `field` `value` taken out, when one is being changed; else as it is. */
  const but = (field, value) => (field ? without(lens, field, value) : lens);
  /** A term: its words, a click to change it in its part's menu, an × to take it away. The last term the filter includes is not taken away: a lens includes something. */
  const term = (cls, said, title, field, value, edit) => {
    const alone = !['exclude', 'only', 'within'].includes(field) && includes === 1;
    const drop = alone ? null : () => go(without(lens, field, value));
    return {
      said,
      title,
      drop,
      el: h('span', { class: `q-term ${cls}`, title },
        h('button', { type: 'button', class: 'q-said', title: `${title}: change it`, onclick: (ev) => edit(ev.currentTarget, field, value) }, said),
        drop && h('button', { type: 'button', class: 'q-x', title: 'Take it out', 'aria-label': `Take out ${said}`, onclick: drop }, '×')),
    };
  };
  const typeChoices = () => [...types.values()].filter((t) => !t.system && t.kind !== 'system');
  // What the filter adds: words, a type, #tag, a link and its end, an item id; only a type or within an item to narrow.
  const addToFilter = (anchor, field, value) => pickTerm(anchor, {
    label: 'Add to the filter',
    groups: groupsOf(ranked(typeChoices(), here.types, near.uses?.types), (t) => ({ label: t.title, title: 'Items of this type, the newest first', pick: () => go(added(but(field, value), { type: t.id })) })),
    typed: {
      placeholder: 'Words, a type, #tag, only a type…',
      title: 'Words to find; a type; #tag; a link and its end (waits_on me); an item id; only a type, or within an item id, to narrow what it finds',
      pick: (written) => {
        const t = termOf(written);
        if (t) go(added(but(field, value), t));
        return Boolean(t);
      },
    },
  });
  // What is left out of everything: closed, system, or a type.
  const leaveOut = (anchor, field, value) => pickTerm(anchor, {
    label: 'Leave out',
    groups: [
      { label: '', items: ['closed', 'system'].filter((x) => !exclude.includes(x)).map((x) => ({ label: x, title: x === 'closed' ? 'What is done or closed' : 'What the system keeps', pick: () => go(added(but(field, value), { exclude: x })) })) },
      ...groupsOf(ranked(typeChoices().filter((t) => !exclude.includes(t.id)), here.types, near.uses?.types), (t) => ({ label: t.title, title: 'Items of this type', pick: () => go(added(but(field, value), { exclude: t.id })) })),
    ],
  });
  const { over, steps } = lens.walk ?? { over: [], steps: 0 };
  const walked = over === 'all' ? [] : over;
  const walk = (change) => go({ ...lens, walk: { over, steps, ...change } });
  // What the walk follows: every link, or one more link type, those used here first.
  const walkAlong = (anchor) => pickTerm(anchor, {
    label: 'Walk along a link',
    groups: [
      over !== 'all' && { label: '', items: [{ label: 'every link', title: 'Every link, either way', pick: () => walk({ over: 'all', steps: steps || 1 }) }] },
      ...groupsOf(ranked([...relations.values()].filter((r) => !r.id.startsWith('sys.') && !walked.includes(r.id)), here.links, near.uses?.links), (r) => ({ label: r.title ?? r.id, title: 'Along this link, either way', pick: () => walk({ over: [...walked, r.id], steps: steps || 1 }) })),
    ].filter(Boolean),
  });
  const filterTerms = [
    f.text && term('q-text', `“${f.text}”`, 'Words it finds', 'text', f.text, addToFilter),
    ...(f.types ?? []).map((t) => term('q-type', typeTitle(t), 'Items of this type, the newest first', 'types', t, addToFilter)),
    ...(f.links ?? []).filter((t) => t.startsWith('tagged ')).map((t) => term('q-tag', termWords(t, redraw), 'Items with this tag', 'links', t, addToFilter)),
    ...(f.links ?? []).filter((t) => !t.startsWith('tagged ')).map((t) => term('q-link', termWords(t, redraw), `Items with this link: ${termWords(t, redraw)}`, 'links', t, addToFilter)),
    ...(f.ids ?? []).map((id) => term('q-id', nameOf(id, redraw), 'This item', 'ids', id, addToFilter)),
    ...(f.only ?? []).map((t) => term('q-narrow', `only ${typeTitle(t)}`, 'Only what is of this type, of what the filter finds', 'only', t, addToFilter)),
    ...(f.within ?? []).map((id) => term('q-narrow', `within ${nameOf(id, redraw)}`, 'Only what is within this item, at any depth, of what the filter finds', 'within', id, addToFilter)),
  ].filter(Boolean);
  const leftTerms = exclude.map((x) => term('q-out', x === 'closed' || x === 'system' ? x : typeTitle(x), 'Left out of everything', 'exclude', x, leaveOut));
  const walkTerm = (said, drop) => ({ said, title: 'Along this link, either way', drop, el: h('span', { class: 'q-term q-walk' }, h('span', { class: 'q-said' }, said), h('button', { type: 'button', class: 'q-x', title: 'Take it out', 'aria-label': `Take out ${said}`, onclick: drop }, '×')) });
  const walkTerms = over === 'all'
    ? [walkTerm('every link', () => walk({ over: [], steps: 0 }))]
    : walked.map((r) => walkTerm(linkTitle(r), () => walk({ over: walked.filter((o) => o !== r), steps: walked.length > 1 ? steps : 0 })));
  // A part of the query: its word, its first terms and how many more (all of them a click away, each with its ×), and its own + to add one.
  const most = numberOf(state.style, 'query_terms_most');
  const part = (cls, word, title, list, add, addLabel, ...rest) => {
    const plus = h('button', { type: 'button', class: 'q-add', title: addLabel, 'aria-label': addLabel, onclick: (ev) => add(ev.currentTarget) }, '+');
    const more = list.slice(most);
    const all = (ev) => pickTerm(ev.currentTarget, { label: word, held: list.map((t) => ({ label: t.said, title: t.title, open: () => add(plus), drop: t.drop })) });
    return h('span', { class: `q-part ${cls}`, title },
      h('span', { class: 'q-label', title }, word),
      list.slice(0, most).map((t) => t.el),
      more.length > 0 && h('button', { type: 'button', class: 'q-more', title: more.map((t) => t.said).join(' · '), 'aria-label': `${more.length} more`, onclick: all }, `+${more.length} more`),
      plus,
      rest);
  };
  const walking = over === 'all' || walked.length > 0;
  // Two rows, one under the other: the view (the canvas up and what is done with it, joined to its tab or its pane's
  // strip), then the query (the filter, what is left out, the walk, the limit), so a tab, a view and a lens each read as what it is.
  bar.replaceChildren(
    h('div', { class: 'q-view', role: 'group', 'aria-label': 'The view' }, lead ?? ''),
    h('div', { class: 'q-lens', role: 'group', 'aria-label': 'The query' },
      part('q-filter', 'Filter', 'What it finds is drawn', filterTerms, (a) => addToFilter(a), 'Add to the filter'),
      part('q-left', 'Left out', 'Left out of everything, what the walk reaches included', leftTerms, (a) => leaveOut(a), 'Leave something out'),
      part('q-walk-part', 'Walk', 'From what the filter finds, along these links either way', walkTerms, (a) => walkAlong(a), 'Walk along a link',
        walking && h('span', { class: 'q-label', title: 'How many steps the walk takes' }, 'Steps'),
        walking && h('span', { class: 'switch q-steps', title: 'How many steps the walk takes' },
          h('button', { type: 'button', title: 'One step fewer', disabled: steps <= 1, onclick: () => walk({ steps: steps - 1 }) }, '−'),
          h('button', { type: 'button', class: 'on', title: 'Steps' }, String(steps)),
          h('button', { type: 'button', title: 'One step more', onclick: () => walk({ steps: steps + 1 }) }, '+'))),
      h('span', { class: 'q-part', title: 'The limit: the most items drawn' },
        h('span', { class: 'q-label', title: 'The most items drawn' }, 'Limit'),
        h('input', { class: 'q-limit', inputmode: 'numeric', value: lens.limit ?? answer?.lens?.limit ?? '', size: String(lens.limit ?? answer?.lens?.limit ?? '').length || 1, 'aria-label': 'The most items drawn', title: 'The most items drawn', onchange: (ev) => Number(ev.target.value) >= 1 && go({ ...lens, limit: Math.round(Number(ev.target.value)) }) }),
        answer && h('span', { class: `q-count${answer.cut ? ' cut' : ''}`, title: answer.cut ? 'The limit cut what the lens finds' : 'Items drawn' }, `${answer.items.length}${answer.cut ? '+' : ''} drawn`),
        view?.failed && h('span', { class: 'q-count cut', title: view.failed }, '!'),
      ),
    ),
  );
  bar.hidden = !filled;
}
