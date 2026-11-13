// A menu a part answers with (packs/walls/page/part-render.js): what is done rarely, behind a few words, in steps. A
// menu in a menu is the next step: its words lead on (›), and opened, it is all the menu shows, its words now the way
// back (‹). A field that finds (kind search) narrows the choices of its step here, in the page, and Enter takes the
// first one left; Backspace in it, empty, goes back a step. A field of words still submits, and one that finds an item
// finds it, as anywhere. The steps are the page's own <details>, so a step opened stays open across the part's
// answers, and the menu shut starts again at its first step.

/** Make `el` (a details drawn from a menu mark) answer the keys and the narrowing of its steps. Once, when it is made. */
export function menuSteps(el) {
  el.addEventListener('toggle', () => {
    // Shut, it forgets its steps: the next time it opens at its first.
    if (!el.open) for (const step of el.querySelectorAll('details.pm-menu[open]')) step.open = false;
    // Opened, its field that finds takes the keys, as the page's every list does.
    else el.querySelector(':scope > .menu-items input[type="search"]')?.focus({ preventScroll: true });
  });
  // A step's field, heard before the field itself: here Enter takes a choice and Backspace goes back.
  el.addEventListener('keydown', (ev) => {
    const field = finding(ev.target, el);
    if (!field) return;
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      ev.stopPropagation();
      const first = choices(field.closest('.menu-items')).find((c) => !c.classList.contains('pm-narrowed'));
      if (first?.tagName === 'DETAILS') first.open = true;
      else first?.click();
    } else if (ev.key === 'Backspace' && !field.value && inMenu(el)) {
      ev.preventDefault();
      ev.stopPropagation();
      el.open = false;
      el.querySelector(':scope > summary')?.focus({ preventScroll: true });
    }
  }, true);
  el.addEventListener('input', (ev) => {
    const field = finding(ev.target, el);
    if (field) narrow(field.closest('.menu-items'), field.value);
  });
}

/** Whether `el` is a step of another menu. */
const inMenu = (el) => Boolean(el.parentElement?.closest('details.pm-menu'));

/** The field of this menu's own step that finds, if `target` is one; a field of a step inside it is that step's. */
function finding(target, el) {
  if (!(target instanceof HTMLInputElement) || target.type !== 'search' || !target.classList.contains('pm-input')) return null;
  return target.closest('details.pm-menu') === el ? target : null;
}

/** The choices a step offers: its buttons and the steps it leads on to, wherever they sit in it, not inside a deeper step. */
export function choices(items) {
  if (!items) return [];
  const all = [...items.querySelectorAll('button.pm-button, details.pm-menu')];
  return all.filter((c) => (c.parentElement?.closest('details.pm-menu') ?? null) === items.parentElement);
}

/** Show only the choices of a step whose words hold `q`, a case apart; with none, every choice. */
export function narrow(items, q) {
  const want = String(q ?? '').trim().toLowerCase();
  for (const c of choices(items)) {
    const said = (c.tagName === 'DETAILS' ? c.querySelector(':scope > summary')?.textContent : c.textContent) ?? '';
    c.classList.toggle('pm-narrowed', Boolean(want) && !said.toLowerCase().includes(want));
  }
}

/** Which choices a step keeps for these words (the same test as `narrow`, without a page): by each choice's words. */
export const kept = (said, q) => {
  const want = String(q ?? '').trim().toLowerCase();
  return said.filter((s) => !want || s.toLowerCase().includes(want));
};
