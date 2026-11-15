// A picture in a published document (/p/...): the lens's answer as it was frozen when the document was published,
// drawn by its drawing, read by anyone with no login (and a draft's, read now, on /read/<id>). Nothing is asked of the map: the
// answer is all there is. A part opens nowhere: what it says of itself, its drawing says (in a tip, ui/layout-tip.js).

import { h } from './base.js';
import { drawWith } from './layout.js';
import { dress } from './query-base.js';
import { runBackdrop } from './backdrop.js';
import { drawCode } from './style-code.js';
import { types } from './words.js';

const ITEM = /^#\/e\/(e_[a-z0-9]{8})$/;

/** The items of each picture drawn outside the app, by its host: one listener for all of them puts the address back. */
const outside = new Map();
let listening = false;
function keepAddress(host, byId) {
  outside.set(host, byId);
  if (listening) return;
  listening = true;
  addEventListener('hashchange', () => {
    const id = ITEM.exec(location.hash)?.[1];
    for (const [at, ids] of outside) {
      if (!at.isConnected) outside.delete(at);
      else if (ids.has(id)) return void history.replaceState(null, '', location.pathname);
    }
  });
}

/** A published layout's files: sent with the page, or fetched by their hash. */
const filesOf = (drawing) => (drawing.modules ? Promise.resolve(drawing.modules) : /^\/[^/]/.test(drawing.src ?? '') ? fetch(drawing.src).then((res) => (res.ok ? res.json() : Promise.reject(new Error('its code could not be fetched')))) : Promise.reject(new Error('its code was not sent')));

/**
 * A layout kept on the map run behind the whole page (numbers.page_backdrop, task e_m2wsf8m5): walled in, in a frame
 * fixed to the window (packs/walls/page/backdrop.js). The page's baked frame, where it has one, is its first paint: it
 * fades out once the backdrop has drawn, and stays where the backdrop cannot run.
 */
function drawBackdrop(body, answer, style) {
  const { drawing, ...fields } = style;
  // Live, whatever a picture read here is otherwise: it moves unless its reader asks for less motion, which it is told.
  const { still: _still, ...live } = fields;
  const land = (under) => document.querySelector('body > .page-land')?.classList.toggle('under', under);
  filesOf(drawing).then(
    (code) => runBackdrop({ code, answer, style: live, dressed: body, drew: () => land(true), failed: () => land(false) }),
    () => land(false),
  );
}

/** A view's place on the page taken away: its section, its title and words with it (a section is one view's, by its id). */
function tookAway(host) {
  const section = host.closest('section');
  (section?.contains(host) && section.querySelectorAll('.doc-lens').length === 1 ? section : host).hidden = true;
}

/**
 * A layout kept on the map, published with its code (packs/publish/kernel/published-pictures.ts, codeDrawing): its files
 * fetched by their hash and run in the sandboxed frame the app runs a layout's code in, which may change nothing here.
 */
function drawCoded(body, answer, style) {
  const { drawing, ...fields } = style;
  body.classList.toggle('shaped', Number(style.numbers?.frame_aspect) > 0);
  filesOf(drawing).then(
    (code) => drawCode(body, answer, { ...fields, code }, () => {}),
    (err) => body.replaceChildren(h('div', { class: 'lens-error' }, `This drawing stopped: ${String(err.message).slice(0, 300)}`)),
  );
}

/**
 * A layout kept on the map, baked as its document was published (packs/publish/kernel/published-baked.ts): its SVG,
 * shown as an image, which turns its own colours and runs nothing here.
 */
function drawBaked(body, baked, title) {
  body.replaceChildren(h('img', { class: 'baked', src: baked.src, width: baked.width, height: baked.height, alt: title ?? '', decoding: 'async' }));
}

/**
 * A page's frame, baked as its document was published at a few widths (packs/publish/kernel/published-baked.ts): the land
 * behind the whole page. The width that fits the window is cut to it from the middle; its top stands over the hero, as
 * many periods of its margins as the page is long repeat below that, each cut on a channel of water, and its foot band
 * stands at the page's foot, which is given room for it. Images only: nothing runs.
 */
function drawFrame(body, page, numbers) {
  const widths = page.filter((w) => w.src?.top && w.src.strip && w.src.foot).sort((a, b) => a.width - b.width);
  if (!widths.length) return;
  body.replaceChildren();
  body.classList.add('framed');
  document.querySelector('.page-land')?.remove();
  const land = h('div', { class: 'page-land', 'aria-hidden': 'true' });
  const top = h('img', { class: 'land-top', alt: '', decoding: 'async' }), strip = h('div', { class: 'land-strip' }), foot = h('img', { class: 'land-foot', alt: '', decoding: 'async' });
  // The baked top's lower half, raised to meet the words where the hero is kept lower than it was baked (numbers.frame_room).
  const raised = h('div', { class: 'land-raised' }, h('img', { alt: '', decoding: 'async' }));
  land.append(top, raised, strip, foot);
  document.body.prepend(land);
  let laid = '', wide = 0, tall = 0;
  const lay = () => {
    const room = document.documentElement.clientWidth;
    // The window's height as the page was opened at this width: a phone's bar coming and going moves nothing.
    if (room !== wide) ((wide = room), (tall = innerHeight));
    const w = widths.find((x) => x.width >= room) ?? widths.at(-1);
    const band = w.height - w.foot, left = Math.round((room - w.width) / 2);
    // The hero is as high as it was when the page was baked, or as a share of the window as the view says
    // (numbers.frame_room), so the page's words open in sight; the page's foot leaves room for the band.
    const heroTop = body.getBoundingClientRect().top + scrollY;
    const baked = Math.max(0, w.top - heroTop), share = Number(numbers.frame_room);
    const kept = share > 0 ? Math.min(baked, Math.round(share * tall)) : baked;
    const cut = baked - kept, start = w.top - cut;
    body.style.height = `${kept}px`;
    document.body.style.paddingBottom = `${band}px`;
    // How long the page is without its land: where the last of the rest ends, and the band's room below it.
    const ends = [...document.body.children].filter((el) => el !== land).map((el) => el.getBoundingClientRect().bottom + scrollY);
    const high = Math.ceil(Math.max(0, ...ends)) + band;
    const periods = Math.max(0, Math.floor((high - band - start) / w.period));
    const key = [w.width, room, high, kept].join(' ');
    if (key === laid) return;
    laid = key;
    land.style.height = `${high}px`;
    // The top as baked, down to the middle of the hero kept; below that, its own foot raised by what was cut, fading in
    // over as much of the top as it covers, so the name, the nav and the column each keep the clearing baked for them.
    const half = Math.round(heroTop + kept / 2), over = Math.min(cut, Math.round(kept / 2)), from = half - over;
    Object.assign(top, { src: w.src.top, width: w.width, height: w.top });
    Object.assign(top.style, { left: `${left}px`, width: `${w.width}px`, height: `${w.top}px`, clipPath: cut ? `inset(0 0 ${w.top - half}px 0)` : '' });
    raised.hidden = !cut;
    Object.assign(raised.firstChild, { src: w.src.top, width: w.width, height: w.top });
    Object.assign(raised.firstChild.style, { top: `${-(from + cut)}px`, width: `${w.width}px`, height: `${w.top}px` });
    Object.assign(raised.style, { left: `${left}px`, top: `${from}px`, width: `${w.width}px`, height: `${start - from}px`, maskImage: `linear-gradient(transparent, black ${over}px)` });
    raised.style.webkitMaskImage = raised.style.maskImage;
    // The margins as many times over as the page is long, each the strip baked between the top and the foot, cut on a channel.
    const each = w.foot - w.top;
    Object.assign(strip.style, { left: `${left}px`, top: `${start}px`, width: `${w.width}px`, height: `${periods * w.period}px` });
    strip.replaceChildren(...Array.from({ length: Math.ceil((periods * w.period) / each) }, (_, i) => {
      const piece = h('img', { alt: '', decoding: 'async', src: w.src.strip, width: w.width, height: each });
      Object.assign(piece.style, { top: `${i * each}px`, width: `${w.width}px`, height: `${each}px` });
      return piece;
    }));
    Object.assign(foot, { src: w.src.foot, width: w.width, height: band });
    Object.assign(foot.style, { left: `${left}px`, top: `${high - band}px`, width: `${w.width}px`, height: `${band}px` });
  };
  lay();
  let pending = 0;
  const again = () => (cancelAnimationFrame(pending), (pending = requestAnimationFrame(lay)));
  addEventListener('resize', again);
  document.fonts?.ready.then(again);
  new ResizeObserver(again).observe(document.body);
}

/** Draw one frozen answer into host. `typeTitles` names each type the picture holds. `inApp`: drawn in the app's sheet, whose addresses are its own. `onItem`: a part opens there (a public view opens it in its sheet, ./frozen-chrome.js). */
export function drawFrozen(host, answer, typeTitles = {}, { inApp = false, onItem = null } = {}) {
  for (const [id, title] of Object.entries(typeTitles)) if (!types.has(id)) types.set(id, { id, title });
  // Read here, a picture holds still and asks nothing: no lighting to switch, no zoom, its key always open.
  const style = { ...answer.style, noLit: true, still: true };
  const body = h('div', { class: 'lens-view' });
  host.replaceChildren(body);
  dress(body, style);
  // A view run behind the page takes no room on it, unless it is the page's baked frame too, which lays the page out.
  const backdrop = !inApp && Number(style.numbers?.page_backdrop) > 0 && style.drawing?.coded;
  if (backdrop) drawBackdrop(body, answer, style);
  // Every picture has a drawing: packs/publish/kernel/published.ts gives one to a picture frozen without.
  if (Array.isArray(style.drawing?.baked?.page)) drawFrame(body, style.drawing.baked.page, style.numbers ?? {});
  else if (backdrop) tookAway(host);
  else if (/^\/[^/]/.test(style.drawing?.baked?.src ?? '')) drawBaked(body, style.drawing.baked, answer.lens?.title);
  else if (style.drawing?.coded) drawCoded(body, answer, style);
  else if (style.drawing) drawWith(body, answer, style, () => {});
  else body.replaceChildren(h('div', { class: 'empty' }, 'This view cannot be drawn here.'));
  // A link leaves out what is private; the page says so, rather than reading as a view with nothing in it.
  if (answer.hidden) host.append(h('p', { class: 'muted small' }, `${answer.hidden} ${answer.hidden === 1 ? 'item here is' : 'items here are'} private and not shown.`));
  const byId = new Map(answer.items.map((item) => [item.id, item]));
  // A part is a way to its page in the app; here it leads nowhere, or, where the page can, to its page in a sheet.
  body.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a');
    if (!a) return;
    ev.preventDefault();
    const id = ITEM.exec(a.getAttribute('href') ?? '')?.[1];
    if (id && onItem && byId.has(id)) onItem(id);
  });
  // A shape that opens an item by the address (a bar in time) has the address put back.
  if (!inApp) keepAddress(host, byId);
}
