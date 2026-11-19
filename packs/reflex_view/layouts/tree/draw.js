// Layer: marks. The still marks of the tree: its branches, finest at the edge, its nodes and the names of the first
// levels, the root, and the marks the film moves: a pool of amber sparks (a node being written) and of blue lights (a
// node said, a trail from the root and a glow at its head). Everything the camera moves is in one group, `cam`. Each
// node's mark opens its item. The look is the stylesheet's (./look.js); every length is a size on the style.

import { at, m } from './marks.js';

const cut = (text, most) => (text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`);

/** A glow: three rings, faintest outermost, drawn at unit size and moved and scaled by its group's transform. */
const glow = (key, kind) => m('g', { key, class: `rt-glow rt-${kind}`, opacity: 0 }, m('circle', { class: 'rt-g1', r: 1 }), m('circle', { class: 'rt-g2', r: 0.6 }), m('circle', { class: 'rt-g3', r: 0.3 }));

/** The scene's svg, and how many sparks and lights its pools hold. */
export function marksOf(tree, placed, z, n, shown) {
  const { place, branch, polar, width, height, centre } = placed;
  const branches = tree.order.filter((node) => node.parent).map((node) => {
    const on = shown(node);
    return m('path', { key: `b:${node.id}`, class: `rt-branch rt-b${Math.min(node.depth, n('reflex_branch_levels'))}`, d: branch.get(node.id), pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': on ? 0 : 1 });
  });
  const named = n('reflex_name_depth'), most = n('reflex_name_most'), gap = z('reflex_name_gap');
  // A name is written only where its node has room for a line across its share of the circle (reflex_name_room lines).
  const all = placed.leaves.get(tree.root.id), line = z('reflex_name_text') * n('reflex_name_room');
  const roomy = (node) => ((Math.PI * 2 * placed.leaves.get(node.id)) / all) * polar.get(node.id).r >= line;
  const nodes = tree.order.filter((node) => node.parent).map((node) => {
    const p = place.get(node.id), a = polar.get(node.id).a, right = Math.cos(a) >= -0.2;
    const r = node.kids.length ? z('reflex_node') : z('reflex_leaf');
    const name = node.depth <= named && node.title && roomy(node);
    return m(
      'g',
      { key: `n:${node.id}`, class: `rt-node${shown(node) ? ' on' : ''}${node.item ? '' : ' rt-bough'}`, ...(node.item && { item: node.item.id, on: ['click', 'enter', 'leave'], role: 'link' }) },
      m('circle', { class: 'rt-hit', cx: at(p.x), cy: at(p.y), r: z('reflex_hit') }),
      m('circle', { class: 'rt-dot', cx: at(p.x), cy: at(p.y), r }),
      name && m('text', { class: 'rt-name', x: at(p.x + (right ? gap : -gap)), y: at(p.y), 'text-anchor': right ? 'start' : 'end', 'dominant-baseline': 'middle' }, cut(node.title, most)),
    );
  });
  const sparks = n('reflex_pool_sparks'), lights = n('reflex_pool_lights');
  const svg = m(
    'svg',
    { class: 'rt', width: at(width), height: at(height), viewBox: `0 0 ${at(width)} ${at(height)}` },
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
