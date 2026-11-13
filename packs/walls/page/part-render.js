// The host's renderer for parts: checked marks (packs/walls/page/part-check.js) made into the page, under the workspace's style.
// A part answers whole each time it speaks; the renderer keeps what is already drawn where it can, matching a mark by
// its key, else by its kind and place, so a field being typed in keeps its words and its caret. What the person does
// goes back to the part as an event: { key, name, value }, `edit` and `submit` from an input, `pick` from one whose kind is
// a pick (a day, a time, yes or no as 'true' or 'false', one of its values), `press` from a button
// (one in a menu too), `tick` from a note's checklist ({ line, done }). A note is drawn as the item page draws one
// (./body.js), under the style; a tip is the element's title, which the page's one tooltip shows (./tip.js).
// Looks are classes and steps the style gives values to (packs/walls/page/part-marks.css); the renderer writes no colour or length.
// Pan and zoom of a paint surface stay here (packs/walls/page/part-paint.js): the part is never asked where the reader looks.
// A thumb is what whoever hosts the part draws for the view it names (`thumb(view)`): a part never paints one.
// A picture is drawn by whoever hosts the part (`picture(item, el)`), out of what it handed the part, once it is in the page.
// A pane's canvas is drawn by whoever hosts the part too (`frame(at, el, said)`); a web page is framed here, sandboxed.
// A dragged mark goes back as `drop { onto, zone }`, a line between panes as `share { index, at }`, a pane pressed as
// `focus`, a mark with `aux` pressed with the middle button as `close`, and the +N of a box that fits as `press` (value N).

import { isChecked, PICKS } from './part-check.js';
import { paintSurface } from './part-paint.js';
import { renderBody } from './body.js';
// A menu opened is placed in sight (its listener is the page's).
import './menu-place.js';
import { fits, fitOnce } from './part-fits.js';
import { menuSteps } from './part-menu.js';
import { buildPane, frameWeb, layPanes, paneBody, paneGone, sashes } from './part-pane.js';
import { draggable } from './part-drag.js';
import { traceGone, traceMark } from './part-trace.js';

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
 * hosts the part to give it to the part; `thumb(view)` answers with the element that shows a view small, or nothing;
 * `picture(item, el)` draws a picture mark's item into its element; `lights(ids)` lights those items on the canvas
 * while the person points at a mark that names them, and fades the rest (nothing, or an empty list, takes it off). `frame(at, el,
 * said)` draws a canvas at a pane's address in `el` (said(name, value) tells the part what is done in it), answering
 * with a way to stop it; `hue(words)` is a session's hue named by words; `swatch(preset, el)` paints a style preset's
 * colours into `el`, and `tryTheme(preset)` paints this screen alone in one ('' the workspace's own again);
 * `replay({ at, steps } | null)` shows the canvas under the part the missed steps up to `at`, or the map as it is now. `find(q, types, link)` answers the items an item
 * input offers as the person types, and `pick(kind)` the item a pick button waits for on the canvas: each
 * { id, title, type, ways? }, the ways it may be linked to the part's item where a link is asked for. Answers with
 * `draw(node)` for each answer the part gives, and `stop()`.
 */
export function mountPart(root, { tell = () => {}, style, canvas = () => {}, thumb = () => null, picture = () => {}, find = async () => [], pick = async () => null, lights = () => {}, frame = () => null, hue = () => undefined, swatch = () => {}, tryTheme = () => {}, replay = () => {} } = {}) {
  const ctx = { tell, style, canvas, thumb, picture, find, pick, lights, frame, hue, swatch, tryTheme, replay };
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
  // What the host put beside the marks (a count, the lines between panes) is its own to keep or take away.
  for (const el of old) if (!kept.has(el) && drawnFrom.has(wrap ? el.firstElementChild : el)) (gone(el), el.remove());
}

const SVG = 'http://www.w3.org/2000/svg';
const make = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });

function build(node, ctx) {
  let el;
  if (node.mark === 'box') el = make('div', 'pm-box');
  else if (node.mark === 'web') el = make('div', 'pm-web');
  else if (node.mark === 'pane') el = buildPane(ctx.tell);
  else if (node.mark === 'panes') el = make('div', 'pm-panes');
  else if (node.mark === 'trace') (el = make('span', 'pm-trace')), (el.hidden = true);
  else if (node.mark === 'replay') (el = make('span', 'pm-replay')), (el.hidden = true), (el.pmReplay = ctx.replay);
  else if (node.mark === 'swatch') {
    // A swatch is pressed as a button is: the part hears it by its key.
    el = make('button', 'pm-swatch');
    el.type = 'button';
    el.append(make('span', 'pm-swatch-tile'), make('span', 'pm-swatch-name'));
    el.addEventListener('click', () => drawnFrom.get(el)?.key !== undefined && ctx.tell({ key: drawnFrom.get(el).key, name: 'press' }));
  }
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
      // A button that tries a theme paints this screen in it alone, keeping nothing; the part hears the press too.
      if (at.try !== undefined) void Promise.resolve(ctx.tryTheme(at.try)).catch(() => {});
      // A button that copies: its words go to the clipboard, the button says whether they went, and the part hears it.
      if (at.copy !== undefined) return ctx.tell({ key, name: 'press', copied: await copied(el, at.copy) });
      if (!at.pick) return ctx.tell({ key, name: 'press' });
      // A pick waits for the item clicked on the canvas; told back either way, null when it was let go.
      el.setAttribute('aria-pressed', 'true');
      const value = await ctx.pick(at.pick).catch(() => null);
      el.removeAttribute('aria-pressed');
      ctx.tell({ key, name: 'picked', value });
    });
  } else if (node.mark === 'input') el = field(node, ctx);
  else if (node.mark === 'note') el = make('div', 'pm-note');
  else if (node.mark === 'thumb') el = make('span', 'pm-thumb');
  else if (node.mark === 'menu') {
    el = make('details', 'menu pm-menu');
    el.append(make('summary', ''), make('div', 'menu-items'));
    // A choice made shuts the menu, as every menu on the page does.
    el.addEventListener('click', (ev) => ev.target.closest?.('.menu-items button') && (el.open = false));
    menuSteps(el);
  }
  else if (node.mark === 'picture') el = make('div', 'pm-picture');
  else if (node.mark === 'paint') {
    const surface = paintSurface(node, { style: ctx.style, drawn: drawOnPlane });
    surfaces.set(surface.el, surface);
    if (node.at.pixels) ctx.canvas(node.key, surface.pixels);
    drawnFrom.set(surface.el, node);
    tipped(surface.el, node.at.tip);
    return surface.el;
  } else throw new Error(`No way to draw a ${node.mark} on the page`);
  if (['box', 'button', 'pane'].includes(node.mark)) handle(el, ctx);
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
  lit(el, node, ctx, fresh);
  if (['box', 'button', 'pane'].includes(node.mark)) handled(el, node, was, fresh, ctx);
  // Text in a session's hue is that session, marked as every session is (its dot, ui/style.css .who-session).
  if (node.mark === 'text') hued(el, at.hue !== undefined ? ctx.hue(at.hue) : undefined, at.hue !== undefined);
  if (node.mark === 'web') frameWeb(el, at.url, at.reload ?? '');
  if (node.mark === 'trace') return (traceMark(el, node, ctx), el);
  // A replay: the canvas under the part shows the missed steps up to `at`; the host holds the store, the part the timer.
  if (node.mark === 'replay') return (ctx.replay({ at: at.at, steps: at.steps }), el);
  // A swatch is painted by the host from the preset it names, again only for another preset.
  if (node.mark === 'swatch' && (fresh || was.at.preset !== at.preset)) ctx.swatch(at.preset, el.firstElementChild);
  if (node.mark === 'swatch') (el.lastElementChild.textContent = at.label ?? '', at.on ? (el.dataset.on = at.on) : delete el.dataset.on);
  if (node.mark === 'pane') (paneBody(el, node, ctx.frame, ctx.tell), place(el.firstElementChild, node.kids, ctx));
  if (node.mark === 'panes') (el.dataset.key = node.key, (el.pmNode = node), place(el, node.kids, ctx), layPanes(el), sashes(el, node, ctx.tell));
  // A box that fits shows as many of its marks as the page has room for; the host measures, never the part.
  if (node.mark === 'box' && (fresh || Boolean(was.at.fits) !== Boolean(at.fits))) fits(el, Boolean(at.fits));
  if (node.item !== undefined && node.mark !== 'picture') el.dataset.item = node.item;
  else delete el.dataset.item;
  if (node.view !== undefined) el.dataset.view = node.view;
  else delete el.dataset.view;
  // What opens a view is reached by the keyboard too, as a link is.
  if (node.view !== undefined && el.tagName !== 'BUTTON') (el.tabIndex = 0, el.setAttribute('role', 'link'));
  else if (el.tagName !== 'BUTTON' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') (el.removeAttribute('tabindex'), el.removeAttribute('role'));
  // The view's picture is drawn again only when it names another view: the host keeps it current.
  if (node.mark === 'thumb' && (fresh || was.at.view !== at.view)) el.replaceChildren(...[ctx.thumb(at.view)].filter(Boolean));
  // Drawn once it is in the page, where its width is known, and again only for another item.
  if (node.mark === 'picture' && (fresh || was.item !== node.item)) queueMicrotask(() => el.isConnected && (el.replaceChildren(), ctx.picture(node.item, el)));
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
    // Asked open, it opens; it stays as the person leaves it while its key stays.
    if (at.open && (fresh || !was.at.open)) el.open = true;
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
  // Its count goes back by `more` when the part names one: the count is then a button, pressed with how many it holds.
  if (node.mark === 'box') el.fitsMore = at.more !== undefined ? (n) => ctx.tell({ key: drawnFrom.get(el).at.more, name: 'press', value: n }) : null;
  if (node.mark === 'box' && at.fits) fitOnce(el);
  if (node.mark === 'list') place(el, node.kids, ctx, (made) => (make('li', 'pm-row').append(made), made.parentElement));
  return el;
}

/** Put `words` on the clipboard, the button saying Copied for a moment, or Copy failed with the words in its tip to take by hand. */
async function copied(el, words) {
  let done = false;
  try {
    await navigator.clipboard.writeText(words);
    done = true;
  } catch {}
  const said = el.textContent;
  el.textContent = done ? 'Copied' : 'Copy failed';
  if (!done) el.title = words;
  setTimeout(() => el.isConnected && el.textContent !== said && ((el.textContent = drawnFrom.get(el)?.words ?? said), tipped(el, drawnFrom.get(el)?.at.tip, true)), 2000);
  return done;
}

/** A tip is the element's own title; set only when it changes, as the page's tooltip takes a title off while it shows it. */
function tipped(el, tip, again = false) {
  if (tip === drawnTip.get(el) && !again) return;
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
  if (kind === 'panes') cls.push(`pm-dir-${el.dataset.dir ?? at.dir ?? 'row'}`);
  if (at.align) cls.push(`pm-align-${at.align}`);
  if (at.grow) cls.push('pm-grow');
  if (at.wrap) cls.push('pm-wrap');
  if (at.bold) cls.push('pm-bold');
  if (at.fits) cls.push('pm-fits');
  if (at.selected) cls.push('pm-selected');
  if (el.classList.contains('pm-ring')) cls.push('pm-ring');
  el.className = [...(kind === 'menu' ? ['menu'] : []), ...cls].join(' ');
  tipped(el, at.tip);
  for (const [name, scale, value] of [['--pm-gap', 'space', at.gap], ['--pm-pad', 'space', at.pad], ['--pm-size', 'text', at.size]]) {
    if (value === undefined) el.style.removeProperty(name);
    else el.style.setProperty(name, value ? `var(--${scale}-${value})` : '0');
  }
}

/**
 * The items a mark lights while the person points at it (`lights`): the host lights them on the canvas and fades the
 * rest, and takes it off as the pointer leaves or the mark goes. The part is told nothing: pointing is not a gesture.
 */
function lit(el, node, ctx, fresh) {
  const ids = node.at.lights;
  if (fresh) {
    el.addEventListener('pointerenter', () => drawnFrom.get(el)?.at.lights?.length && ctx.lights(drawnFrom.get(el).at.lights));
    el.addEventListener('pointerleave', () => drawnFrom.get(el)?.at.lights?.length && ctx.lights([]));
  }
  if (!ids?.length) el.classList.remove('pm-lights');
  else el.classList.add('pm-lights');
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

/** An element leaving the page: a paint surface in it stops listening, a pane's canvas stops drawing. */
function gone(el) {
  for (const s of [el, ...el.querySelectorAll('.pm-paint')]) surfaces.get(s)?.stop();
  for (const p of [el, ...el.querySelectorAll('.pm-pane')]) if (p.classList?.contains('pm-pane')) paneGone(p);
  for (const t of [el, ...el.querySelectorAll('.pm-trace')]) traceGone(t);
  // A replay no longer said: the canvas is the map as it is now.
  for (const r of [el, ...el.querySelectorAll('.pm-replay')]) r.pmReplay?.(null);
}

/** What a box, a button or a pane may be when it stands for something moved or picked between: listened for once, when made. */
function handle(el, ctx) {
  draggable(el, () => drawnFrom.get(el)?.key, ctx.tell);
  // Pressed with the middle button, a mark with `aux` goes back as `close`; the page's own scroll on that press is not started.
  el.addEventListener('mousedown', (ev) => ev.button === 1 && drawnFrom.get(el)?.at.aux && ev.preventDefault());
  el.addEventListener('auxclick', (ev) => {
    const { key, at } = drawnFrom.get(el) ?? {};
    if (ev.button !== 1 || !at?.aux) return;
    ev.preventDefault();
    ev.stopPropagation();
    ctx.tell({ key, name: 'close' });
  });
  el.addEventListener('animationend', (ev) => ev.animationName.startsWith('pm-ring') && el.classList.remove('pm-ring'));
}

/** A session's hue on an element, or none. */
function hued(el, hue, who = false) {
  if (hue) el.style.setProperty('--session-hue', hue);
  else el.style.removeProperty('--session-hue');
  el.classList.toggle('who-session', who);
}

/** Whether it is selected, the session hue it takes, whether it is dragged or docks, and a ring once as it is asked for. */
function handled(el, node, was, fresh, ctx) {
  const { at } = node;
  if (at.selected !== undefined) el.setAttribute('aria-selected', String(at.selected));
  else el.removeAttribute('aria-selected');
  hued(el, at.hue !== undefined ? ctx.hue(at.hue) : undefined);
  if (at.drag !== undefined) el.dataset.drag = at.drag;
  else delete el.dataset.drag;
  if (at.dock) el.dataset.dock = '';
  else delete el.dataset.dock;
  if (at.key !== undefined) el.dataset.key = at.key;
  if (at.ring && (fresh || !was?.at.ring)) {
    el.classList.remove('pm-ring');
    void el.offsetWidth;
    el.classList.add('pm-ring');
  }
}
