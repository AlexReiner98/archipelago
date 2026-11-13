// Panes a part answers with (packs/walls/page/part-render.js): the part decides what is open where and how the room is
// shared; the host draws it. A pane is a canvas the host draws at an address (whoever hosts the part draws it, `frame`),
// or a web page framed (`w?url=`, or a web mark): the part never touches either, and hears only what is done in them.
// Panes stand side by side or one over another, each given room by its share, and the line between two is the host's:
// dragged, the part is told where it was let go, as a share of the room.

/** What a framed page may do: run, keep its own origin (a dev server's reload needs it), take a form, open a window. */
export const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';

/** The page an address frames (`w?url=…`), or nothing: the address is a canvas's. */
export function webOf(at) {
  if (typeof at !== 'string' || !at.startsWith('w?')) return null;
  const url = new URLSearchParams(at.slice(2)).get('url');
  return url && /^https?:\/\//i.test(url) ? url : null;
}

const make = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });

/**
 * Frame `url` in `el`, made again only for another url or another `reload`. Sandboxed, told no referrer; this
 * server's own pages are drawn as what they are, never framed; ↗ opens it apart (a site that refuses a frame stays blank).
 */
export function frameWeb(el, url, reload = '') {
  if (el.dataset.url === url && el.dataset.reload === reload) return;
  const again = el.dataset.url === url && el.firstElementChild?.tagName === 'IFRAME';
  el.dataset.url = url;
  el.dataset.reload = reload;
  if (again) return void (el.firstElementChild.src = url);
  let own = false;
  try {
    own = new URL(url).origin === location.origin;
  } catch {
    own = true;
  }
  const page = own ? make('div', 'pm-web-own pm-text-muted') : make('iframe', 'pm-web-page');
  if (own) page.textContent = 'This server’s pages open as what they are, not in a frame.';
  else {
    page.setAttribute('sandbox', SANDBOX);
    page.setAttribute('referrerpolicy', 'no-referrer');
    page.title = url;
    page.src = url;
  }
  const out = make('a', 'pm-web-out');
  Object.assign(out, { href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Open it in a window of its own', textContent: '↗' });
  out.setAttribute('aria-label', 'Open it in a window of its own');
  el.replaceChildren(page, out);
}

/** A pane's frame: its strip (the part's marks) over its body (the canvas or the page the host draws). */
export function buildPane(tell) {
  const el = make('section', 'pm-pane');
  el.append(make('div', 'pm-pane-strip'), make('div', 'pm-pane-body'));
  // Pressed or focused inside (a framed page taking focus too), the part hears that this pane is the one in front.
  const front = () => el.dataset.key && tell({ key: el.dataset.key, name: 'focus' });
  el.addEventListener('pointerdown', front, true);
  el.addEventListener('focusin', front);
  return el;
}

/**
 * Draw what a pane's body holds: a framed page, or a canvas whoever hosts the part draws at `at` (`frame(at, el,
 * said)`, answering with a way to stop it). Drawn again only when its address changes, so a canvas keeps where the
 * reader moved it.
 */
export function paneBody(el, node, frame, tell) {
  const body = el.lastElementChild;
  const { at, key } = node.at;
  el.dataset.key = key;
  el.style.setProperty('--pm-share', String(node.at.share ?? 1));
  if (body.dataset.at === at) return;
  body.dataset.at = at;
  body.stop?.();
  body.stop = null;
  const url = webOf(at);
  if (url) {
    const web = make('div', 'pm-web');
    body.replaceChildren(web);
    return frameWeb(web, url);
  }
  body.replaceChildren();
  const said = (name, value) => tell({ key: el.dataset.key, name, ...(value !== undefined && { value }) });
  const made = frame(at, body, said);
  body.stop = typeof made === 'function' ? made : made?.stop?.bind(made) ?? null;
}

/** A pane leaving the page: whatever draws in it stops. */
export function paneGone(el) {
  const body = el.querySelector(':scope > .pm-pane-body');
  body?.stop?.();
  if (body) body.stop = null;
}

/** The way panes asked to stand side by side stand: one over another on a page taller than it is wide. */
export const dirOn = (dir, wide, tall) => (dir === 'column' || wide < tall ? 'column' : 'row');

/** How much of the page's width an open sheet takes beside the panes, as a share: none where it covers most of it. */
export function sheetRoom(open, sheetWide, pageWide) {
  return open && pageWide > 0 && sheetWide < pageWide * 0.8 ? sheetWide / pageWide : 0;
}

/** Every panes mark drawn, laid out again when the page or the sheet changes, or its own size does. */
const laid = new Set();
const sized = typeof ResizeObserver === 'function' ? new ResizeObserver((all) => all.forEach((e) => e.target.isConnected && layPanes(e.target))) : null;
let watching = false;
function watch() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const again = () => [...laid].forEach((el) => (el.isConnected ? layPanes(el) : laid.delete(el)));
  addEventListener('resize', again);
  new MutationObserver(again).observe(document.body, { attributes: true, attributeFilter: ['data-sheet'] });
}

/**
 * Lay out panes as the page's panes stand: under the band across the top where there are several, the whole page for
 * one (its strip then not drawn), the open sheet's room kept at the side, side by side turned one over another on a
 * tall page. The pane in focus (`selected`) gives its frame to the bar and find as --active-left, right, top, bottom.
 */
export function layPanes(el) {
  if (!laid.has(el)) {
    laid.add(el);
    sized?.observe(el);
    // Drawn before it is in the page: measured again once it is.
    setTimeout(() => el.isConnected && layPanes(el), 0);
  }
  watch();
  const node = el.pmNode;
  if (!node) return;
  const panes = [...el.children].filter((c) => c.classList.contains('pm-pane'));
  el.dataset.count = String(panes.length);
  // The shares are of the room the panes have, whatever they add up to: one alone fills it.
  const shares = panes.map((p) => Number(p.style.getPropertyValue('--pm-share')) || 1);
  const all = shares.reduce((a, b) => a + b, 0) || 1;
  panes.forEach((p, i) => p.style.setProperty('--pm-grow', String(shares[i] / all)));
  el.dataset.dir = dirOn(node.at.dir ?? 'row', innerWidth, innerHeight);
  const sheet = document.getElementById('sheet');
  const aside = sheetRoom(document.body.dataset.sheet === 'open', sheet?.offsetWidth ?? 0, innerWidth);
  el.style.right = aside ? `${(aside * 100).toFixed(3)}%` : '';
  document.body.dataset.panes = String(panes.length);
  const front = panes.find((p) => p.getAttribute('aria-selected') === 'true') ?? panes[0];
  const box = front?.getBoundingClientRect();
  if (box) {
    const at = { left: box.left, right: innerWidth - box.right, top: box.top, bottom: innerHeight - box.bottom };
    for (const side of Object.keys(at)) document.body.style.setProperty(`--active-${side}`, `${Math.max(0, at[side])}px`);
  }
}

/**
 * The lines between the panes in `el` (drawn from a panes mark), placed at each pane's edge; each, dragged, tells the
 * part `share { index, at }`, `at` the line's place as a share of the room the panes have.
 */
export function sashes(el, node, tell) {
  const dir = el.dataset.dir ?? node.at.dir ?? 'row';
  const panes = [...el.children].filter((c) => c.classList.contains('pm-pane'));
  const shares = panes.map((p) => Number(p.style.getPropertyValue('--pm-share')) || 1);
  const all = shares.reduce((a, b) => a + b, 0) || 1;
  let have = [...el.querySelectorAll(':scope > .pm-sash')];
  if (have.length !== Math.max(0, panes.length - 1) || have.some((s) => s.dataset.dir !== dir)) {
    for (const old of have) old.remove();
    have = panes.slice(1).map((_, n) => {
      const sash = make('div', `pm-sash pm-sash-${dir}`);
      sash.dataset.dir = dir;
      sash.title = 'Drag to share the room between these two';
      sash.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        sash.setPointerCapture(ev.pointerId);
        document.body.dataset.dragging = 'sash';
        const go = (e) => {
          const r = el.getBoundingClientRect();
          const at = dir === 'row' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
          tell({ key: el.dataset.key, name: 'share', value: { index: n, at: Math.min(1, Math.max(0, at)) } });
        };
        const stop = () => (sash.removeEventListener('pointermove', go), sash.removeEventListener('pointerup', stop), sash.removeEventListener('pointercancel', stop), delete document.body.dataset.dragging);
        sash.addEventListener('pointermove', go);
        sash.addEventListener('pointerup', stop);
        sash.addEventListener('pointercancel', stop);
      });
      return el.appendChild(sash);
    });
  }
  let sum = 0;
  have.forEach((s, n) => {
    sum += shares[n];
    s.style.setProperty('--pm-at', `${((sum / all) * 100).toFixed(3)}%`);
  });
}
