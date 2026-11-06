import { authHeaders, state } from './base.js';
import { said, touched } from './changes.js';
import { numberOf } from './query-base.js';
import { gist, sessionHue } from './words.js';

// ---- traces: what was, until it is seen ---------------------------------------
//
// A change that reached the page from the log (a change set, ui/changes.js) leaves a trace on each mark it touched,
// in its maker's hue: a session's, as its tab has it, else the accent. The trace stays until the person has seen it:
// the mark was in sight for a moment (the style's `trace_seen_after`) while the page was visible. A hidden page or
// pane, or a mark scrolled or panned out of sight, never counts. What waits and what has been seen are kept in this
// browser for each workspace, so a reload keeps a trace not yet seen and does not bring back one that was. Over a
// traced mark the page's one tip (ui/tip.js) says who changed it and why, in a line. Changes the person made here
// are not traced: they saw them made.

/** What waits to be seen, by item id: { key, line, hue, at }; `key` is the item and the position that changed it. */
const waiting = new Map();
/** What has been seen in this browser, by key, with when: a later change to the same item is traced anew. */
let seen = {};
/** Who this page is ({ ws, actor }, as the log names the actor), from /whoami: a change of the person's own is not traced. */
let me;
let asking;
const actorOf = (a) => (typeof a === 'string' ? a : a?.kind ? `${a.kind}:${a.name}` : undefined);
export const whoami = () =>
  (asking ??= fetch('/whoami', { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((j) => {
      me = { ws: j.workspace?.id ?? null, actor: actorOf(j.actor) };
      load(me.ws);
      return me;
    }));
const keyOf = (ws) => `pelago-traces-${ws ?? 'default'}`;

function load(ws) {
  try {
    const kept = JSON.parse(localStorage.getItem(keyOf(ws)) ?? '{}');
    seen = kept.seen ?? {};
    for (const [id, t] of kept.waiting ?? []) if (!seen[t.key]) waiting.set(id, t);
  } catch {
    seen = {};
  }
}
function save() {
  const ws = me?.ws;
  try {
    const now = Date.now();
    // Seen keys are let go after the style's days: a key names a position, never traced again once passed.
    const keep = numberOf(state.style, 'trace_kept_days') * 864e5;
    for (const [k, at] of Object.entries(seen)) if (now - at > keep) delete seen[k];
    localStorage.setItem(keyOf(ws), JSON.stringify({ seen, waiting: [...waiting] }));
  } catch {
    // Without storage a trace lasts as long as the page.
  }
}

/** Who made a change, as a person reads it: the session by its word, else the actor's name. */
export function whoSaid(by) {
  if (by?.word) return `Session ${by.word}`;
  if (by?.name) return by.name;
  const raw = by?.actor ?? '';
  return raw.split(/[/:]/).at(-1) || 'Someone';
}
/** The one line over a traced mark: who, what it did, and why. */
const lineOf = (t) => [`${t.who}, ${t.did.join(', ')}`, t.why].filter(Boolean).join(': ');

/** Trace what a change set touched, each in its maker's hue, until it is seen. */
export async function trace(set) {
  if (!set.items.length && !set.links.length) return;
  const me = await whoami();
  for (const [id, c] of touched(set)) {
    if (c.by?.actor && c.by.actor === me.actor) continue;
    const key = `${id}@${c.pos}`;
    if (seen[key]) continue;
    // A later change by the same maker, not yet seen, adds to what its trace says; another's takes its place.
    const who = whoSaid(c.by);
    const was = waiting.get(id)?.who === who ? waiting.get(id) : undefined;
    const did = [...new Set([...(was?.did ?? []), said(c)])];
    const t = { key, who, did, why: gist(c.by?.reason) || was?.why, hue: sessionHue(c.by?.word ?? '') ?? null, at: c.at };
    waiting.set(id, { ...t, line: lineOf(t) });
  }
  save();
  paint();
}

/** The marks of items on the canvas: those a drawing names by `item`, and the rows that lead to an item's page. */
const MARKS = '#canvas [data-item], #canvas a[href^="#/e/e_"]';
const itemOf = (el) => el.dataset.item ?? /^#\/e\/(e_[a-z0-9]{8})$/.exec(el.getAttribute('href') ?? '')?.[1];

/** The trace on each mark of an item that waits: drawn again whenever a drawing is. */
function paint() {
  for (const el of document.querySelectorAll(MARKS)) {
    const t = waiting.get(itemOf(el));
    if (!t) {
      if (el.dataset.trace !== undefined) clear(el);
      continue;
    }
    if (el.dataset.trace === t.line) continue;
    el.dataset.trace = t.line;
    el.classList.add('traced');
    if (t.hue) el.style.setProperty('--trace-hue', t.hue);
    sight.observe(el);
  }
}
function clear(el) {
  delete el.dataset.trace;
  el.classList.remove('traced');
  el.style.removeProperty('--trace-hue');
  sight.unobserve(el);
  disarm(el);
}

/** Whether a mark can be seen now: the page visible, the mark laid out and not in a hidden pane. */
const inView = (el) => !document.hidden && el.isConnected && (el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true) && !el.closest('[hidden], [inert]');

/** Seen: the trace fades (CSS), and is kept as seen in this browser. */
function sawIt(el) {
  const id = itemOf(el);
  const t = waiting.get(id);
  if (!t || !el.inSight) return;
  // In sight but not to be seen (a pane hidden, a mark faded out): its moment starts again.
  if (!inView(el)) return arm(el);
  seen[t.key] = Date.now();
  waiting.delete(id);
  save();
  const fade = numberOf(state.style, 'trace_fade');
  el.style.setProperty('--trace-fade', `${fade}ms`);
  el.classList.add('trace-seen');
  setTimeout(() => (el.classList.remove('trace-seen'), el.style.removeProperty('--trace-fade'), clear(el)), fade);
}

const disarm = (el) => (clearTimeout(el.traceTimer), cancelAnimationFrame(el.traceFrame));
/**
 * A mark's moment in sight, counted only while the page paints: it starts at a frame, and is seen only if a frame is
 * painted when it is up. A pane out of sight paints none (though it may call itself visible), so its moment waits for
 * the next frame and starts again from there.
 */
function arm(el) {
  disarm(el);
  el.traceFrame = requestAnimationFrame(() => {
    el.traceTimer = setTimeout(() => {
      let painted = false;
      el.traceFrame = requestAnimationFrame(() => ((painted = true), sawIt(el)));
      el.traceTimer = setTimeout(() => painted || arm(el), numberOf(state.style, 'trace_frame_wait'));
    }, numberOf(state.style, 'trace_seen_after'));
  });
}

/** A mark in sight starts its moment; out of sight, or the page hidden, it starts again. */
const sight = new IntersectionObserver((all) => {
  for (const e of all) {
    e.target.inSight = e.isIntersecting;
    if (e.isIntersecting) arm(e.target);
    else disarm(e.target);
  }
}, { threshold: 0.5 });

// The page hidden stops every moment; shown again, what is in sight starts anew.
document.addEventListener('visibilitychange', () => {
  for (const el of document.querySelectorAll('[data-trace]')) {
    disarm(el);
    if (!document.hidden) (sight.unobserve(el), sight.observe(el));
  }
});

// A drawing drawn again makes its marks anew: the traces are painted on them once it is done.
let painting = 0;
new MutationObserver(() => {
  if (!waiting.size || painting) return;
  // A timer, not a frame: a page not being painted (a pane out of sight) still keeps its traces on the marks.
  painting = setTimeout(() => ((painting = 0), paint()));
}).observe(document.getElementById('canvas') ?? document.body, { childList: true, subtree: true });

// What waited when the page was last closed is traced again as soon as the workspace is known.
whoami().then(() => waiting.size && paint());

/** What waits to be seen, for a test or a count: item id and its line. */
export const traces = () => [...waiting].map(([id, t]) => ({ id, line: t.line, hue: t.hue }));
