// Saved views: the pictures kept on the map, as tiles named by what they show, each opening the picture itself. On
// Home, a strip of the pinned and the newest (docs/ui-strategy.md).

import { api, h, part } from './base.js';
import { lensView, readLens } from './lens.js';
import { typeTitle } from './words.js';

/** Where a picture opens: drawn from what it is of, through its lens (the style kept about the lens comes with it). */
export const pictureHref = (p) => (p.of ? `#/graph?from=${p.of.id}&lens=${p.lens}` : `#/graph?lens=${p.lens}`);

/** How much smaller than the picture's own page its thumbnail is drawn. */
const SHRINK = 4;

/** The picture itself, drawn small: the same lens and style as its page, at a quarter of the size, not to be touched. */
function thumbnail(p) {
  const view = lensView({ lens: { lens: p.lens, ...(p.of && { from: p.of.id }) }, key: `saved:${p.lens}`, bare: true });
  return h(
    'div',
    { class: 'saved-view-thumb', 'aria-hidden': 'true', style: 'position: relative; height: var(--thumb); overflow: hidden; border-radius: var(--radius-2); background: var(--bg); pointer-events: none' },
    // Placed out of the flow, so the drawing's own width never widens the tile, the strip or the page.
    h('div', { style: `position: absolute; top: 0; left: 0; width: ${SHRINK * 100}%; height: ${SHRINK * 96}px; transform: scale(${1 / SHRINK}); transform-origin: 0 0` }, view),
  );
}

/** One picture as a tile: a small drawing of it, its name, and the project it is in. */
export const tile = (p) => {
  const where = p.project && p.of && p.project.id !== p.of.id ? `${p.project.title} › ${p.of.title}` : (p.project?.title ?? p.of?.title ?? 'the whole map');
  return h(
    'div',
    {
      class: 'saved-view-tile',
      title: `${p.title}\n${where}`,
      onclick: () => (location.hash = pictureHref(p)),
      style: 'display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; padding: var(--space-5); border: var(--border-1) solid var(--line); border-radius: var(--radius-3); cursor: pointer',
    },
    thumbnail(p),
    h('span', { class: 'row-top', style: 'min-width: 0; flex-wrap: nowrap' }, h('a', { class: 'gist grow', href: pictureHref(p), style: 'min-width: 0; color: var(--text); text-decoration: none' }, p.title), p.pinned && h('span', { class: 'pill', title: 'Pinned', style: 'flex: none' }, 'pinned')),
    h('span', { class: 'gist muted small', style: 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis' }, where),
  );
};

/** Whether the strip on Home is open to every picture: kept while the page is, so a redraw does not fold it again. */
let open = false;

/** The strip on Home: the pinned pictures, then the newest, up to the limit; open, every one. Left out when nothing is kept. */
export async function savedViewsStrip(host, title, limit = 6) {
  const answer = await api('view', { name: 'saved_views' }).catch(() => null);
  if (!host.isConnected) return;
  if (!answer?.pictures.length) return host.remove();
  const all = answer.pictures;
  const tiles = h('div', { class: 'saved-view-tiles', style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--input-wide), 100%), 1fr)); gap: var(--space-5); padding: 0 var(--space-8) var(--space-8)' });
  // A tile is drawn only once it is shown: each is a picture of its own.
  const show = () => {
    const n = open ? all.length : Math.min(limit, all.length);
    tiles.replaceChildren(...[...tiles.children].slice(0, n), ...all.slice(tiles.children.length, n).map(tile));
    if (fold) fold.textContent = open ? 'Fewer' : `All ${all.length}`;
  };
  const fold =
    all.length > limit &&
    h('button', { class: 'quiet-button', style: 'margin-left: auto; white-space: nowrap', title: 'Every view kept on the map, or only the pinned and the newest', onclick: () => ((open = !open), show()) });
  host.replaceChildren(h('section', { class: 'card wide saved-views', style: 'margin-bottom: var(--space-8); min-width: 0' }, h('header', {}, h('h2', {}, title), fold), tiles));
  show();
}

/** What a picture is called and where it sits: the style kept about its lens names it, else the lens, else the view it opened on. */
async function pictureHead(lens, view) {
  const kept = typeof lens.lens === 'string' && /^e_/.test(lens.lens) ? lens.lens : undefined;
  const [of, own] = await Promise.all([lens.from ? api('get', { id: lens.from }).catch(() => null) : null, kept ? api('get', { id: kept }).catch(() => null) : null]);
  await view.ready;
  const answer = view.answer;
  const style = own?.incoming.find((r) => r.type === 'about' && r.entity_type === 'style');
  const opened = answer?.views?.find((v) => v.id === answer.view);
  const title = style?.title ?? own?.entity.title ?? opened?.title ?? of?.entity.title ?? 'The whole map';
  const steps = of ? [...(of.trail ?? []), of.entity] : [];
  return h(
    'div',
    { class: 'page-head' },
    // Where it sits, from Home down to what it is a picture of, each a way there.
    h('nav', { class: 'trail', title: 'Where this view sits' }, h('a', { class: 'trail-step', href: '#/' }, 'Home'), steps.map((t) => [h('span', { class: 'trail-sep' }, '›'), h('a', { class: 'trail-step', href: `#/e/${t.id}`, title: `${typeTitle(t.type)}: ${t.title}` }, t.title)])),
    h('h1', { style: 'margin-top: var(--space-4)' }, title),
  );
}

/**
 * The map as a picture: the lens its address names (what follows a ?), or the whole map as it opens, drawn in the
 * style kept for it, under its name and the way back to what it is of.
 */
export async function graph(query = '') {
  const { lens, style } = readLens(query);
  const view = lensView({ lens, style });
  const head = pictureHead(lens, view);
  // One already there stays until the new one is drawn: the map changing under it does not blank the page.
  if (part('graph').querySelector('.lens-wrap')) await view.ready;
  const card = h('section', { class: 'card lens-card' }, view);
  part('graph').replaceChildren(card);
  const drawn = await head;
  if (card.isConnected) card.before(drawn);
}
