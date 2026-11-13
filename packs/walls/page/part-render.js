// The host's renderer for parts: checked marks (packs/walls/page/part-check.js) made into the page, under the workspace's style.
// A part answers whole each time it speaks; the renderer keeps what is already drawn where it can, matching a mark by
// its key, else by its kind and place, so a field being typed in keeps its words and its caret. What the person does
// goes back to the part as an event: { key, name, value }, `edit` and `submit` from an input, `pick` from one whose kind is
// a pick (a day, a time, yes or no as 'true' or 'false', one of its values), `press` from a button
// (one in a menu too), `tick` from a note's checklist ({ line, done }). A note is drawn as the item page draws one
// (./body.js), under the style; a tip is the element's title, which the page's one tooltip shows (./tip.js).
// Looks are classes and steps the style gives values to (packs/walls/page/part-marks.css); the renderer writes no colour or length.
// Pan and zoom of a paint surface stay here (packs/walls/page/part-paint.js): the part is never asked where the reader looks.

import { isChecked, PICKS } from './part-check.js';
import { paintSurface } from './part-paint.js';
import { renderBody } from './body.js';
// A menu opened is placed in sight (its listener is the page's).
import './menu-place.js';

/** What each element was drawn from, and the surface that runs a paint mark. */
const drawnFrom = new WeakMap();
const surfaces = new WeakMap();
/** The tip each element was given last. */
const drawnTip = new WeakMap();
/** The values each field has sent the part, latest last, so its echo is known from a value of its own. */
const sent = new WeakMap();
const told = (el) => sent.get(el) ?? (sent.set(el, []), sent.get(el));
/** How many of a field's values are kept to know an echo by. */
const partTold = 50;

/**
 * Draw a part into `root`. `tell(event)` hears what the person does; `style` is the workspace's style (a paint surface
 * moves by its numbers); `canvas(key, el)` is handed a paint surface's pixel canvas (`pixels: true`) once, for whoever
 * hosts the part to give it to the part. `find(q, types, link)` answers the items an item input offers as the person
 * types, and `pick(kind)` the item a pick button waits for on the canvas: each { id, title, type, ways? }, the ways
 * it may be linked to the part's item where a link is asked for. Answers with `draw(node)` for each answer the part
 * gives, and `stop()`.
 */
export function mountPart(root, { tell = () => {}, style, canvas = () => {}, find = async () => [], pick = async () => null } = {}) {
  const ctx = { tell, style, canvas, find, pick };
  let ended = false;
  return {
    draw(node) {
      if (ended) return;
      if (!isChecked(node)) throw new Error('Only marks the check made are drawn: give the part’s answer to checkMarks first');
      place(root, [node], ctx);
    },
    stop() {
      ended = true;
      for (const el of [...root.children]) gone(el);
      root.replaceChildren();
    },
  };
}

/** Make `kids` the children of `parent`, keeping each element that was drawn from a mark of the same kind and key. */
function place(parent, kids, ctx, wrap = null) {
  const old = [...parent.children];
  const byKey = new Map(), loose = [];
  for (const el of old) {
    const was = drawnFrom.get(wrap ? el.firstElementChild : el);
    if (!was) continue;
    if (was.key !== undefined) byKey.set(was.key, el);
    else loose.push(el);
  }
  const kept = new Set();
  kids.forEach((kid, i) => {
    let el = kid.key !== undefined ? byKey.get(kid.key) : loose.find((e) => !kept.has(e) && drawnFrom.get(wrap ? e.firstElementChild : e)?.mark === kid.mark);
    const inner = el && (wrap ? el.firstElementChild : el);
    if (inner && drawnFrom.get(inner).mark === kid.mark) {
      const now = update(inner, kid, ctx);
      if (!wrap) el = now;
    } else {
      const made = build(kid, ctx);
      el = wrap ? wrap(made) : made;
    }
    kept.add(el);
    // Moved only when it is not already in its place: an element taken out and put back loses the person's focus.
    if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null);
  });
  for (const el of old) if (!kept.has(el)) (gone(el), el.remove());
}

const SVG = 'http://www.w3.org/2000/svg';
const make = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });

function build(node, ctx) {
  let el;
  if (node.mark === 'box') el = make('div', 'pm-box');
  else if (node.mark === 'text' && node.at.href) {
    // An address on the web, opened apart: the page never follows it in place, and tells it nothing of where it came from.
    el = make('a', 'pm-text');
    Object.assign(el, { target: '_blank', rel: 'noopener noreferrer' });
  } else if (node.mark === 'text') el = make('span', 'pm-text');
  else if (node.mark === 'list') el = make('ul', 'pm-list');
  else if (node.mark === 'button') {
    el = make('button', 'pm-button');
    el.type = 'button';
    el.addEventListener('click', async () => {
      const { key, at } = drawnFrom.get(el);
      if (!at.pick) return ctx.tell({ key, name: 'press' });
      // A pick waits for the item clicked on the canvas; told back either way, null when it was let go.
      el.setAttribute('aria-pressed', 'true');
      const value = await ctx.pick(at.pick).catch(() => null);
      el.removeAttribute('aria-pressed');
      ctx.tell({ key, name: 'picked', value });
    });
  } else if (node.mark === 'input') el = field(node, ctx);
  else if (node.mark === 'note') el = make('div', 'pm-note');
  else if (node.mark === 'menu') {
    el = make('details', 'menu pm-menu');
    el.append(make('summary', ''), make('div', 'menu-items'));
    // A choice made shuts the menu, as every menu on the page does.
    el.addEventListener('click', (ev) => ev.target.closest?.('.menu-items button') && (el.open = false));
  }
  else if (node.mark === 'paint') {
    const surface = paintSurface(node, { style: ctx.style, drawn: drawOnPlane });
    surfaces.set(surface.el, surface);
    if (node.at.pixels) ctx.canvas(node.key, surface.pixels);
    drawnFrom.set(surface.el, node);
    tipped(surface.el, node.at.tip);
    return surface.el;
  } else throw new Error(`No way to draw a ${node.mark} on the page`);
  drawnFrom.set(el, node);
  update(el, node, ctx, true);
  return el;
}

/** The browser's own kind of field for each kind of input; a pick is a menu, yes or no a box to tick. */
const FIELD_TYPES = { text: 'text', number: 'number', url: 'url', search: 'search', date: 'date', time: 'datetime-local', check: 'checkbox' };

function field(node, ctx) {
  const kind = node.at.kind ?? 'text';
  if (kind === 'item') return finder(node, ctx);
  const many = (node.at.lines ?? 1) > 1;
  const el = kind === 'pick' ? make('select', 'pm-input') : make(many ? 'textarea' : 'input', 'pm-input');
  if (el.tagName === 'INPUT') el.type = FIELD_TYPES[kind];
  const value = () => (kind === 'check' ? String(el.checked) : el.value);
  const said = (name) => (told(el).push(value()), told(el).splice(0, told(el).length - partTold), ctx.tell({ key: drawnFrom.get(el).key, name, value: value() }));
  // A pick is made the moment it is changed, one gesture; words go back as they are typed, and Enter submits a line.
  if (PICKS.includes(kind)) el.addEventListener('change', () => said('pick'));
  else {
    el.addEventListener('input', () => (said('edit'), fit(el)));
    el.addEventListener('keydown', (e) => !many && e.key === 'Enter' && !e.isComposing && (e.preventDefault(), said('submit')));
  }
  if (node.at.focus) requestAnimationFrame(() => el.isConnected && el.focus({ preventScroll: true }));
  return el;
}

/**
 * An item found by name, as the canvas's search finds one: what the person types is asked of the map here, as them,
 * and only the item they pick goes back to the part ({ name: 'pick', value: { id, title, type, ways? } }); Escape
 * goes back as `leave`.
 */
function finder(node, ctx) {
  const el = make('span', 'pm-finder');
  const input = make('input', 'pm-input');
  input.type = 'search';
  const hits = make('span', 'pm-hits');
  el.append(input, hits);
  let turn = 0;
  const tell = (name, value) => ctx.tell({ key: drawnFrom.get(el).key, name, value });
  input.addEventListener('input', async () => {
    const mine = ++turn;
    const q = input.value.trim();
    const { at } = drawnFrom.get(el);
    const found = q ? await ctx.find(q, at.types, Boolean(at.link)).catch(() => []) : [];
    if (mine !== turn) return;
    hits.replaceChildren(...found.map((x) => {
      const b = make('button', 'pm-hit');
      Object.assign(b, { type: 'button', title: x.title, textContent: x.title });
      b.addEventListener('click', () => tell('pick', x));
      return b;
    }));
  });
  input.addEventListener('keydown', (e) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), tell('leave')));
  if (node.at.focus) requestAnimationFrame(() => input.isConnected && input.focus({ preventScroll: true }));
  return el;
}

/** A box of lines that fits its words is as tall as they are; the scroll it sits in is kept still while it is measured. */
function fit(el) {
  if (el.tagName !== 'TEXTAREA' || !drawnFrom.get(el)?.at.fits) return;
  const scroller = el.closest('#sheet') ?? document.scrollingElement;
  const top = scroller?.scrollTop;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
  if (scroller) scroller.scrollTop = top;
}

/** Set what a mark says on the element drawn from it; `fresh` when it was just made. Answers with the element that stands for it now. */
function update(el, node, ctx, fresh = false) {
  const was = drawnFrom.get(el);
  drawnFrom.set(el, node);
  const { at } = node;
  if (node.mark === 'paint') return (surfaces.get(el).update(node), tipped(el, at.tip), el);
  const remade = node.mark === 'input' ? (at.lines ?? 1) > 1 !== (el.tagName === 'TEXTAREA') || (at.kind ?? 'text') !== (was.at.kind ?? 'text') : node.mark === 'text' && Boolean(at.href) !== Boolean(was?.at.href);
  if (remade) {
    // A field that changes between one line and many, or its kind, is made again; so is text that becomes a way out or stops being one.
    const made = build(node, ctx);
    el.replaceWith(made);
    return made;
  }
  looks(el, node);
  if (node.item !== undefined) el.dataset.item = node.item;
  else delete el.dataset.item;
  if (node.mark === 'note') {
    // Drawn again only when its words, whether it ticks, or the style changed: a section the reader opened stays open.
    if (fresh || was.words !== node.words || was.at.tick !== at.tick || el.drawnUnder !== ctx.style) {
      const tick = at.tick ? (line, done) => ctx.tell({ key: drawnFrom.get(el).key, name: 'tick', value: { line, done } }) : undefined;
      el.replaceChildren(renderBody(node.words, { ...(ctx.style && { style: ctx.style }), tick }));
      el.drawnUnder = ctx.style;
    }
  } else if (node.words !== undefined && (fresh || was.words !== node.words)) el.textContent = node.words;
  if (node.mark === 'menu') {
    el.firstElementChild.textContent = at.label;
    place(el.lastElementChild, node.kids, ctx);
  }
  if (node.mark === 'button' || node.mark === 'input') at.label !== undefined ? el.setAttribute('aria-label', at.label) : el.removeAttribute('aria-label');
  if (node.mark === 'input' && at.kind === 'item') el.firstElementChild.placeholder = at.hint ?? '';
  else if (node.mark === 'input') {
    el.placeholder = at.hint ?? '';
    if (el.tagName === 'TEXTAREA') el.rows = at.lines;
    // A pick offers its values, made again only when they change.
    if (el.tagName === 'SELECT' && (fresh || JSON.stringify([was.at.values, was.at.names]) !== JSON.stringify([at.values, at.names]))) {
      el.replaceChildren(...at.values.map((v, i) => Object.assign(document.createElement('option'), { value: v, textContent: at.names?.[i] ?? v })));
    }
    // The person's words are theirs while they type: in the field they are in, a value the part answers with that is
    // one they already sent (an echo, perhaps behind what they have typed since) is let be; a value of the part's own
    // (the field cleared once its words were taken) is set.
    const value = at.value ?? '';
    const heard = told(el);
    const now = at.kind === 'check' ? String(el.checked) : el.value;
    if (now !== value && (document.activeElement !== el || !heard.includes(value))) {
      if (at.kind === 'check') el.checked = value === 'true';
      else el.value = value;
      heard.length = 0;
    }
    if (fresh) requestAnimationFrame(() => fit(el));
  }
  if (node.mark === 'text' && at.href && el.getAttribute('href') !== at.href) el.setAttribute('href', at.href);
  if (node.mark === 'box') place(el, node.kids, ctx);
  if (node.mark === 'list') place(el, node.kids, ctx, (made) => (make('li', 'pm-row').append(made), made.parentElement));
  return el;
}

/** A tip is the element's own title; set only when it changes, as the page's tooltip takes a title off while it shows it. */
function tipped(el, tip) {
  if (tip === drawnTip.get(el)) return;
  if (tip === undefined) el.removeAttribute('title');
  else el.setAttribute('title', tip);
  drawnTip.set(el, tip);
}

/** A mark's looks as classes and steps of the style's scales, set whole each time. */
function looks(el, node) {
  const { at, mark: kind } = node;
  const cls = [`pm-${kind}`];
  if (at.look) cls.push(`pm-${kind}-${at.look}`);
  if (at.tone) cls.push(`pm-tone-${at.tone}`);
  if (at.flow) cls.push(`pm-flow-${at.flow}`);
  if (at.align) cls.push(`pm-align-${at.align}`);
  if (at.grow) cls.push('pm-grow');
  if (at.wrap) cls.push('pm-wrap');
  if (at.bold) cls.push('pm-bold');
  el.className = [...(kind === 'menu' ? ['menu'] : []), ...cls].join(' ');
  tipped(el, at.tip);
  for (const [name, scale, value] of [['--pm-gap', 'space', at.gap], ['--pm-pad', 'space', at.pad], ['--pm-size', 'text', at.size]]) {
    if (value === undefined) el.style.removeProperty(name);
    else el.style.setProperty(name, value ? `var(--${scale}-${value})` : '0');
  }
}

/** A mark on a paint surface: a path or placed text, in the surface's own units. */
function drawOnPlane(node) {
  const { at } = node;
  const el = document.createElementNS(SVG, node.mark === 'path' ? 'path' : 'text');
  const cls = [`pm-${node.mark}`];
  if (at.look) cls.push(`pm-${node.mark}-${at.look}`);
  if (at.tone) cls.push(`pm-tone-${at.tone}`);
  if (at.bold) cls.push('pm-bold');
  el.setAttribute('class', cls.join(' '));
  if (node.item !== undefined) el.dataset.item = node.item;
  if (node.mark === 'path') {
    el.setAttribute('d', at.d);
    if (at.weight) el.style.setProperty('--pm-weight', `var(--border-${at.weight})`);
  } else {
    el.setAttribute('x', String(at.x));
    el.setAttribute('y', String(at.y));
    if (at.anchor) el.setAttribute('text-anchor', at.anchor);
    if (at.size) el.style.setProperty('--pm-size', `var(--text-${at.size})`);
    el.textContent = node.words;
  }
  return el;
}

/** An element leaving the page: a paint surface in it stops listening. */
function gone(el) {
  for (const s of [el, ...el.querySelectorAll('.pm-paint')]) surfaces.get(s)?.stop();
}
