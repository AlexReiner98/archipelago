// The atlas: the pictures kept on the map, as tiles named by what they show, each opening the picture itself. On
// Home, a strip of the pinned and the newest (docs/ui-strategy.md).

import { api, h } from './base.js';

/** Where a picture opens: drawn from what it is of, through its lens (the style kept about the lens comes with it). */
export const pictureHref = (p) => (p.of ? `#/graph?from=${p.of.id}&lens=${p.lens}` : `#/graph?lens=${p.lens}`);

/** One picture as a tile: its name, and what it is of, muted. */
export const tile = (p) =>
  h(
    'a',
    {
      class: 'tile',
      href: pictureHref(p),
      title: `${p.title}${p.of ? `\nof ${p.of.title}` : ''}`,
      style: 'display: flex; flex-direction: column; align-items: stretch; gap: 2px; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; text-decoration: none; text-align: left; color: var(--text)',
    },
    h('span', { class: 'row-top', style: 'min-width: 0' }, h('span', { class: 'gist grow' }, p.title), p.pinned && h('span', { class: 'pill', title: 'Pinned' }, 'pinned')),
    h('span', { class: 'gist muted small' }, p.of?.title ?? 'the whole map'),
  );

/** The strip on Home: the pinned pictures, then the newest, up to the limit. Left out when nothing is kept. */
export async function atlasStrip(host, title, limit = 6) {
  const answer = await api('view', { name: 'atlas', params: { limit } }).catch(() => null);
  if (!host.isConnected) return;
  if (!answer?.pictures.length) return host.remove();
  host.replaceChildren(
    h(
      'section',
      { class: 'card wide atlas', style: 'margin-bottom: 14px' },
      h('header', {}, h('h2', {}, title), answer.more > 0 && h('span', { class: 'n', title: `${answer.more} more kept` }, answer.pictures.length + answer.more)),
      h('div', { class: 'tiles', style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; padding: 0 14px 14px' }, answer.pictures.map(tile)),
    ),
  );
}
