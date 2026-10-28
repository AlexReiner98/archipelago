// The page's one tooltip. What a control or a mark says of itself is its `title` (or an SVG `<title>`), as it always
// was; this shows it in the page's own tip, in the top layer above every bar and pane, and never lets the browser
// show its own. While the pointer is on it, the title is taken off the element, so the browser has nothing to say;
// it is put back when the pointer leaves. A drawing's own tip (drawing-tip.js) quiets this one over its mark.

import { h } from './base.js';

let box = null;
/** The element whose title is shown: { el, said, title }, `title` an SVG <title> taken off it. */
let at = null;
/** A mark a drawing's own tip speaks for: nothing is shown over it. */
let quiet = null;

/** The nearest element at or above `el` that says something of itself, and what: an empty title says nothing. */
function titled(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement ?? e.parentNode) {
    if (e === box || e.classList?.contains('drawing-tip')) return null;
    if (e.hasAttribute('title')) return e.getAttribute('title') ? { el: e, said: e.getAttribute('title') } : null;
    const title = e instanceof SVGElement && [...e.children].find((kid) => kid.tagName.toLowerCase() === 'title');
    if (title) return title.textContent ? { el: e, said: title.textContent, title } : null;
  }
  return null;
}

/** Put back what was taken: a title set anew meanwhile is kept. */
function hide() {
  if (at?.title) at.el.prepend(at.title);
  else if (at && !at.el.hasAttribute('title')) at.el.setAttribute('title', at.said);
  at = null;
  if (box?.matches(':popover-open')) box.hidePopover();
}

/** Below the element, or above it where there is no room; kept inside the window. */
function place(el) {
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth, ht = box.offsetHeight, gap = parseFloat(getComputedStyle(box).getPropertyValue('--tip-gap')) || 0;
  const below = r.bottom + gap + ht <= innerHeight || r.top - gap - ht < 0;
  box.style.left = `${Math.min(Math.max(r.left + r.width / 2 - w / 2, gap), innerWidth - w - gap)}px`;
  box.style.top = `${below ? r.bottom + gap : r.top - gap - ht}px`;
}

function over(ev) {
  if (ev.pointerType === 'touch') return;
  const found = titled(ev.target);
  if (found?.el === at?.el) return;
  const open = box.matches(':popover-open');
  hide();
  if (!found) return;
  at = found;
  if (found.title) found.title.remove();
  else found.el.removeAttribute('title');
  if (quiet?.contains(found.el)) return;
  box.textContent = found.said;
  // Moving from one titled thing to the next, the tip stays up and follows; opened afresh, it waits a moment (CSS).
  box.classList.toggle('at-once', open);
  box.showPopover();
  place(found.el);
}

/** Start the tip on this page, once. */
export function startTips() {
  if (box) return;
  box = h('div', { class: 'tip', role: 'tooltip', popover: 'manual' });
  document.body.append(box);
  addEventListener('pointerover', over, true);
  for (const name of ['pointerdown', 'keydown', 'wheel', 'blur']) addEventListener(name, hide, true);
  addEventListener('scroll', hide, true);
  document.documentElement.addEventListener('pointerleave', hide);
}

/** A drawing's tip is up over `el` (null when it is gone): this one says nothing there. */
export function quietTip(el) {
  quiet = el;
  // The title stays off while the drawing's tip says it, and is put back when the pointer leaves, as ever.
  if (el && at && el.contains(at.el) && box?.matches(':popover-open')) box.hidePopover();
}
