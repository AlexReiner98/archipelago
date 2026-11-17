// A layout kept on the map run as a page's backdrop (task e_m2wsf8m5): its code, walled in as any layout's code is
// (packs/walls/page/draw.js), in a frame fixed to the window behind everything else on the page, told only numbers and
// boxes of the page (its size, its scroll, its window and where its words are), never the page itself.
//
// What its code hears, with on('page', fn), and is handed first as `page`:
//   { visible: true, width, height, scroll, margin, view: { width, height }, clear: [{ x, y, w, h }, ...], reducedMotion }
//   { visible: false, reducedMotion }, when the tab is hidden: it pauses itself until it hears the page again.
//   and `focus: { x, y, w, h } | null`, the box of the page's call to action (the link of its first p.action).
// Coordinates are the page's own (from its top left); `view` is the window less its scrollbar, as the frame is; `clear`
// holds a box for each block of its words (pageWords: the nav, the title, each paragraph, list and figure, the foot),
// read again only when the page's size or words change, never because it scrolled.
//
// What its code may tell the page, with look({ ink, light, land, water, accent }): colours, each a hex, that the page
// wears as custom properties on its root (--backdrop-ink, ...), so a button may wear the palette the land is in. Names
// it leaves out are taken away; the frame and the page each check them (lookOf), and the code never touches the page.
//
// Its frame is fixed to the window, and moves with the page only when the code draws again: on a fast scroll the land
// trails the words. Code that draws `margin` more above and below the window and says, after each frame, where on the
// page its canvas's top stands (drawn(top): scroll - margin) is shown there instead: its frame is then made as tall as
// the page and scrolls with it, so the land moves with the words exactly, and only a new frame moves it on the page.

import { frameSandbox, h } from './base.js';
import { STYLE_COLORS } from './query-base.js';
import { pageWords } from './style-code.js';

const n = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
const box = (b) => ({ x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) });

/**
 * Where the page's words stand, as its backdrop is told them: a box for each block (`clear`) and its call to action
 * (`focus`, or null). Page coordinates: a scroll does not move them, so they are read once and again only when the
 * page's size or content changes (runBackdrop), never on a scrolled frame (a read forces a layout).
 */
export function wordsSaid(doc = document, win = window) {
  const words = pageWords(doc, win);
  return { clear: words.blocks.map(box), focus: words.focus && box(words.focus) };
}

/** The page as its backdrop is told it: numbers and boxes, rounded, nothing else. `words` are wordsSaid's, kept. */
export function pageSaid(reducedMotion, words) {
  if (document.hidden) return { visible: false, reducedMotion };
  const root = document.documentElement;
  // Half a window above and below it: as far as a fast scroll goes before the next frame.
  return { visible: true, reducedMotion, width: n(root.clientWidth), height: n(root.scrollHeight), scroll: n(scrollY), margin: n(root.clientHeight / 2), view: { width: n(root.clientWidth), height: n(root.clientHeight) }, clear: words().clear, focus: words().focus };
}

/** The colours a backdrop may tell its page, each set on the page as `--backdrop-<name>`. */
export const LOOK_NAMES = ['ink', 'light', 'land', 'water', 'accent'];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A look as the page takes it: only LOOK_NAMES, each a hex colour; anything else is dropped. Not an object, nothing. */
export function lookOf(said) {
  if (!said || typeof said !== 'object') return {};
  return Object.fromEntries(LOOK_NAMES.filter((name) => typeof said[name] === 'string' && HEX.test(said[name])).map((name) => [name, said[name].toLowerCase()]));
}

/** Dresses the page in a look: each colour set as a custom property on its root, those it does not name taken away. */
export function wear(look, root = document.documentElement) {
  for (const name of LOOK_NAMES) look[name] ? root.style.setProperty(`--backdrop-${name}`, look[name]) : root.style.removeProperty(`--backdrop-${name}`);
}

/**
 * Run `code` (a layout's files) as the page's backdrop, its colours read from `dressed` (the view's own element, its
 * style's colours set on it). `drew()` is called once its frame has painted, `failed(why)` if its code stops or cannot
 * start; the frame is then taken away. Only one backdrop runs on a page: a second replaces the first. `under`: the
 * element it is put before, so what follows it on the page is drawn over it (the app's map); else it is put last.
 */
export function runBackdrop({ code, answer, style, dressed, under, drew = () => {}, failed = () => {} }) {
  document.querySelector('body > iframe.page-backdrop')?.remove();
  const frame = h('iframe', { class: 'page-backdrop', sandbox: frameSandbox(), src: '/draw.html', title: 'The page’s backdrop', 'aria-hidden': 'true', tabindex: '-1' });
  const colours = Object.fromEntries(STYLE_COLORS.map((name) => [name, getComputedStyle(dressed).getPropertyValue(`--ln-${name}`).trim()]));
  const theme = { ...colours, dark: matchMedia('(prefers-color-scheme: dark)').matches };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let pending = 0, done = false, scrolls = false, refit = false, words = null, worn = '{}';
  const kept = () => (words ??= wordsSaid());
  // A frame that scrolls with the page is as tall as the page without it, and says where its top stands on the page.
  const fit = () => {
    refit = false;
    if (!scrolls) return;
    frame.style.height = '0';
    frame.style.height = `${document.documentElement.scrollHeight}px`;
    frame.contentWindow?.postMessage({ type: 'scrolling', top: frame.getBoundingClientRect().top + scrollY }, '*');
  };
  const tell = () => frame.isConnected && frame.contentWindow?.postMessage({ type: 'page', page: pageSaid(motion.matches, kept) }, '*');
  // Told at most once a frame, however often the page scrolls or moves.
  const soon = () => pending || (pending = requestAnimationFrame(() => ((pending = 0), refit && fit(), tell())));
  // The page changed size or content: its words are read again, once, when it is next told.
  const moved = () => ((refit = true), (words = null), soon());
  const sizes = new ResizeObserver(moved);
  // A picture drawing itself in a view on the page (marks patched each frame) moves no words: only the rest is heard.
  const aboutWords = (r) => !(r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest('.doc-lens');
  const content = new MutationObserver((records) => records.some(aboutWords) && moved());
  const stop = () => {
    removeEventListener('message', hear);
    removeEventListener('scroll', soon);
    removeEventListener('resize', moved);
    document.removeEventListener('visibilitychange', tell);
    motion.removeEventListener('change', tell);
    document.fonts?.removeEventListener?.('loadingdone', moved);
    sizes.disconnect();
    content.disconnect();
    wear({});
    frame.remove();
  };
  const hear = (ev) => {
    if (ev.source !== frame.contentWindow) return;
    const said = ev.data ?? {};
    // The page first, so the code is handed it as it starts; then what it is to draw.
    if (said.type === 'ready') (tell(), frame.contentWindow.postMessage({ type: 'draw', code, answer, style, theme }, '*'));
    else if (said.type === 'drew' && !done) ((done = true), frame.classList.add('drew'), drew());
    // Its code says where on the page it draws: the frame scrolls with the page from now on.
    else if (said.type === 'scrolls' && !scrolls) ((scrolls = true), frame.classList.add('scrolls'), fit());
    // Its code tells the page its look (look() in its worker): checked again here, and worn only when it changes.
    else if (said.type === 'look') {
      const look = lookOf(said.look), key = JSON.stringify(look);
      if (key !== worn) ((worn = key), wear(look));
    }
    // A backdrop that stops is taken away, and what the page showed before it stays.
    else if (said.type === 'error') (stop(), failed(String(said.message ?? '').slice(0, 300)));
  };
  addEventListener('message', hear);
  addEventListener('scroll', soon, { passive: true });
  addEventListener('resize', moved);
  document.addEventListener('visibilitychange', tell);
  motion.addEventListener('change', tell);
  document.fonts?.addEventListener?.('loadingdone', moved);
  document.fonts?.ready.then(moved);
  sizes.observe(document.body);
  // What the page's main holds, as it is drawn or changed (a word, a block); the frame is put outside it.
  content.observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true, characterData: true });
  if (under?.parentNode === document.body) document.body.insertBefore(frame, under);
  else document.body.append(frame);
  return stop;
}
