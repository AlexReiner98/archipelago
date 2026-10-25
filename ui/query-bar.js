// The query bar: the canvas's lens, always in sight and plain to read, on one line under the top bar (decision
// e_sdsaxxq4). The filter's terms are chips: text, types, tags, items, links and what is left out; then the walk (the
// links it follows, how many steps) and the limit. Each is changed in place: a chip's × takes it away, a click on it
// puts its words back in the box to be written again, the box takes a new term, and the walk and the limit have their
// own controls. Every change is a new lens, handed to `go` (the canvas puts it in the address and draws it).

import { api, h } from './base.js';
import { relations, titles, typeTitle, types } from './words.js';

const bar = document.getElementById('query');
/** The words the box was given back by a chip, to be written again. */
let words = '';
/** Items the bar has asked the names of, so each is asked once. */
const asking = new Set();

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

/** What a term written in the box is: `-x` leaves x out, an id is an item, `#name` a tag, `<link> <end>` a link, a type by its name, else text. */
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

/** Draw the bar for this lens, over the view that draws it (its answer names what the lens names); `lead` goes first (the saved canvas up, ui/canvases.js). */
export function drawQuery(lens, view, go, lead) {
  if (!bar) return;
  const redraw = () => drawQuery(lens, view, go, lead);
  const f = lens.filter;
  const exclude = f.exclude ?? ['system'];
  const filled = (lens.filter.text || lens.filter.types?.length || lens.filter.ids?.length || lens.filter.links?.length);
  // A chip: its words, a click to write them again, an × to take it away. The last term the filter includes is not taken away: a lens includes something.
  const chip = (cls, said, title, field, value, written) => {
    const alone = field !== 'exclude' && [f.text ? 1 : 0, f.types?.length ?? 0, f.ids?.length ?? 0, f.links?.length ?? 0].reduce((a, b) => a + b, 0) === 1;
    return h(
      'span',
      { class: `q-term ${cls}`, title },
      h('button', { type: 'button', class: 'q-said', title: `${title}: write it again`, onclick: () => ((words = written), alone ? redraw() : go(without(lens, field, value)), focusBox()) }, said),
      !alone && h('button', { type: 'button', class: 'q-x', title: 'Take it out', 'aria-label': `Take out ${said}`, onclick: () => go(without(lens, field, value)) }, '×'),
    );
  };
  const box = h('input', {
    class: 'q-box',
    value: words,
    placeholder: '+',
    'aria-label': 'Add to the filter',
    title: 'Add to the filter: words to find, a type, #tag, a link and its end (waits_on me), an item id, or -closed, -system, -a type to leave out',
    size: Math.max(words.length, 1),
    onkeydown: (ev) => {
      if (ev.key === 'Escape') return (words = '', ev.target.blur());
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const term = termOf(ev.target.value);
      if (!term) return ev.target.classList.add('wrong');
      words = '';
      go(added(lens, term));
    },
    oninput: (ev) => (ev.stopPropagation(), ev.target.classList.remove('wrong'), (ev.target.size = Math.max(ev.target.value.length, 1))),
  });
  const { over, steps } = lens.walk ?? { over: [], steps: 0 };
  const walked = over === 'all' ? [] : over;
  const walk = (change) => go({ ...lens, walk: { over, steps, ...change } });
  const choice = h(
    'select',
    { class: 'q-add', title: 'Walk along one more link', 'aria-label': 'Walk along one more link', onchange: (ev) => ev.target.value && walk(ev.target.value === 'all' ? { over: 'all', steps: steps || 1 } : { over: [...walked, ev.target.value], steps: steps || 1 }) },
    h('option', { value: '' }, '+'),
    over !== 'all' && h('option', { value: 'all' }, 'every link'),
    [...relations.values()].filter((r) => !r.id.startsWith('sys.') && !walked.includes(r.id)).map((r) => h('option', { value: r.id }, r.title ?? r.id)),
  );
  const answer = view?.answer;
  bar.replaceChildren(
    lead ?? '',
    h('span', { class: 'q-part', title: 'The filter: what it finds is drawn, and what is left out is left out of everything' },
      f.text && chip('q-text', `“${f.text}”`, 'Words it finds', 'text', f.text, f.text),
      (f.types ?? []).map((t) => chip('q-type', typeTitle(t), 'Items of this type, the newest first', 'types', t, typeTitle(t))),
      (f.links ?? []).map((t) => chip(t.startsWith('tagged ') ? 'q-tag' : 'q-link', termWords(t, redraw), t.startsWith('tagged ') ? 'Items with this tag' : 'Items with this link', 'links', t, t)),
      (f.ids ?? []).map((id) => chip('q-id', nameOf(id, redraw), 'This item', 'ids', id, id)),
      box,
      exclude.map((x) => chip('q-out', `−${x === 'closed' || x === 'system' ? x : typeTitle(x)}`, 'Left out of everything', 'exclude', x, `-${x}`)),
    ),
    h('span', { class: 'q-part', title: 'The walk: from what the filter finds, along these links either way' },
      over === 'all' ? h('span', { class: 'q-term q-walk' }, h('span', { class: 'q-said' }, 'every link'), h('button', { type: 'button', class: 'q-x', title: 'Take it out', onclick: () => walk({ over: [], steps: 0 }) }, '×'))
        : walked.map((r) => h('span', { class: 'q-term q-walk' }, h('span', { class: 'q-said' }, linkTitle(r)), h('button', { type: 'button', class: 'q-x', title: 'Take it out', onclick: () => walk({ over: walked.filter((o) => o !== r), steps: walked.length > 1 ? steps : 0 }) }, '×'))),
      choice,
      (over === 'all' || walked.length > 0) && h('span', { class: 'switch q-steps', title: 'How many steps the walk takes' },
        h('button', { type: 'button', title: 'One step fewer', disabled: steps <= 1, onclick: () => walk({ steps: steps - 1 }) }, '−'),
        h('button', { type: 'button', class: 'on', title: 'Steps' }, String(steps)),
        h('button', { type: 'button', title: 'One step more', onclick: () => walk({ steps: steps + 1 }) }, '+')),
    ),
    h('span', { class: 'q-part', title: 'The limit: the most items drawn' },
      h('input', { class: 'q-limit', inputmode: 'numeric', value: lens.limit ?? answer?.lens?.limit ?? '', size: String(lens.limit ?? answer?.lens?.limit ?? '').length || 1, 'aria-label': 'The most items drawn', title: 'The most items drawn', onchange: (ev) => Number(ev.target.value) >= 1 && go({ ...lens, limit: Math.round(Number(ev.target.value)) }) }),
      answer && h('span', { class: `q-count${answer.cut ? ' cut' : ''}`, title: answer.cut ? 'The limit cut what the lens finds' : 'Items drawn' }, `${answer.items.length}${answer.cut ? '+' : ''}`),
      view?.failed && h('span', { class: 'q-count cut', title: view.failed }, '!'),
    ),
  );
  bar.hidden = !filled;
}

/** Put the cursor in the box, once the bar is drawn again. */
const focusBox = () => setTimeout(() => bar.querySelector('.q-box')?.focus(), 0);
