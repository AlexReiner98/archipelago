// The query bar: the canvas's lens, always in sight (decision e_sdsaxxq4). The view's band stays at the top; the lens
// is said in one line in the find bar at the canvas's foot (decision e_2a4mddx8): the search's words, what the filter
// adds and leaves out, and the walk, in a few words, and how many items are drawn. Opening find (ui/find.js) shows a
// row for each part above it, each saying what it is in a word: the filter
// (types, tags, items, links; what narrows them, only a type, within an item; and what it leaves out), the walk (the
// links it follows, how many steps) and the limit. A row shows as many terms as fit and how many more, those a click
// away, and has its own + that opens one menu
// (ui/term-pick.js) to add to it: a kind, then the thing of that kind (ui/term-kinds.js), never words taken for a term; a term's words open it again to change that term, its × takes it away. Every change
// is a new lens, handed to `go` (the canvas puts it in the address and draws it). The menus lead with what this canvas
// and its neighbourhood use (ui/picker-rank.js). No term or part is a box inside a box (rule e_vgs9vt5j).

import { api, asWords, h, state, wordsOf } from './base.js';
import { numberOf } from './lens-base.js';
import { ranked, around, uses } from './picker-rank.js';
import { isWord, onlySaid } from './only-words.js';
import { findKinds, onlyKinds } from './term-kinds.js';
import { pickTerm } from './term-pick.js';
import { ARROW, NEXT_WAY, relations, titles, typeTitle, types, wayOf, withWay } from './words.js';

const bar = document.getElementById('query');
/** Where find holds the lens: its line at rest, and its rows while it is open (ui/find.js). */
const line = document.getElementById('find-lens');
const rows = document.getElementById('find-rows');
/**
 * Items the bar has asked the names of, so each is asked once, with whatever waits to draw it: every one is drawn
 * when the name comes. Only the first was before, and a part drawn again before a slow answer came stayed on "…".
 */
const asking = new Map();
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
const linkTitle = (id) => relations.get(id)?.title ?? id.replaceAll('_', ' ');
/** An item named by its title, once the page knows it; until then a mark, and the name asked for. */
function nameOf(id, redraw) {
  if (titles.has(id)) return titles.get(id);
  if (asking.has(id)) {
    asking.get(id).add(redraw);
    return '…';
  }
  asking.set(id, new Set([redraw]));
  // Asked once more if the first answer does not come (a server still starting), then left as the mark.
  const ask = (again) =>
    api('get', { id })
      .then((got) => {
        titles.set(id, got.entity.title);
        for (const draw of asking.get(id) ?? []) draw();
        asking.set(id, new Set());
      })
      .catch(() => again && ask(false));
  ask(true);
  return '…';
}

/** The lens with one term added to its filter. */
export function added(lens, term) {
  const f = { ...lens.filter };
  if (term.text) Object.assign(f, asWords([...wordsOf(f), term.text]));
  if (term.type) f.types = [...new Set([...(f.types ?? []), term.type])];
  if (term.id) f.ids = [...new Set([...(f.ids ?? []), term.id])];
  if (term.link) f.links = [...new Set([...(f.links ?? []), term.link])];
  if (term.in) f.in = [...new Set([...(f.in ?? []), term.in])];
  if (term.only) f.only = [...new Set([...(f.only ?? []), term.only])];
  if (term.within) f.within = [...new Set([...(f.within ?? []), term.within])];
  if (term.exclude) f.exclude = [...new Set([...(f.exclude ?? ['system']), term.exclude])];
  // Only what is done finds nothing while Not leaves the closed out: it takes that away.
  if (term.only === 'done' && f.exclude?.includes('closed')) f.exclude = f.exclude.filter((x) => x !== 'closed');
  // A term added to a lens that names a view makes it a filter of the map again.
  const { view: _view, ...rest } = lens;
  return { ...rest, filter: f };
}

/** The lens with one of its filter's terms taken out: `field` and the value it holds. */
function without(lens, field, value) {
  const f = { ...lens.filter };
  if (field === 'text') {
    delete f.text;
    Object.assign(f, asWords(wordsOf(lens.filter).filter((w) => w !== value)));
  } else f[field] = (f[field] ?? (field === 'exclude' ? ['system'] : [])).filter((v) => v !== value);
  if (field !== 'exclude' && field !== 'text' && !f[field]?.length) delete f[field];
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
    ...wordsOf(f).map((w) => `“${w}”`),
    some(f.types, typeTitle, (l) => `${l.length} types`),
    some(tags, (t) => termWords(t, redraw), (l) => `${termWords(l[0], redraw)} +${l.length - 1}`),
    ...[...linkGroups(f.links ?? []).values()].map((l) => `${termWords(l[0], redraw)}${l.length > 1 ? ` +${l.length - 1}` : ''}`),
    some(f.ids, (id) => nameOf(id, redraw), (l) => `${l.length} items`),
    some(f.in, (id) => `in ${nameOf(id, redraw)}`, (l) => `in ${l.length} items`),
    some(f.only, (t) => `only ${onlySaid(t, typeTitle, (id) => nameOf(id, redraw))}`, (l) => `only ${onlySaid(l[0], typeTitle, (id) => nameOf(id, redraw))} +${l.length - 1}`),
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
  // A lens that names a view draws what is not items of the map: nothing to look around.
  if (answer && !lens.view) lookAround(lens, answer);
  const here = uses(answer?.items, answer?.links);
  const exclude = f.exclude ?? ['system'];
  const includes = [wordsOf(f).length, f.types?.length ?? 0, f.ids?.length ?? 0, f.links?.length ?? 0, f.in?.length ?? 0].reduce((a, b) => a + b, 0);
  const filled = includes > 0;
  /** The lens with term `field` `value` taken out, when one is being changed; else as it is. */
  const but = (field, value) => (field ? without(lens, field, value) : lens);
  /** A term: its words, a click to change it in its part's menu, an × to take it away. The last term Find has may go too: the canvas is then empty. */
  const term = (cls, said, title, field, value, edit) => {
    const drop = () => go(without(lens, field, value));
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
  // What Find and Only add: a kind, then the thing (decision e_45sgrfqd, ui/term-kinds.js); nothing written is guessed.
  const kinds = (field, value) => ({
    add: (term) => go(added(but(field, value), term)),
    typeGroups: (pick) => groupsOf(ranked(typeChoices(), here.types, near.uses?.types), (t) => ({ label: t.title, title: t.description ?? t.title, pick: () => pick(t) })),
    linkGroups: (pick) => groupsOf(ranked([...relations.values()].filter((r) => !r.id.startsWith('sys.') && r.id !== 'tagged'), here.links, near.uses?.links), (r) => ({ label: r.title ?? r.id, title: r.description ?? r.title, ...pick(r) })),
    hasTags: relations.has('tagged'),
    most: numberOf(state.style, 'term_find_most'),
    have: f.only ?? [],
    // The statuses in use here first, then those of the types Find and Only name.
    statuses: [...new Set([...(answer?.items ?? []).map((i) => i.status), ...[...(f.types ?? []), ...(f.only ?? []).filter((t) => !isWord(t))].flatMap((t) => [...(types.get(t)?.statuses.open ?? []), ...(types.get(t)?.statuses.closed ?? [])])])].filter(Boolean),
    days: ['only_since_short', 'only_since_days', 'only_since_long'].map((n) => numberOf(state.style, n)),
  });
  const addToFilter = (anchor, field, value) => pickTerm(anchor, findKinds(kinds(field, value)));
  const narrowTo = (anchor, field, value) => pickTerm(anchor, onlyKinds(kinds(field, value)));
  // What Not leaves out of everything: closed, system, or a type.
  const leaveOut = (anchor, field, value) => pickTerm(anchor, {
    label: 'Not',
    groups: [
      { label: '', items: ['closed', 'system'].filter((x) => !exclude.includes(x)).map((x) => ({ label: x, title: x === 'closed' ? 'What is done or closed' : 'What the system keeps', pick: () => go(added(but(field, value), { exclude: x })) })) },
      ...groupsOf(ranked(typeChoices().filter((t) => !exclude.includes(t.id)), here.types, near.uses?.types), (t) => ({ label: t.title, title: 'Items of this type', pick: () => go(added(but(field, value), { exclude: t.id })) })),
    ],
  });
  const { over, steps } = lens.walk ?? { over: [], steps: 0 };
  const walked = over === 'all' ? [] : over;
  const walk = (change) => go({ ...lens, walk: { over, steps, ...change } });
  /** A walked link in words: its way's arrow, then its title. */
  const waySaid = (t) => ((w) => `${ARROW[w.way]} ${linkTitle(w.link)}`)(wayOf(t));
  // What the walk follows: every link, or one more link type, those used here first.
  const walkAlong = (anchor) => pickTerm(anchor, {
    label: 'Walk',
    groups: [
      over !== 'all' && { label: '', items: [{ label: 'every link', title: 'Every link, either way', pick: () => walk({ over: 'all', steps: steps || 1 }) }] },
      ...groupsOf(ranked([...relations.values()].filter((r) => !r.id.startsWith('sys.') && !walked.some((t) => wayOf(t).link === r.id)), here.links, near.uses?.links), (r) => ({ label: r.title ?? r.id, title: 'Along this link, either way: its arrow turns it', pick: () => walk({ over: [...walked, r.id], steps: steps || 1 }) })),
    ].filter(Boolean),
  });
  // The lens's parts by their words (decision e_drt4g872): Find what adds, any of it; Only what must all hold of it; Not
  // what is left out of everything but an item named, what the walk reaches included.
  const findTerms = [
    ...wordsOf(f).map((w) => term('q-text', `“${w}”`, 'Words to find, set in the find bar', 'text', w, addToFilter)),
    ...(f.types ?? []).map((t) => term('q-type', typeTitle(t), 'Items of this type, the newest first', 'types', t, addToFilter)),
    ...(f.links ?? []).filter((t) => t.startsWith('tagged ')).map((t) => term('q-tag', termWords(t, redraw), 'Items with this tag', 'links', t, addToFilter)),
    ...(f.links ?? []).filter((t) => !t.startsWith('tagged ')).map((t) => term('q-link', termWords(t, redraw), `Items with this link: ${termWords(t, redraw)}`, 'links', t, addToFilter)),
    ...(f.ids ?? []).map((id) => term('q-id', nameOf(id, redraw), 'This item', 'ids', id, addToFilter)),
    ...(f.in ?? []).map((id) => term('q-in', `in ${nameOf(id, redraw)}`, 'All that is in this item, at any depth', 'in', id, addToFilter)),
  ].filter(Boolean);
  const onlyTerms = [
    ...(f.only ?? []).map((t) => term('q-narrow', onlySaid(t, typeTitle, (id) => nameOf(id, redraw)), isWord(t) ? 'Only what is so, of what Find finds' : 'Only what is of this type, of what Find finds', 'only', t, narrowTo)),
    ...(f.within ?? []).map((id) => term('q-narrow', `within ${nameOf(id, redraw)}`, 'Only what is within this item, at any depth, of what Find finds', 'within', id, narrowTo)),
  ];
  const notTerms = exclude.map((x) => term('q-out', x === 'closed' || x === 'system' ? x : typeTitle(x), 'Left out of everything', 'exclude', x, leaveOut));
  // A walked link: its arrow, a click turning it out (→), in (←) or either way (↔); its title; its ×.
  const wayTitle = { either: 'Either way along this link', out: 'Out along this link, from what it starts at', in: 'In along this link, to what it starts at' };
  const walkTerm = (said, drop, t) => {
    const w = t && wayOf(t);
    const turn = w && (() => walk({ over: walked.map((o) => (o === t ? withWay(w.link, NEXT_WAY[w.way]) : o)) }));
    return { said, title: w ? wayTitle[w.way] : 'Every link, either way', drop, el: h('span', { class: 'q-term q-walk' },
      w && h('button', { type: 'button', class: 'q-way', title: `${wayTitle[w.way]}: turn it`, 'aria-label': `Turn the way of ${said}`, onclick: turn }, ARROW[w.way]),
      h('span', { class: 'q-said' }, w ? linkTitle(w.link) : said),
      h('button', { type: 'button', class: 'q-x', title: 'Take it out', 'aria-label': `Take out ${said}`, onclick: drop }, '×')) };
  };
  const walkTerms = over === 'all'
    ? [walkTerm('every link', () => walk({ over: [], steps: 0 }))]
    : walked.map((r) => walkTerm(waySaid(r), () => walk({ over: walked.filter((o) => o !== r), steps: walked.length > 1 ? steps : 0 }), r));
  // A part of the query, a row of the editor: its word, its terms, as many as the row has room for and how many more
  // (those a click away, each with its ×), and its own + to add one.
  const part = (cls, word, title, list, add, addLabel, ...rest) => {
    const plus = h('button', { type: 'button', class: 'q-add', title: addLabel, 'aria-label': addLabel, onclick: (ev) => add(ev.currentTarget) }, '+');
    const all = (ev) => pickTerm(ev.currentTarget, { label: `${word}: the rest`, held: list.filter((t) => t.el.hidden).map((t) => ({ label: t.said, title: t.title, open: () => add(plus), drop: t.drop })) });
    for (const t of list) t.el.dataset.said = t.said;
    return h('div', { class: `q-part ${cls}`, title },
      h('span', { class: 'q-label', title }, word),
      h('span', { class: 'q-terms' },
        list.map((t) => t.el),
        list.length > 0 && h('button', { type: 'button', class: 'q-more', hidden: true, onclick: all }),
        plus,
        rest));
  };
  const walking = over === 'all' || walked.length > 0;
  const limit = lens.limit ?? answer?.lens?.limit ?? '';
  const drawn = answer && h('span', { class: `q-count${answer.cut ? ' cut' : ''}`, title: answer.cut ? 'The limit cut what the lens finds' : 'Items drawn, of the limit' }, `${answer.items.length}${answer.cut ? '+' : ''}${limit ? ` of ${limit}` : ''}`);
  const failed = view?.failed && h('span', { class: 'q-count cut', title: view.failed }, '!');
  // The lens in one line, each part by the word its row in the editor has: Find, its terms joined by "or" (any of them
  // adds); Only, what must all hold; Not, what is left out beyond the system's own; Walk, the links and ×steps. The
  // whole of it, in words, is the line's tooltip.
  const or = (list) => list.flatMap((x, i) => (i ? [h('span', { class: 'q-or' }, 'or'), x] : [x]));
  const found = findTerms.map((t) => t.said);
  const narrowed = onlyTerms.map((t) => t.said);
  const out = exclude.filter((x) => x !== 'system').map((x) => (x === 'closed' ? x : typeTitle(x)));
  const walkSaid = `${over === 'all' ? 'every link' : walked.map(waySaid).join(', ')} ×${steps}`;
  const parts = [
    found.length > 0 && ['Find', or(found.map((x) => h('span', { class: 'q-kept' }, x)))],
    narrowed.length > 0 && ['Only', narrowed.join(', ')],
    out.length > 0 && ['Not', out.join(', ')],
    walking && ['Walk', walkSaid],
  ].filter(Boolean);
  const said = parts.map(([word]) => `${word} ${{ Find: found.join(' or '), Only: narrowed.join(', '), Not: out.join(', '), Walk: walkSaid }[word]}`).join(' · ');
  // The view's band at the top, joined to its tab or its pane's strip; the lens in one line in find, and a row for each
  // part of it above find while find is open.
  bar.replaceChildren(h('div', { class: 'q-view', role: 'group', 'aria-label': 'The view' }, lead ?? ''));
  line?.replaceChildren(...[
    h('button', { type: 'button', class: 'q-sum', title: filled ? `${said}: change it` : 'Find on the map' },
      filled ? parts.map(([word, what]) => h('span', { class: 'q-sum-part' }, h('span', { class: 'q-label' }, word), what)) : h('span', { class: 'q-hint' }, 'Find on the map')),
    drawn, failed,
  ].filter(Boolean));
  rows?.replaceChildren(
    part('q-filter', 'Find', 'What any of these finds is drawn', findTerms, (a) => addToFilter(a), 'Find more'),
    part('q-only', 'Only', 'What Find finds must all be so', onlyTerms, (a) => narrowTo(a), 'Only what is so, of a type, or within an item'),
    part('q-not', 'Not', 'Left out of everything, what the walk reaches included', notTerms, (a) => leaveOut(a), 'Leave something out'),
    part('q-walk-part', 'Walk', 'From what Find finds, along these links, each its own way', walkTerms, (a) => walkAlong(a), 'Walk along a link',
      walking && h('span', { class: 'switch q-steps', title: 'How many steps the walk takes' },
        h('button', { type: 'button', title: 'One step fewer', disabled: steps <= 1, onclick: () => walk({ steps: steps - 1 }) }, '−'),
        h('button', { type: 'button', class: 'on', title: 'Steps' }, `×${steps}`),
        h('button', { type: 'button', title: 'One step more', onclick: () => walk({ steps: steps + 1 }) }, '+'))),
    h('div', { class: 'q-part', title: 'The limit: the most items drawn' },
      h('span', { class: 'q-label', title: 'The most items drawn' }, 'Limit'),
      h('span', { class: 'q-terms' },
        h('input', { class: 'q-limit', inputmode: 'numeric', value: limit, size: String(limit).length || 1, 'aria-label': 'The most items drawn', title: 'The most items drawn', onchange: (ev) => Number(ev.target.value) >= 1 && go({ ...lens, limit: Math.round(Number(ev.target.value)) }) }),
        drawn && drawn.cloneNode(true))),
  );
  // A lens that names a view has no terms, and its band still says which canvas it is.
  bar.hidden = !filled && !lens.view;
  fitBar();
}

/** Each row of the editor shows as many of its terms as it has room for, and how many more: drawn again as the bar's width changes. */
function fitRows() {
  for (const row of rows?.querySelectorAll(':scope > .q-part') ?? []) {
    const box = row.querySelector('.q-terms');
    const more = box.querySelector(':scope > .q-more');
    if (!more) continue;
    const terms = [...box.querySelectorAll(':scope > .q-term')];
    for (const t of terms) t.hidden = false;
    more.hidden = true;
    let shown = terms.length;
    while (shown > 1 && box.scrollWidth > box.clientWidth + 1) {
      terms[--shown].hidden = true;
      const rest = terms.slice(shown);
      Object.assign(more, { hidden: false, textContent: `+${rest.length} more`, title: rest.map((t) => t.dataset.said).join(' · ') });
      more.setAttribute('aria-label', `${rest.length} more`);
    }
  }
}
/**
 * Fit the bar to its width: the view's band drops its buttons' words, then back and forward, then Split as the canvas's
 * name shrinks; the query's line drops how many are drawn once its words have little room; each row of the editor shows what it has
 * room for. Drawn again as the width changes.
 */
export function fitBar() {
  if (!bar) return;
  const over = (el) => el && el.scrollWidth > el.clientWidth + 1;
  const view = bar.querySelector('.q-view');
  // The band is narrowed by more than the bar: the strip of the pane it stands in takes room beside it.
  if (view) fits.observe(view);
  if (view) {
    view.classList.remove('tight', 'tighter', 'tightest');
    const canvas = view.querySelector('.q-canvas');
    for (const step of ['tight', 'tighter', 'tightest']) if (over(view) || over(canvas)) view.classList.add(step);
  }
  if (line) {
    line.classList.remove('tight');
    const sum = line.querySelector('.q-sum');
    // How many are drawn goes when the query's words have less than a third of the line.
    if (over(line) || (sum && over(sum) && sum.clientWidth * 3 < line.clientWidth)) line.classList.add('tight');
  }
  fitRows();
  keepClear();
}

/**
 * The pane the bar acts on keeps what it draws below the view's band: its top safe zone is
 * where the bar ends over it (the owner, 28 Oct 2026). Other panes keep the stylesheet's.
 */
function keepClear() {
  const under = document.querySelector('#canvas > .pane.pane-active > .pane-canvas');
  for (const c of document.querySelectorAll('#canvas > .pane > .pane-canvas')) if (c !== under) c.style.removeProperty('--safe-top');
  if (!under || bar.hidden) return under?.style.removeProperty('--safe-top');
  const below = Math.max(0, Math.round(bar.getBoundingClientRect().bottom - under.getBoundingClientRect().top));
  under.style.setProperty('--safe-top', `calc(${below}px + var(--space-4))`);
}
const fits = new ResizeObserver(() => fitBar());
if (bar) fits.observe(bar);
// Find's line and rows are measured once in sight: opening find sizes its rows.
for (const el of [line, rows]) if (el) fits.observe(el);
addEventListener('pane-focus', () => setTimeout(keepClear, 0));
addEventListener('resize', keepClear);
