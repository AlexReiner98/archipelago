// Layer: marks. The still marks of the tree: its branches, finest at the edge, its nodes and the names of the first
// levels, the root, and the marks the film moves: a pool of amber sparks (a node being written) and of blue lights (a
// node said, a trail from the root and a glow at its head). Everything the camera moves is in one group, `cam`. Each
// node's mark opens its item. The look is the stylesheet's (./look.js); every length is a size on the style.

import { at, m } from './marks.js';
import { cut } from './radial.js';

/** Where a branch's one dash stands while it is not yet grown: wholly off the path, so its round caps draw nothing. */
export const HIDDEN = 1.5;

/** A glow: three rings, faintest outermost, drawn at unit size and moved and scaled by its group's transform. */
const glow = (key, kind) => m('g', { key, class: `rt-glow rt-${kind}`, opacity: 0 }, m('circle', { class: 'rt-g1', r: 1 }), m('circle', { class: 'rt-g2', r: 0.6 }), m('circle', { class: 'rt-g3', r: 0.3 }));

/** The scene's svg, and how many sparks and lights its pools hold. */
export function marksOf(tree, placed, z, n, shown) {
  const { place, branch, width, height, centre } = placed;
  const branches = tree.order.filter((node) => node.parent).map((node) => {
    const on = shown(node);
    return m('path', { key: `b:${node.id}`, class: `rt-branch rt-b${Math.min(node.depth, n('reflex_branch_levels'))}`, d: branch.get(node.id), pathLength: 1, 'stroke-dasharray': '1 2', 'stroke-dashoffset': on ? 0 : HIDDEN });
  });
  const nodes = tree.order.filter((node) => node.parent).map((node) => {
    const p = place.get(node.id), name = placed.names.get(node.id);
    const r = node.kids.length ? z('reflex_node') : z('reflex_leaf');
    return m(
      'g',
      { key: `n:${node.id}`, class: `rt-node${shown(node) ? ' on' : ''}${node.item ? '' : ' rt-bough'}`, ...(node.item && { item: node.item.id, on: ['click', 'enter', 'leave'], role: 'link' }) },
      m('circle', { class: 'rt-hit', cx: at(p.x), cy: at(p.y), r: z('reflex_hit') }),
      m('circle', { class: 'rt-dot', cx: at(p.x), cy: at(p.y), r }),
      name && m('text', { class: 'rt-name', x: at(name.x), y: at(name.y), transform: `rotate(${at(name.turn)} ${at(name.x)} ${at(name.y)})`, 'text-anchor': name.right ? 'start' : 'end', 'dominant-baseline': 'middle' }, name.text),
    );
  });
  const sparks = n('reflex_pool_sparks'), lights = n('reflex_pool_lights');
  const svg = m(
    'svg',
    { class: 'rt', width: at(width), height: at(height), viewBox: `0 0 ${at(width)} ${at(height)}` },
    // The picture's whole size, drawn as nothing: what the page fits is its marks' bounds, and this keeps them
    // centred on the root however the tree leans.
    m('rect', { class: 'rt-frame', x: 0, y: 0, width: at(width), height: at(height) }),
    m(
      'g',
      { key: 'cam' },
      m('g', { class: 'rt-branches' }, branches),
      m('g', {}, Array.from({ length: lights }, (_, i) => m('path', { key: `lt:${i}`, class: 'rt-trail', d: `M${at(centre.x)} ${at(centre.y)}`, opacity: 0 }))),
      m('g', { class: 'rt-nodes' }, nodes),
      m('circle', { class: 'rt-root', cx: at(centre.x), cy: at(centre.y), r: z('reflex_root'), ...(tree.root.item && { item: tree.root.item.id, key: `n:${tree.root.id}`, on: ['click', 'enter', 'leave'], role: 'link' }) }),
      m('g', {}, Array.from({ length: sparks }, (_, i) => glow(`sp:${i}`, 'spark'))),
      m('g', {}, Array.from({ length: lights }, (_, i) => [glow(`lg:${i}`, 'light'), m('circle', { key: `lh:${i}`, class: 'rt-head', cx: at(centre.x), cy: at(centre.y), r: z('reflex_head'), opacity: 0 })])),
    ),
  );
  return { svg, sparks, lights };
}

/** What a node says in its tip: its name, and the first line of its note. */
export const tipOf = (node, said, most) =>
  m('div', { class: 'rt-tip' }, m('strong', {}, node.title), node.item?.body && m('div', {}, cut(node.item.body.split('\n')[0], most)), said !== undefined && m('small', {}, `said ${said.toLocaleString('en-US')} times`));
