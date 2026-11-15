// A layout kept on the map run as a page's backdrop (task e_m2wsf8m5): its code, walled in as any layout's code is
// (packs/walls/page/draw.js), in a frame fixed to the window behind everything else on the page, told only numbers and
// boxes of the page (its size, its scroll, its window and where its words are), never the page itself.
//
// What its code hears, with on('page', fn), and is handed first as `page`:
//   { visible: true, width, height, scroll, margin, view: { width, height }, clear: [{ x, y, w, h }, ...], reducedMotion }
//   { visible: false, reducedMotion }, when the tab is hidden: it pauses itself until it hears the page again.
// Coordinates are the page's own (from its top left); `view` is the window less its scrollbar, as the frame is; `clear`
// holds the boxes of its words (pageWords).
//
// Its frame is fixed to the window, and moves with the page only when the code draws again: on a fast scroll the land
// trails the words. Code that draws `margin` more above and below the window and says, after each frame, where on the
// page its canvas's top stands (drawn(top): scroll - margin) is shown there instead: its frame is then made as tall as
// the page and scrolls with it, so the land moves with the words exactly, and only a new frame moves it on the page.

import { frameSandbox, h } from './base.js';
import { STYLE_COLORS } from './query-base.js';
import { pageWords } from './style-code.js';

/** The page as its backdrop is told it: numbers and boxes, rounded, nothing else. */
function pageSaid(reducedMotion) {
  if (document.hidden) return { visible: false, reducedMotion };
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
  const box = (b) => ({ x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) });
  const words = pageWords(document, window);
  const clear = [...words.above, ...words.named, ...(words.column ? [words.column] : [])].map(box);
  const root = document.documentElement;
  // Half a window above and below it: as far as a fast scroll goes before the next frame.
  return { visible: true, reducedMotion, width: n(root.clientWidth), height: n(root.scrollHeight), scroll: n(scrollY), margin: n(root.clientHeight / 2), view: { width: n(root.clientWidth), height: n(root.clientHeight) }, clear };
}

/**
 * Run `code` (a layout's files) as the page's backdrop, its colours read from `dressed` (the view's own element, its
 * style's colours set on it). `drew()` is called once its frame has painted, `failed(why)` if its code stops or cannot
 * start; the frame is then taken away. Only one backdrop runs on a page: a second replaces the first.
 */
export function runBackdrop({ code, answer, style, dressed, drew = () => {}, failed = () => {} }) {
  document.querySelector('body > iframe.page-backdrop')?.remove();
  const frame = h('iframe', { class: 'page-backdrop', sandbox: frameSandbox(), src: '/draw.html', title: 'The page’s backdrop', 'aria-hidden': 'true', tabindex: '-1' });
  const colours = Object.fromEntries(STYLE_COLORS.map((name) => [name, getComputedStyle(dressed).getPropertyValue(`--ln-${name}`).trim()]));
  const theme = { ...colours, dark: matchMedia('(prefers-color-scheme: dark)').matches };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let pending = 0, done = false, scrolls = false, refit = false;
  // A frame that scrolls with the page is as tall as the page without it, and says where its top stands on the page.
  const fit = () => {
    refit = false;
    if (!scrolls) return;
    frame.style.height = '0';
    frame.style.height = `${document.documentElement.scrollHeight}px`;
    frame.contentWindow?.postMessage({ type: 'scrolling', top: frame.getBoundingClientRect().top + scrollY }, '*');
  };
  const tell = () => frame.isConnected && frame.contentWindow?.postMessage({ type: 'page', page: pageSaid(motion.matches) }, '*');
  // Told at most once a frame, however often the page scrolls or moves.
  const soon = () => pending || (pending = requestAnimationFrame(() => ((pending = 0), refit && fit(), tell())));
  const moved = () => ((refit = true), soon());
  const sizes = new ResizeObserver(moved);
  const stop = () => {
    removeEventListener('message', hear);
    removeEventListener('scroll', soon);
    removeEventListener('resize', moved);
    document.removeEventListener('visibilitychange', tell);
    motion.removeEventListener('change', tell);
    document.fonts?.removeEventListener?.('loadingdone', moved);
    sizes.disconnect();
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
  document.body.append(frame);
  return stop;
}
