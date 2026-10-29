// Find: the bar at the canvas's foot that is the query's (decision e_2a4mddx8). At rest it says the lens of the pane
// the bar acts on in one line (drawn by ui/query-bar.js). A click or / opens it to type, and the lens's rows (Find,
// Only, Not, Walk, Limit) rise above it. Typing swaps the rows for the choices of what the words could be, each said
// by its kind (ui/find-choices.js): Words first and lit, so nothing is guessed (decision e_45sgrfqd). ↑↓ move the
// light; Enter takes it and find stays open, emptied, to refine further: words in place of the words find set before,
// every other term and the walk kept, or another term added; Shift+Enter adds the words as another set, found as
// well (e_e3k797d3). Typing a part's word and a space
// ("only ", "not ", "walk ", "limit "), or a click on a row's word, puts find in that part: its mark stands before the
// box and the choices are that part's; Backspace in an empty box goes back to Find. Escape empties what was typed, then
// leaves the part, then shuts find; so does a click away from it.

import { api, asWords, h, state, wordsOf } from './base.js';
import { goLens, home, lensNow } from './canvas.js';
import { MODES, choicesFor, ledBy, wordsChoice } from './find-choices.js';
import { numberOf } from './lens-base.js';
import { added, fitBar } from './query-bar.js';

const bar = document.getElementById('find');
const list = bar.querySelector('.find-choices');
const row = bar.querySelector('.find-row');
const said = document.getElementById('find-lens');
const rows = document.getElementById('find-rows');
/** The part of the lens find is in, by its word, and its mark before the box. */
let mode = 'Find';
const mark = h('span', { class: 'q-label find-mode', title: 'The part find is in: type another part’s word and a space to go there; Backspace goes back to Find' }, 'Find');
const PLACEHOLDER = { Find: 'Find on the map', Only: 'Only what is so: done, a type, within…', Not: 'Leave out: closed, a type', Walk: 'Walk along a link', Limit: 'The most items drawn' };
const input = h('input', { type: 'search', name: 'q', placeholder: 'Find on the map', autocomplete: 'off', 'aria-label': 'Find on the map', title: 'Choose what the words are: ↑↓, then Enter; Shift+Enter adds the words as another set' });
let asked = 0;
/** The choices drawn, what was typed when they were, and the lit one. */
let choices = [];
let shownFor = '';
let lit = 0;

const lensUp = () => lensNow() ?? home();

/** Open find to type in: the lens's rows rise above it. */
function open() {
  if (bar.classList.contains('open')) return input.focus();
  bar.classList.add('open');
  input.focus();
  fitBar();
}
/** Empty find to type the next term: back in Find, its rows in sight with what was just added, the cursor kept in it. */
function again() {
  bar.classList.remove('typing');
  input.value = '';
  toMode('Find', false);
  choices = [];
  list.hidden = true;
}
/** Shut find: what was typed goes, and the lens is said in its line again. */
function shut() {
  again();
  bar.classList.remove('open');
  if (bar.contains(document.activeElement)) document.activeElement.blur();
}

/** Put find in a part of the lens, and say its choices (`look`, unless it is shutting). */
function toMode(m, looking = true) {
  mode = m;
  mark.textContent = m;
  input.placeholder = PLACEHOLDER[m];
  if (looking) (input.focus(), look());
}

/**
 * Take a choice: a part to go into; a view or a style to open; words in place of those find set before, or (`add`) as one more set; a link to
 * walk along; a limit; any other term added to the lens. Find stays open with the cursor in it, to refine further.
 */
function take(choice, add = false) {
  if (!choice) return;
  if (choice.mode) return void ((input.value = ''), toMode(choice.mode));
  // A view or a style is opened, not added: find shuts, and the pane goes there.
  if (choice.href) return void (shut(), (location.hash = choice.href));
  again();
  input.focus();
  const lens = lensUp();
  if (choice.walk) {
    const { over = [], steps = 0 } = lens.walk ?? {};
    return goLens({ ...lens, walk: { over: choice.walk === 'all' ? 'all' : [...(over === 'all' ? [] : over), choice.walk], steps: steps || 1 } });
  }
  if (choice.limit) return goLens({ ...lens, limit: choice.limit });
  if (choice.words) {
    const { text, ...rest } = lens.filter;
    return goLens({ ...lens, filter: { ...rest, ...asWords(add ? [...wordsOf({ text }), choice.words] : [choice.words]) } });
  }
  goLens(added(lens, choice.term));
}

/** Draw the choices, the lit one marked. */
function drawChoices() {
  list.replaceChildren(...choices.map((c, i) => h('button', { type: 'button', role: 'option', class: `term-pick-item find-choice${i === lit ? ' lit' : ''}`, 'aria-selected': String(i === lit), title: c.title, onclick: (ev) => take(c, ev.shiftKey) },
    h('span', { class: 'q-label' }, c.kind),
    h('span', { class: 'find-name' }, c.label),
    c.note && h('span', { class: 'find-note' }, c.note))));
  list.hidden = !choices.length;
  // What was typed when they were drawn: Enter takes only choices drawn for what is typed now.
  list.dataset.for = shownFor;
}

/**
 * What the words could be: the words at once, the rest once the search answers; how many the words find under the
 * canvas's Only, Within and Not, which Enter keeps, so the count is what Enter brings (task e_7bewev8v).
 */
async function look() {
  const q = input.value.trim();
  const mine = ++asked;
  const finding = mode === 'Find';
  bar.classList.toggle('typing', Boolean(q) || !finding);
  if (finding && !q) return void ((choices = []), (list.hidden = true));
  // In Find the words are drawn at once, unless a kind's word leads them: then that kind's choices come first.
  const seeded = finding && !ledBy(mode, q);
  choices = seeded ? [wordsChoice(q)] : [];
  shownFor = seeded ? q : '';
  lit = 0;
  drawChoices();
  const lens = lensUp();
  const { only, within, exclude } = lens.filter;
  const most = numberOf(state.style, 'find_choice_items');
  const [all, counted] = await Promise.all([
    choicesFor(mode, q, { most, wide: numberOf(state.style, 'term_find_most'), lens }),
    finding ? api('view', { name: 'flat', params: { filter: { text: q, ...(only && { only }), ...(within && { within }), ...(exclude && { exclude }) }, limit: most } }).catch(() => null) : null,
  ]);
  if (mine !== asked) return;
  const words = all.find((x) => x.words === q);
  if (words && counted) words.note = `${counted.matched ?? counted.items.length} found`;
  shownFor = q;
  choices = all;
  drawChoices();
}

/** The bar, drawn once. */
export function drawFind() {
  if (row.contains(input)) return;
  row.append(mark, input);
  let wait;
  input.addEventListener('input', (ev) => {
    // Typing here is not an edit a redraw of the page would lose.
    ev.stopPropagation();
    clearTimeout(wait);
    // A part's word and a space put find in that part: the word is the mode, not words to find.
    const [, word, rest] = /^(\S+)\s(.*)$/.exec(input.value) ?? [];
    const into = word && MODES.find((m) => m.toLowerCase() === word.toLowerCase());
    if (into) return void ((input.value = rest), toMode(into));
    bar.classList.toggle('typing', Boolean(input.value.trim()) || mode !== 'Find');
    wait = setTimeout(look, 160);
  });
  input.addEventListener('focus', open);
  // The whole bar at rest is a field: a click anywhere on it opens it.
  row.addEventListener('click', open);
  // A row's word puts find in that part.
  rows.addEventListener('click', (ev) => {
    const word = ev.target.closest?.('.q-part > .q-label')?.textContent;
    if (MODES.includes(word)) toMode(word);
  });
  // Enter takes the lit choice; Shift+Enter adds the words as another set. A form's submit does not say Shift, so the key
  // is read here; and the form holds the limit's field too, so Enter submits it itself.
  let add = false;
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') (ev.preventDefault(), (add = ev.shiftKey), bar.requestSubmit());
    if (ev.key === 'Backspace' && !input.value && mode !== 'Find') (ev.preventDefault(), toMode('Find'));
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && choices.length) {
      ev.preventDefault();
      lit = (lit + (ev.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
      drawChoices();
    }
  });
  bar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearTimeout(wait);
    const q = input.value.trim();
    // Only a choice drawn for what is typed now is taken. In Find, typed faster than the choices came, the words are
    // what is taken, as they come first; led by a kind's word, or in another part, nothing is, until its choices come.
    const ready = shownFor === q && choices[lit];
    if (ready) take(choices[lit], add);
    else if (q && mode === 'Find' && !ledBy(mode, q)) take(wordsChoice(q), add);
    add = false;
  });
  // Another pane or tab in focus: find shuts, and says that lens.
  // Another pane or tab in focus: find shuts, and says that lens; not while it is being typed in (a lens given to a new
  // tab puts its pane in focus).
  addEventListener('pane-focus', () => !bar.contains(document.activeElement) && shut());
}

addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
  if (ev.key === '/' && !typing) (ev.preventDefault(), open());
  // Escape empties what was typed, then leaves the part, then shuts find, wherever in it the focus is; a menu its rows
  // opened shuts first, by itself.
  if (ev.key === 'Escape' && bar.classList.contains('open') && !document.querySelector('.term-pick:popover-open')) {
    ev.preventDefault();
    if (input.value) (input.value = '', look());
    else if (mode !== 'Find') toMode('Find');
    else shut();
  }
});
// A press away from find shuts it; one in a menu its rows opened (ui/term-pick.js) does not. Read on the press, before a
// row's × or a choice redraws what was pressed.
document.addEventListener('pointerdown', (ev) => bar.classList.contains('open') && !bar.contains(ev.target) && !ev.target.closest?.('.term-pick') && shut());
