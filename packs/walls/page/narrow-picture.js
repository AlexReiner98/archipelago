// An edit that only narrows what a canvas holds changes the picture on screen at once (task e_ws9e2acq): the canvas
// drawn for the new query takes the marks the old one shows, and what left the answer fades out of them, with the
// wires and what else stood only for it. The drawing then lays out the new answer as always, and its scene, when it
// lands, is matched against these marks (./transition.js): what stayed glides to its new place. The picture it settles
// on is the drawing's, from the answer alone; only the moment between is the page's.
//
// The page knows no drawing: it reads the marks. An item is a mark that names it (`item`); a wire is a line whose
// ends touch what it joins, within the style's narrow_touch. A wire goes with an item it touches that left, then any
// left touching fewer than two things it touched before (a comb whose last leaf went); a head (a small closed shape)
// with every wire it sat on; a frame (an island) once nothing it held stays; a label or badge on what went.
// Faded rather than cut: a mark that just vanishes reads as a glitch, one that fades as gone (the style's motion_narrow
// long; at once where less motion is asked for).

import { handOver, takenOut } from './transition.js';

/** A line's points, in the root's units: each run of the path (M…L…, Z closing it), with whether it is closed. */
function runsOf(el, toRoot) {
  const m = toRoot, pt = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  const tag = el.tagName;
  if (tag === 'line') return [{ pts: [pt(+el.getAttribute('x1'), +el.getAttribute('y1')), pt(+el.getAttribute('x2'), +el.getAttribute('y2'))], closed: false }];
  if (tag === 'polyline' || tag === 'polygon') {
    const n = String(el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push(pt(n[i], n[i + 1]));
    return [{ pts, closed: tag === 'polygon' }];
  }
  const d = String(el.getAttribute('d') ?? '');
  // Only lines are read: a path that curves is a shape, not a wire, and is left to its frame.
  if (/[^MLHVZmlhvz\d\s.,eE+-]/.test(d)) return null;
  const runs = [];
  let run = null, x = 0, y = 0;
  for (const [, c, args] of d.matchAll(/([MLHVZmlhvz])([^MLHVZmlhvz]*)/g)) {
    const v = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    const rel = c === c.toLowerCase(), C = c.toUpperCase();
    if (C === 'Z') {
      if (run) run.closed = true;
      continue;
    }
    for (let i = 0; i < v.length; ) {
      if (C === 'H') (x = rel ? x + v[i] : v[i]), i++;
      else if (C === 'V') (y = rel ? y + v[i] : v[i]), i++;
      else (x = rel ? x + v[i] : v[i]), (y = rel ? y + v[i + 1] : v[i + 1]), (i += 2);
      if (C === 'M' && (i <= 2)) runs.push((run = { pts: [], closed: false }));
      run.pts.push(pt(x, y));
    }
  }
  return runs.filter((r) => r.pts.length);
}

const nearBox = (p, b, t) => p.x >= b.x - t && p.x <= b.x + b.w + t && p.y >= b.y - t && p.y <= b.y + b.h + t;
/** Whether a point lies within t of a wire: inside its box (grown by t), then on one of its stretches. */
const nearWire = (p, w, t) => {
  if (!nearBox(p, w.box, 0)) return false;
  const s = w.segs, tt = t * t;
  for (let i = 0; i < s.length; i += 4) {
    const dx = s[i + 2] - s[i], dy = s[i + 3] - s[i + 1], len = dx * dx + dy * dy;
    const k = len ? Math.max(0, Math.min(1, ((p.x - s[i]) * dx + (p.y - s[i + 1]) * dy) / len)) : 0;
    const ex = p.x - s[i] - k * dx, ey = p.y - s[i + 1] - k * dy;
    if (ex * ex + ey * ey <= tt) return true;
  }
  return false;
};
/** A wire's stretches, flat (x1, y1, x2, y2 each), and its ends, each once. */
const segsOf = (runs) => runs.flatMap((r) => (r.pts.length === 1 ? [r.pts[0].x, r.pts[0].y, r.pts[0].x, r.pts[0].y] : r.pts.slice(1).flatMap((b, i) => [r.pts[i].x, r.pts[i].y, b.x, b.y])));
const endsOf = (runs) => {
  const all = runs.flatMap((r) => [r.pts[0], r.pts.at(-1)]);
  return all.filter((p, i) => all.findIndex((q) => q.x === p.x && q.y === p.y) === i);
};
const overlap = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const grow = (b, t) => ({ x: b.x - t, y: b.y - t, w: b.w + 2 * t, h: b.h + 2 * t });

/** A mark's box in the root's units. */
function boxOf(el, toRoot) {
  const b = el.getBBox();
  const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => ({ x: toRoot.a * x + toRoot.c * y + toRoot.e, y: toRoot.b * x + toRoot.d * y + toRoot.f }));
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Each picture's index, by its root: what is drawn where, read once (pictureIndex), so a narrowing reads none of it. */
const indexes = new WeakMap();

/**
 * What the picture in `svg` holds and what touches what, in its root's units, so that what stands only for some items
 * is found without measuring again (goneMarks): its items' boxes, its wires and what each touches, its heads and the
 * wires each points along, and its other marks with the items they frame and the wires near them. Read off the page,
 * so only while the picture is on it; kept until the picture is replaced. `touch` is how near a wire's end must come
 * to what it joins.
 */
export function pictureIndex(svg, touch) {
  const kept = indexes.get(svg);
  if (kept?.touch === touch) return kept;
  const rootInv = svg.isConnected ? svg.getScreenCTM()?.inverse() : null;
  if (!rootInv) return null;
  const toRoot = (el) => rootInv.multiply(el.getScreenCTM() ?? new DOMMatrix());
  const items = [...svg.querySelectorAll('[data-item]')].filter((el) => !el.parentElement.closest('[data-item]'));
  const itemOf = new Set(items);
  const boxes = items.map((el) => ({ el, id: el.dataset.item, box: boxOf(el, toRoot(el)) }));
  // The smallest item drawn: a closed shape smaller than it is a head on a wire, not a frame.
  const least = Math.min(...boxes.map((b) => Math.min(b.box.w, b.box.h)));
  const wires = [], heads = [], rest = [];
  // The marks: what is in the root, and one level into a group there (a layer), but never inside an item.
  const marks = [...svg.children].flatMap((el) => (el.tagName === 'g' && !el.hasAttribute('data-item') ? [el, ...el.children] : [el]));
  for (const el of marks) {
    if (itemOf.has(el) || el.closest('[data-item]') || !(el instanceof SVGGraphicsElement)) continue;
    let box, at;
    try {
      at = toRoot(el);
      box = boxOf(el, at);
    } catch {
      continue;
    }
    const geometric = el instanceof SVGGeometryElement && !['rect', 'circle', 'ellipse'].includes(el.tagName);
    const runs = geometric ? runsOf(el, at) : null;
    if (runs?.length && runs.every((r) => !r.closed)) wires.push({ el, box: grow(box, touch), segs: segsOf(runs), ends: endsOf(runs), pts: runs.flatMap((r) => r.pts) });
    else if (runs?.length && runs.every((r) => r.closed) && Math.max(box.w, box.h) < least) heads.push({ el, tip: runs[0].pts[0] });
    else rest.push({ el, box });
  }
  // What each wire touches: items by their box, other wires where an end of one lies on the other.
  for (const w of wires) ((w.items = boxes.filter((b) => w.ends.some((p) => nearBox(p, b.box, touch)))), (w.wires = []));
  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    for (let j = i + 1; j < wires.length; j++) {
      const o = wires[j];
      if (overlap(w.box, o.box) && (w.ends.some((p) => nearWire(p, o, touch)) || o.ends.some((p) => nearWire(p, w, touch)))) (w.wires.push(o), o.wires.push(w));
    }
  }
  // A head points along each wire that ends where its tip is, at the item its tip touches.
  const tt = (touch / 2) ** 2;
  for (const hd of heads) {
    hd.on = wires.filter((w) => nearBox(hd.tip, w.box, 0) && w.ends.some((p) => (p.x - hd.tip.x) ** 2 + (p.y - hd.tip.y) ** 2 <= tt));
    hd.at = boxes.filter((b) => nearBox(hd.tip, b.box, touch / 2));
  }
  // A frame holds the items whose middles it covers; a label or badge lies over items and by wires.
  const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  for (const r of rest) {
    r.held = boxes.filter((b) => nearBox(centre(b.box), r.box, 0));
    r.over = boxes.filter((b) => overlap(r.box, b.box));
    r.near = wires.filter((w) => overlap(r.box, w.box) && w.pts.some((p) => nearBox(p, r.box, touch)));
  }
  const index = { touch, boxes, wires, heads, rest };
  indexes.set(svg, index);
  return index;
}

/** The marks of an indexed picture that stand only for the items in `gone`, the outermost of each. */
export function goneMarks(index, gone) {
  const out = new Set(index.boxes.filter((b) => gone.has(b.id)).map((b) => b.el));
  const left = (list) => list.filter((x) => !out.has(x.el)).length;
  for (const w of index.wires) if (w.items.some((b) => out.has(b.el))) out.add(w.el);
  // Then, until nothing more goes: a wire left touching fewer than two things, where it touched more.
  for (let more = true; more; ) {
    more = false;
    for (const w of index.wires) if (!out.has(w.el) && left(w.items) + left(w.wires) < Math.min(2, w.items.length + w.wires.length)) (out.add(w.el), (more = true));
  }
  // A head goes with what it points at, or with every wire it points along.
  for (const hd of index.heads) if (hd.at.some((b) => out.has(b.el)) || (hd.on.length && !left(hd.on))) out.add(hd.el);
  // A frame goes once nothing it held stays; a label or a badge with what it lay on.
  for (const r of index.rest) {
    if (r.held.length) {
      if (!left(r.held)) out.add(r.el);
      continue;
    }
    const onGone = r.over.length > left(r.over) || r.near.length > left(r.near);
    if (onGone && !left(r.over) && !left(r.near)) out.add(r.el);
  }
  return [...out].filter((el) => {
    for (let up = el.parentElement; up && up.tagName !== 'svg'; up = up.parentElement) if (out.has(up)) return false;
    return true;
  });
}

/** The picture a view shows, if it is one this can narrow: an SVG on a stage. */
const pictureIn = (view) => view?.querySelector(':scope > .lf-stage > svg, :scope > .lf-beside > .lf-stage > svg') ?? null;

/** How near a wire's end must come to what it joins: the style's narrow_touch. */
const touchOf = (style) => {
  const touch = Number(style?.sizes?.narrow_touch);
  if (!Number.isFinite(touch)) throw new Error('The style names no size "narrow_touch": the house style (core.house, packs/canvas/pack.json) names it');
  return touch;
};

/**
 * Index the picture a view shows while the page is idle, each time it is drawn, so an edit that narrows it measures
 * nothing (pictureIndex). `style` is what it is drawn with, as it is then.
 */
export function indexWhenIdle(view, style) {
  const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 0));
  view.addEventListener('view-drawn', () => idle(() => {
    const svg = pictureIn(view);
    if (svg && style()?.sizes?.narrow_touch !== undefined) pictureIndex(svg, touchOf(style()));
  }, { timeout: 1000 }));
}

/** Index the picture a view shows now, if it is not yet: while it is still on the page (an edit, before its pane goes). */
export function indexNow(view, style) {
  const svg = pictureIn(view);
  if (svg && style?.sizes?.narrow_touch !== undefined) pictureIndex(svg, touchOf(style));
}

/**
 * The picture shown in `from` (a canvas's view) handed to `to`, the view drawn for a query that only narrows it, with
 * the items in `gone` taken out at once. Whether it was: false where there is no picture to hand (nothing mounted,
 * one the page lays out, nothing gone), and `to` then draws as it always has.
 */
export function narrowPicture(to, from, gone) {
  const svg = gone?.size ? pictureIn(from) : null;
  if (!svg) return false;
  const style = handOver(from, to, true);
  if (!style) return false;
  const touch = touchOf(style), fade = Number(style.numbers?.motion_narrow);
  if (!Number.isFinite(fade)) throw new Error('The style names no number "motion_narrow": the house style (core.house, packs/canvas/pack.json) names it');
  // Its drawing stops: the marks stay as they are until the new scene replaces them.
  from.endDrawing?.();
  for (const { name, value } of [...from.attributes]) to.setAttribute(name, value);
  Object.assign(to, { moves: from.moves, scene: from.scene });
  from.moves = undefined;
  to.replaceChildren(...from.childNodes);
  const reduced = Boolean(style.reduced) || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const take = (index) => {
    const marks = goneMarks(index, gone);
    for (const el of marks) {
      takenOut.add(el);
      el.setAttribute('aria-hidden', 'true');
      el.style.pointerEvents = 'none';
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 0 : fade, easing: 'ease-out', fill: 'forwards' });
    }
    to.narrowedMarks = marks.length;
    // The first frame that shows it, for whoever measures the page: from the edit (lens-edit) to here.
    requestAnimationFrame(() => {
      performance.mark('lens-narrow-shown', { detail: { marks: marks.length } });
      if (performance.getEntriesByName('lens-edit', 'mark').length) performance.measure('narrow shown', { start: 'lens-edit', end: 'lens-narrow-shown', detail: { marks: marks.length } });
    });
  };
  const index = pictureIndex(svg, touch);
  if (index) return take(index), true;
  // Not indexed, and off the page (its pane drawn anew): measured once the view drawn for the new query is on it,
  // before the frame that shows it is painted, unless the new scene came first.
  let frames = Number(style.numbers?.motion_narrow_wait) || 0;
  const later = () => {
    if (!to.contains(svg)) return;
    const now = pictureIndex(svg, touch);
    if (now) take(now);
    else if (frames-- > 0) requestAnimationFrame(later);
  };
  queueMicrotask(later);
  return true;
}
