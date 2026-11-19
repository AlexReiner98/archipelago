// A picture drawn again over the one on screen keeps what it says alike (task: draw only what a query edit changes).
// Its svg is built mark by mark, each mark directly in it remembered with what it said; the next scene from the same
// drawing on the same host patches that svg where it stands: a mark said alike keeps its element, one said alike but
// for its move (an island's group moved over, ../../canvas/layouts/flow/isle-local.js) keeps it and is moved, and only
// the rest are made and put in, every one checked as any mark is (./marks.js). Nothing is moved off the page and back,
// so what stayed is neither styled nor laid out again. What the last picture's drawing changed on its marks since
// (a hover's light, a class) is put back first, so a mark kept is the mark as said. The events of every mark go to
// the drawing that drew the picture last.

import { build } from './marks.js';
import { takenOut } from './transition.js';

/** What each svg built here holds: its marks directly in it, the drawing they tell, and what patches changed. */
const held = new WeakMap();

const saidOf = (mark) => JSON.stringify(mark);
/** A mark said without its move: two alike but for where they stand. */
const bareOf = (mark) => (Array.isArray(mark) && mark[1] && 'transform' in mark[1] ? saidOf([mark[0], { ...mark[1], transform: null }, ...mark.slice(2)]) : null);

/** One mark directly in the picture, made, with the keys made in it. */
function made(mark, keys, relay, count) {
  const own = new Map(), el = build(mark, own, relay, true, count);
  for (const [k, v] of own) keys.set(k, v);
  return { said: saidOf(mark), bare: bareOf(mark), key: mark?.[1]?.key, el, keys: [...own] };
}

/** The svg of a scene (`['svg', attrs, ...marks]`), made mark by mark and remembered, for the next to patch. */
export function buildKept(mark, keys, tell) {
  const [tag, attrs = {}, ...kids] = Array.isArray(mark) ? mark : [];
  if (tag !== 'svg') return build(mark, keys, tell);
  const holder = { tell };
  const relay = (...said) => holder.tell(...said);
  const svg = build([tag, attrs], keys, relay), count = { n: 1 };
  const marks = kids.map((kid) => made(kid, keys, relay, count));
  svg.append(...marks.map((e) => e.el));
  held.set(svg, { holder, relay, marks, changed: new Map(), broken: false });
  return svg;
}

/** What a patch is about to change on the marks of `svg`: what each was, the first time, to put back; a mark made or taken anew there cannot be kept. */
export function touched(svg, list, keys) {
  const info = svg && held.get(svg);
  if (!info) return;
  for (const p of Array.isArray(list) ? list : []) {
    const el = keys.get(String(p?.key));
    if (!el || !svg.contains(el)) continue;
    if (!(p.mark || p.remove || p.append)) remember(info, el, p);
    else if (el === svg || !markOf(svg, el, info)) info.broken = true;
  }
}

function markOf(svg, el, info) {
  let top = el;
  while (top && top.parentNode !== svg) top = top.parentNode;
  const entry = info.marks.find((e) => e.el === top);
  if (entry) entry.gone = true;
  return entry;
}

function remember(info, el, p) {
  const was = info.changed.get(el) ?? info.changed.set(el, { attrs: new Map(), text: undefined }).get(el);
  for (const name of [...(p.toggle ? ['class'] : []), ...Object.keys(p.set ?? {})]) if (!was.attrs.has(name)) was.attrs.set(name, el.getAttribute(name));
  if (p.text !== undefined && was.text === undefined) was.text = el.textContent;
}

/**
 * Patch `svg` where it stands into the scene's svg `mark`, as `buildKept` would make it: true where it was, false
 * where it was not built here or cannot be (the page then makes it anew). `keys` gets every key in it; events go to `tell`.
 */
export function keptInto(svg, mark, keys, tell) {
  const info = svg && held.get(svg);
  const [tag, attrs = {}, ...kids] = Array.isArray(mark) ? mark : [];
  if (!info || info.broken || tag !== 'svg' || !svg.isConnected) return false;
  // What the last picture's drawing changed on its marks, put back.
  for (const [el, was] of info.changed) {
    for (const [name, value] of was.attrs) value === null ? el.removeAttribute(name) : el.setAttribute(name, value);
    if (was.text !== undefined) el.textContent = was.text;
  }
  info.changed.clear();
  const free = new Map(), byKey = new Map();
  for (const e of info.marks) {
    if (e.gone || takenOut.has(e.el)) continue;
    (free.get(e.said) ?? free.set(e.said, []).get(e.said)).push(e);
    if (e.key !== undefined && e.bare) byKey.set(e.key, e);
  }
  const used = new Set(), count = { n: 1 };
  const marks = kids.map((kid) => {
    const same = free.get(saidOf(kid))?.find((e) => !used.has(e));
    const moved = !same && kid?.[1]?.key !== undefined && byKey.get(kid[1].key);
    const kept = same ?? (moved && !used.has(moved) && moved.bare === bareOf(kid) ? moved : null);
    if (!kept) return made(kid, keys, info.relay, count);
    used.add(kept);
    if (kept !== same) kept.el.setAttribute('transform', String(kid[1].transform));
    for (const [k, v] of kept.keys) keys.set(k, v);
    return { ...kept, said: saidOf(kid) };
  });
  for (const e of info.marks) if (!used.has(e)) e.el.remove();
  // In the scene's order, moving only what came in out of it.
  let at = svg.firstElementChild;
  for (const e of marks) {
    if (e.el === at) at = at.nextElementSibling;
    else svg.insertBefore(e.el, at);
  }
  for (const name of [...svg.getAttributeNames()]) if (!(name in attrs) && !name.startsWith('data-') && name !== 'viewBox') svg.removeAttribute(name);
  // Its own attributes as the scene says them, but where the plane looks (viewBox), which the plane keeps.
  const root = build([tag, attrs], new Map(), info.relay);
  for (const name of root.getAttributeNames()) if (name !== 'viewBox') svg.setAttribute(name, root.getAttribute(name));
  if (attrs.key !== undefined) keys.set(String(attrs.key), svg);
  info.holder.tell = tell;
  info.marks = marks;
  return true;
}
