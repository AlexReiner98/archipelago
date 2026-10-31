// The page's one tooltip. What a control or a mark says of itself is its `title` (or an SVG `<title>`), as it always
// was; this shows it in the page's own tip, in the top layer above every bar and pane, and never lets the browser
// show its own. The browser falls back on any title above what the pointer is on, so while the pointer is on
// something every title from there to the page's root is taken off, and put back only when it moves on: a click or
// a key hides the tip and leaves them off. A drawing's own tip (drawing-tip.js) quiets this one over its mark, and
// over a mark a drawing is told the pointer entered, this one waits for the drawing's answer before it says anything.

import { h } from './base.js';
import { toldOfEnter } from './marks.js';

let box = null;
/** The element whose title is shown: { el, said }. */
let at = null;
/** The titles taken off, to put back: { el, said } of an attribute, { el, title } of an SVG <title>. */
let taken = [];
/** A mark a drawing's own tip speaks for: nothing is shown over it. */
let quiet = null;
/** What to say once the drawing has answered for the mark just entered: { mark, found, open }. */
let awaited = null;

/** The SVG <title> of an element, if it has one. */
const svgTitle = (e) => (e instanceof SVGElement ? [...e.children].find((kid) => kid.tagName.toLowerCase() === 'title') : undefined);
/** Each element at or above `el`, nearest first. */
const upFrom = function* (el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement ?? e.parentNode) yield e;
};

/** The nearest element at or above `el` that says something of itself, and what: an empty title says nothing. */
function titled(el) {
  for (const e of upFrom(el)) {
    if (e === box || e.classList?.contains('drawing-tip')) return null;
    if (e.hasAttribute('title')) return e.getAttribute('title') ? { el: e, said: e.getAttribute('title') } : null;
    const title = svgTitle(e);
    if (title) return title.textContent ? { el: e, said: title.textContent } : null;
  }
  return null;
}

/** Take off every title at or above `el`, so the browser has none to fall back on. */
function takeOff(el) {
  for (const e of upFrom(el)) {
    if (e.hasAttribute('title')) (taken.push({ el: e, said: e.getAttribute('title') }), e.removeAttribute('title'));
    const title = svgTitle(e);
    if (title) (taken.push({ el: e, title }), title.remove());
  }
}

/** Put back what was taken: a title set anew meanwhile is kept. */
function putBack() {
  for (const { el, said, title } of taken) {
    if (title) el.prepend(title);
    else if (!el.hasAttribute('title')) el.setAttribute('title', said);
  }
  taken = [];
}

/** Hide the tip; the titles stay off while the pointer is there. */
function hide() {
  awaited = null;
  if (box?.matches(':popover-open')) box.hidePopover();
}

/** The pointer has left the page: nothing to keep off. */
function gone() {
  hide();
  putBack();
  at = null;
}

/** Below the element, or above it where there is no room; kept inside the window. */
function place(el) {
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth, ht = box.offsetHeight, gap = parseFloat(getComputedStyle(box).getPropertyValue('--tip-gap')) || 0;
  const below = r.bottom + gap + ht <= innerHeight || r.top - gap - ht < 0;
  box.style.left = `${Math.min(Math.max(r.left + r.width / 2 - w / 2, gap), innerWidth - w - gap)}px`;
  box.style.top = `${below ? r.bottom + gap : r.top - gap - ht}px`;
}

/** Show what `found` says: at once when a tip was up, and followed from there; opened afresh, it waits a moment (CSS). */
function say(found, open) {
  box.textContent = found.said;
  box.classList.toggle('at-once', open);
  box.showPopover();
  place(found.el);
}

/** The mark at or above `el`, just entered from outside it, that a drawing is told of: it will answer. */
function entered(el, from) {
  const mark = [...upFrom(el)].find((e) => toldOfEnter.has(e));
  return mark && !mark.contains(from) ? mark : null;
}

function over(ev) {
  if (ev.pointerType === 'touch') return;
  const open = box.matches(':popover-open');
  const was = at?.el;
  putBack();
  const found = titled(ev.target);
  takeOff(ev.target);
  at = found;
  if (found?.el === was) return;
  hide();
  if (!found || quiet?.contains(found.el)) return;
  const mark = entered(ev.target, ev.relatedTarget);
  if (mark) awaited = { mark, found, open };
  else say(found, open);
}

/** Start the tip on this page, once. */
export function startTips() {
  if (box) return;
  box = h('div', { class: 'tip', role: 'tooltip', popover: 'manual' });
  document.body.append(box);
  addEventListener('pointerover', over, true);
  for (const name of ['pointerdown', 'keydown', 'wheel', 'scroll']) addEventListener(name, hide, true);
  addEventListener('blur', (ev) => ev.target === window && gone());
  document.documentElement.addEventListener('pointerleave', gone);
}

/** A drawing's tip is up over `el` (null when it is gone): this one says nothing there. */
export function quietTip(el) {
  quiet = el;
  if (el && awaited && el.contains(awaited.found.el)) awaited = null;
  // The title stays off while the drawing's tip says it, and is put back when the pointer leaves, as ever.
  if (el && at && el.contains(at.el) && box?.matches(':popover-open')) box.hidePopover();
}

/** The drawing has answered for `mark`: if it said nothing there, what the title says is shown after all. */
export function answered(mark) {
  if (awaited?.mark !== mark) return;
  const { found, open } = awaited;
  awaited = null;
  say(found, open);
}
