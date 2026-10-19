// The atlas: the pictures kept on the map, as tiles named by what they show, each opening the picture itself. On
// Home, a strip of the pinned and the newest (docs/ui-strategy.md).

import { api, h } from './base.js';
import { lensView } from './lens.js';

/** Where a picture opens: drawn from what it is of, through its lens (the style kept about the lens comes with it). */
export const pictureHref = (p) => (p.of ? `#/graph?from=${p.of.id}&lens=${p.lens}` : `#/graph?lens=${p.lens}`);

/** How much smaller than the picture's own page its thumbnail is drawn. */
const SHRINK = 4;

/** The picture itself, drawn small: the same lens and style as its page, at a quarter of the size, not to be touched. */
function thumbnail(p) {
  const view = lensView({ lens: { lens: p.lens, ...(p.of && { from: p.of.id }) }, key: `atlas:${p.lens}`, bare: true });
  return h(
    'div',
    { class: 'atlas-thumb', 'aria-hidden': 'true', style: 'height: 96px; overflow: hidden; border-radius: 6px; background: var(--bg); pointer-events: none' },
    h('div', { style: `width: ${SHRINK * 100}%; height: ${SHRINK * 96}px; transform: scale(${1 / SHRINK}); transform-origin: 0 0` }, view),
  );
}

/** One picture as a tile: a small drawing of it, its name, and the project it is in. */
export const tile = (p) => {
  const where = p.project && p.of && p.project.id !== p.of.id ? `${p.project.title} › ${p.of.title}` : (p.project?.title ?? p.of?.title ?? 'the whole map');
  return h(
    'div',
    {
      class: 'atlas-tile',
      title: `${p.title}\n${where}`,
      onclick: () => (location.hash = pictureHref(p)),
      style: 'display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 8px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer',
    },
    thumbnail(p),
    h('span', { class: 'row-top', style: 'min-width: 0; flex-wrap: nowrap' }, h('a', { class: 'gist grow', href: pictureHref(p), style: 'min-width: 0; color: var(--text); text-decoration: none' }, p.title), p.pinned && h('span', { class: 'pill', title: 'Pinned', style: 'flex: none' }, 'pinned')),
    h('span', { class: 'gist muted small', style: 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis' }, where),
  );
};

/** The strip on Home: the pinned pictures, then the newest, up to the limit. Left out when nothing is kept. */
export async function atlasStrip(host, title, limit = 6) {
  const answer = await api('view', { name: 'atlas', params: { limit } }).catch(() => null);
  if (!host.isConnected) return;
  if (!answer?.pictures.length) return host.remove();
  const all = answer.pictures.length + answer.more;
  host.replaceChildren(
    h(
      'section',
      { class: 'card wide atlas', style: 'margin-bottom: 14px' },
      h('header', {}, h('h2', {}, title), answer.more > 0 && h('span', { class: 'muted small', style: 'margin-left: auto', title: 'Pictures kept on the map: the pinned first, then the newest' }, `${answer.pictures.length} of ${all} pictures`)),
      h('div', { class: 'atlas-tiles', style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; padding: 0 14px 14px' }, answer.pictures.map(tile)),
    ),
  );
}
