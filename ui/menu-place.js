// Where an open list goes (every dropdown, ui/menus.css): by what opened it, kept in sight. It opens below where there
// is room for it, else above where there is more room than below, its height held to that room and the rest scrolled;
// it starts at its anchor's left edge (or ends at its right, `end`), and never passes either side of the page.

/** A list over the page (a popover, placed by its own left and top or bottom): put it by `anchor`, in sight. */
export function placeBy(list, anchor, { end = false } = {}) {
  const r = anchor.getBoundingClientRect();
  list.style.maxHeight = '';
  const tall = list.offsetHeight;
  const below = innerHeight - r.bottom;
  const up = tall > below && r.top > below;
  const room = up ? r.top : below;
  list.classList.toggle('up', up);
  if (tall > room) list.style.maxHeight = `${room}px`;
  if (tall > room && getComputedStyle(list).overflowY === 'visible') list.style.overflowY = 'auto';
  // Above, it is held by its foot, so a list that grows (found as typed) grows upward, away from its anchor.
  list.style.top = up ? 'auto' : `${r.bottom}px`;
  list.style.bottom = up ? `${innerHeight - r.top}px` : 'auto';
  const wide = list.offsetWidth;
  list.style.left = `${Math.max(0, Math.min(end ? r.right - wide : r.left, innerWidth - wide))}px`;
}

/**
 * A list placed in the page's flow under its anchor (a menu's, the time entry's picks): opened above instead where it
 * would run off the foot, and from its anchor's other edge where it would run off a side (classes `up`, `start`).
 */
export function keepInSight(list) {
  list.classList.remove('up', 'start');
  const at = list.getBoundingClientRect();
  if (!at.height) return;
  const anchor = (list.parentElement ?? list).getBoundingClientRect();
  if (at.bottom > innerHeight && anchor.top > innerHeight - anchor.bottom) list.classList.add('up');
  if (at.left < 0) list.classList.add('start');
}

// A menu kept in the page's flow is placed each time it opens.
document.addEventListener('toggle', (ev) => {
  const box = ev.target;
  if (box instanceof HTMLDetailsElement && box.classList.contains('menu') && box.open) {
    const list = box.querySelector(':scope > .menu-items');
    if (list) keepInSight(list);
  }
}, true);
