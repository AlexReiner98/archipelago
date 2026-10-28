// Find: the bar at the canvas's foot that is the query's (decision e_2a4mddx8). At rest it says the lens of the pane
// the bar acts on in one line (drawn by ui/query-bar.js). A click or / opens it to type, and the lens's rows (Find,
// Only, Not, Walk, Limit) rise above it. Typing swaps the rows for the choices of what the words could be, each said
// by its kind (ui/find-choices.js): Words first and lit, so nothing is guessed (decision e_45sgrfqd). ↑↓ move the
// light; Enter takes it: words in place of the words find set before, every other term and the walk kept, or another
// term added; Shift+Enter adds the words as another set, found as well (e_e3k797d3). Escape empties what was typed,
// then shuts find; so does a click away from it.

import { api, asWords, h, state, wordsOf } from './base.js';
import { goLens, home, lensNow } from './canvas.js';
import { choicesFor, wordsChoice } from './find-choices.js';
import { numberOf } from './lens-base.js';
import { added, fitBar } from './query-bar.js';

const bar = document.getElementById('find');
const list = bar.querySelector('.find-choices');
const row = bar.querySelector('.find-row');
const said = document.getElementById('find-lens');
const input = h('input', { type: 'search', name: 'q', placeholder: 'Find on the map', autocomplete: 'off', 'aria-label': 'Find on the map', title: 'Choose what the words are: ↑↓, then Enter; Shift+Enter adds the words as another set' });
let asked = 0;
/** The choices drawn for what is typed, and the lit one. */
let choices = [];
let lit = 0;

const lensUp = () => lensNow() ?? home();

/** Open find to type in: the lens's rows rise above it. */
function open() {
  if (bar.classList.contains('open')) return input.focus();
  bar.classList.add('open');
  input.focus();
  fitBar();
}
/** Shut find: what was typed goes, and the lens is said in its line again. */
function shut() {
  bar.classList.remove('open', 'typing');
  input.value = '';
  choices = [];
  list.hidden = true;
  if (bar.contains(document.activeElement)) document.activeElement.blur();
}

/** Take a choice: words in place of those find set before, or (`add`) as one more set; any other term is added to the lens. */
function take(choice, add = false) {
  if (!choice) return;
  shut();
  if (choice.go) return void (location.hash = choice.go);
  const lens = lensUp();
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
}

/** What the words could be: the words at once, the rest once the search answers; how many the words find, under the canvas's Not. */
async function look() {
  const q = input.value.trim();
  const mine = ++asked;
  bar.classList.toggle('typing', Boolean(q));
  if (!q) return void ((choices = []), (list.hidden = true));
  choices = [wordsChoice(q)];
  lit = 0;
  drawChoices();
  const exclude = lensUp().filter.exclude;
  const most = numberOf(state.style, 'find_choice_items');
  const [all, counted] = await Promise.all([
    choicesFor(q, most),
    api('view', { name: 'flat', params: { filter: { text: q, ...(exclude && { exclude }) }, limit: most } }).catch(() => null),
  ]);
  if (mine !== asked) return;
  all[0].note = counted ? `${counted.matched ?? counted.items.length} found` : '';
  choices = all;
  drawChoices();
}

/** The bar, drawn once. */
export function drawFind() {
  if (row.contains(input)) return;
  row.append(input);
  let wait;
  input.addEventListener('input', (ev) => {
    // Typing here is not an edit a redraw of the page would lose.
    ev.stopPropagation();
    clearTimeout(wait);
    bar.classList.toggle('typing', Boolean(input.value.trim()));
    wait = setTimeout(look, 160);
  });
  input.addEventListener('focus', open);
  said.addEventListener('click', open);
  // Enter takes the lit choice; Shift+Enter adds the words as another set. A form's submit does not say Shift, so the key
  // is read here; and the form holds the limit's field too, so Enter submits it itself.
  let add = false;
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') (ev.preventDefault(), (add = ev.shiftKey), bar.requestSubmit());
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
    // Typed faster than the choices came, the words are what is taken: they are always the first.
    if (q) take(choices[lit] && choices[0].words === q ? choices[lit] : wordsChoice(q), add);
    add = false;
  });
  // Another pane or tab in focus: find shuts, and says that lens.
  addEventListener('pane-focus', shut);
}

addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
  if (ev.key === '/' && !typing) (ev.preventDefault(), open());
  // Escape empties what was typed, then shuts find, wherever in it the focus is; a menu its rows opened shuts first, by itself.
  if (ev.key === 'Escape' && bar.classList.contains('open') && !document.querySelector('.term-pick:popover-open')) {
    ev.preventDefault();
    if (input.value) (input.value = '', look());
    else shut();
  }
});
// A press away from find shuts it; one in a menu its rows opened (ui/term-pick.js) does not. Read on the press, before a
// row's × or a choice redraws what was pressed.
document.addEventListener('pointerdown', (ev) => bar.classList.contains('open') && !bar.contains(ev.target) && !ev.target.closest?.('.term-pick') && shut());
