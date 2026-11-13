// A trace a part answers with (['trace', { item, tip, hue? }]: packs/walls/page/part-check.js): nothing drawn where the mark
// stands, but the item's marks on the canvas painted with it, in its maker's hue, until the person has seen it. The part
// decides what is traced and keeps what was seen; the host paints, and counts the moment: a mark in sight for the
// style's `trace_seen_after` while the page paints (a hidden page or pane, or a mark panned out of sight, never
// counts), then the part is told { key, name: 'seen', item } and the trace fades over `trace_fade`. A trace the part
// stops sending is taken off. Over a traced mark the page's one tip says its line (data-trace, packs/walls/page/tip.js).

import { numberOf } from './style-number.js';

/** What is traced now, by item: { line, hue, tell, key, style, owner }, the owner the element its mark was drawn as. */
const traced = new Map();
/** Traces seen here and fading, by item and line: not painted again while the part still says them. */
const seenHere = new Set();

/** The marks of items on the canvas: those a drawing names by `item`, and the rows that lead to an item's page. */
const MARKS = '#canvas [data-item], #canvas a[href^="#/e/e_"]';
const itemOf = (el) => el.dataset.item ?? /^#\/e\/(e_[a-z0-9]{8})$/.exec(el.getAttribute('href') ?? '')?.[1];

/** A trace mark drawn (again) as `el`: what it says is what is painted on its item's marks. */
export function traceMark(el, node, ctx) {
  const item = node.at.item;
  if (el.pmTrace && el.pmTrace !== item) traceGone(el);
  el.pmTrace = item;
  const hue = node.at.hue !== undefined ? ctx.hue(node.at.hue) ?? null : null;
  traced.set(item, { line: node.at.tip ?? '', hue, tell: ctx.tell, key: node.key, style: ctx.style, owner: el });
  start();
  paintSoon();
}

/** A trace mark gone: its item's marks are let go. */
export function traceGone(el) {
  const item = el.pmTrace;
  if (!item) return;
  delete el.pmTrace;
  if (traced.get(item)?.owner === el) traced.delete(item);
  paintSoon();
}

/** The trace on each mark of an item that waits: drawn again whenever the canvas is. */
function paint() {
  for (const el of document.querySelectorAll(MARKS)) {
    const id = itemOf(el);
    const t = traced.get(id);
    if (!t || seenHere.has(`${id}\n${t.line}`)) {
      if (el.dataset.trace !== undefined && !el.classList.contains('trace-seen')) clear(el);
      continue;
    }
    if (el.dataset.trace === t.line) continue;
    el.dataset.trace = t.line;
    el.classList.add('traced');
    if (t.hue) el.style.setProperty('--trace-hue', t.hue);
    else el.style.removeProperty('--trace-hue');
    sight?.observe(el);
  }
}
function clear(el) {
  delete el.dataset.trace;
  el.classList.remove('traced', 'trace-seen');
  el.style.removeProperty('--trace-hue');
  el.style.removeProperty('--trace-fade');
  sight?.unobserve(el);
  disarm(el);
}

/** Whether a mark can be seen now: the page visible, the mark laid out and not in a hidden pane. */
const inView = (el) => !document.hidden && el.isConnected && (el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true) && !el.closest('[hidden], [inert]');

/** Seen: the part is told, and the trace fades. */
function sawIt(el) {
  const id = itemOf(el);
  const t = traced.get(id);
  if (!t || !el.inSight) return;
  // In sight but not to be seen (a pane hidden, a mark faded out): its moment starts again.
  if (!inView(el)) return arm(el);
  const said = `${id}\n${t.line}`;
  if (!seenHere.has(said)) {
    seenHere.add(said);
    t.tell({ key: t.key, name: 'seen', item: id, value: id });
  }
  const fade = numberOf(t.style, 'trace_fade');
  for (const m of document.querySelectorAll(MARKS)) {
    if (itemOf(m) !== id || m.dataset.trace === undefined) continue;
    m.style.setProperty('--trace-fade', `${fade}ms`);
    m.classList.add('trace-seen');
    disarm(m);
    setTimeout(() => clear(m), fade);
  }
  // Seen keys are let go once the part has had time to stop saying them.
  setTimeout(() => seenHere.delete(said), fade + numberOf(t.style, 'trace_seen_after') * 4);
}

const disarm = (el) => (clearTimeout(el.traceTimer), cancelAnimationFrame(el.traceFrame));
/** A mark's moment in sight, counted only while the page paints: seen only if a frame is painted when it is up. */
function arm(el) {
  disarm(el);
  const style = traced.get(itemOf(el))?.style;
  el.traceFrame = requestAnimationFrame(() => {
    el.traceTimer = setTimeout(() => {
      let painted = false;
      el.traceFrame = requestAnimationFrame(() => ((painted = true), sawIt(el)));
      el.traceTimer = setTimeout(() => painted || arm(el), numberOf(style, 'trace_frame_wait'));
    }, numberOf(style, 'trace_seen_after'));
  });
}

let sight = null;
let painting = 0;
const paintSoon = () => (painting ||= setTimeout(() => ((painting = 0), paint())));

/** Listen to the page once a part traces anything: what comes into sight, the page hidden, the canvas drawn again. */
function start() {
  if (sight) return;
  sight = new IntersectionObserver((all) => {
    for (const e of all) {
      e.target.inSight = e.isIntersecting;
      if (e.isIntersecting) arm(e.target);
      else disarm(e.target);
    }
  }, { threshold: 0.5 });
  document.addEventListener('visibilitychange', () => {
    for (const el of document.querySelectorAll('[data-trace]')) {
      disarm(el);
      if (!document.hidden) (sight.unobserve(el), sight.observe(el));
    }
  });
  // A drawing drawn again makes its marks anew: the traces are painted on them once it is done (a timer, not a frame,
  // so a pane out of sight still keeps them).
  new MutationObserver(() => traced.size && paintSoon()).observe(document.getElementById('canvas') ?? document.body, { childList: true, subtree: true });
}

/** What is traced now, for a test or a count: item and its line. */
export const tracedNow = () => [...traced].map(([item, t]) => ({ item, line: t.line, hue: t.hue }));
