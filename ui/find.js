// Find: a bar at the canvas's foot that sets the words of the lens of the pane the bar acts on (decision e_sdsaxxq4:
// search is the text term of the filter). Enter puts these words in place of the words the bar set before, every other
// term and the walk kept; Shift+Enter adds them as another set, found as well (the owner, 28 Oct 2026, e_e3k797d3). Typing shows what the words
// would find, in one line above the bar (how many, the first few names); clearing the bar takes the term out. / puts
// the cursor in it. The words are a Find term of the lens (src/lens-flat.ts), its parts named as the query bar names
// them (e_drt4g872), so what they would find is read under the canvas's Not.

import { api, asWords, h, state, wordsOf } from './base.js';
import { goHome, goLens, home, lensNow } from './canvas.js';
import { numberOf } from './lens-base.js';
import { workType } from './words.js';

const bar = document.getElementById('find');
const peek = h('div', { class: 'find-peek', hidden: true, role: 'status' });
const input = h('input', { type: 'search', name: 'q', placeholder: 'Find on the map  /', autocomplete: 'off', 'aria-label': 'Find on the map', title: 'Words to find: Enter puts them in place of the words before, Shift+Enter adds them' });
let asked = 0;

const lensUp = () => lensNow() ?? home();
const includes = (f) => Boolean(wordsOf(f).length || f.types?.length || f.ids?.length || f.links?.length);
/** Draw the lens with these words in place of the words it had, the rest kept; or (`add`) as one more set of words. */
function drawText(q, add = false) {
  peek.hidden = true;
  const { text, ...rest } = lensUp().filter;
  goLens({ ...lensUp(), filter: { ...rest, ...asWords(add ? [...wordsOf({ text }), q] : [q]) } });
}
/** Take the text out of the canvas's lens; a lens left including nothing is Home (or the open item's own canvas). */
function takeOut() {
  peek.hidden = true;
  const lens = lensNow();
  if (!wordsOf(lens?.filter).length) return;
  const { text, ...filter } = lens.filter;
  if (includes(filter)) return goLens({ ...lens, filter });
  const open = /^#\/e\/(e_[a-z0-9]{8})/.exec(location.hash)?.[1];
  if (open) location.hash = `#/e/${open}`;
  else goHome();
}

/** Ask what the words would find under the canvas's exclusions, and say it in one line. */
async function look() {
  const q = input.value.trim();
  const mine = ++asked;
  if (!q || wordsOf(lensNow()?.filter).includes(q)) return void (peek.hidden = true);
  let said;
  try {
    const exclude = lensUp().filter.exclude;
    const found = await api('view', { name: 'flat', params: { filter: { text: q, ...(exclude && { exclude }) }, limit: numberOf(state.style, 'find_peek_names') } });
    const names = found.items.map((i) => i.title);
    said = [
      h('span', { class: 'count', title: 'How many the words find' }, String(found.matched ?? names.length)),
      h('span', { class: 'gist grow', title: names.join('\n') }, names.length ? names.join(' · ') : 'Nothing matches.'),
      names.length > 0 && h('button', { type: 'button', class: 'quiet-button', title: 'Find these words in place of the words before, the rest kept (Enter)', onclick: () => drawText(q) }, 'Find'),
      names.length > 0 && wordsOf(lensUp().filter).length > 0 && h('button', { type: 'button', class: 'quiet-button', title: 'Find these words as well as the words before (Shift+Enter)', onclick: () => drawText(q, true) }, 'Add'),
      h('button', { type: 'button', class: 'quiet-button', title: `A new item named "${q}"`, onclick: () => ((peek.hidden = true), (location.hash = `#/new/${workType()}?title=${encodeURIComponent(q)}`)) }, 'New'),
    ];
  } catch (err) {
    said = [h('span', { class: 'gist grow error', title: err.message }, err.message)];
  }
  if (mine !== asked) return;
  peek.replaceChildren(...said);
  peek.hidden = false;
}

/** The bar shows the lens's text, unless it is being written. */
const keepUp = () => document.activeElement !== input && (input.value = wordsOf(lensNow()?.filter).at(-1) ?? '');

/** The bar, drawn once. */
export function drawFind() {
  if (bar.childElementCount) return;
  let wait;
  input.addEventListener('input', (ev) => {
    // Typing here is not an edit a redraw of the page would lose.
    ev.stopPropagation();
    clearTimeout(wait);
    wait = setTimeout(look, 160);
  });
  // The bar's own × (and Esc in it) empties it: the term goes out of the lens.
  input.addEventListener('search', () => !input.value.trim() && takeOut());
  // Enter puts the words in place of those before; Shift+Enter adds them as another set. A form's submit does not say Shift, so the key is read here.
  let add = false;
  input.addEventListener('keydown', (ev) => ev.key === 'Enter' && (add = ev.shiftKey));
  bar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearTimeout(wait);
    const q = input.value.trim();
    q ? drawText(q, add) : takeOut();
    add = false;
  });
  bar.replaceChildren(peek, h('div', { class: 'find-row' }, input));
  addEventListener('hashchange', () => setTimeout(keepUp, 0));
  // Another pane or tab in focus: the bar says its lens's text, and what was typed for the last one goes.
  addEventListener('pane-focus', () => setTimeout(() => ((peek.hidden = true), keepUp()), 0));
  // The page's first lens is put up just after the bar is drawn (ui/app.js).
  setTimeout(keepUp, 0);
}

addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
  if (ev.key === '/' && !typing) (ev.preventDefault(), input.focus());
  if (ev.key === 'Escape' && !peek.hidden) (peek.hidden = true, input.blur());
});
document.addEventListener('click', (ev) => !bar.contains(ev.target) && (peek.hidden = true));
