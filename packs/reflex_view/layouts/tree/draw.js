// Layer: marks. The still marks of the tree: its branches, finest at the edge, its nodes and the names of the first
// levels, the root, and the marks the film moves: a pool of amber sparks (a node being written) and of blue lights (a
// node said, a trail from the root and a glow at its head). Everything the camera moves is in one group, `cam`. Each
// node's mark opens its item. The look is the stylesheet's (./look.js); every length is a size on the style.

import { at, m } from './marks.js';
import { cut } from './radial.js';
import { nameAt, nameTransform } from './names.js';
import { packClass, packOf } from './story.js';

/** Where a branch's one dash stands while it is not yet grown: wholly off the path, so its round caps draw nothing. */
export const HIDDEN = 1.5;

/** A glow: three rings, faintest outermost, drawn at unit size and moved and scaled by its group's transform. */
const glow = (key, kind) => m('g', { key, class: `rt-glow rt-${kind}`, opacity: 0 }, m('circle', { class: 'rt-g1', r: 1 }), m('circle', { class: 'rt-g2', r: 0.6 }), m('circle', { class: 'rt-g3', r: 0.3 }));

/** The scene's svg, and how many sparks and lights its pools hold. */
export function marksOf(tree, placed, z, n, shown, named, story, gapped = new Set(), adds = () => null) {
  // A node's tier (core, pack, owner, learned) weighs its branch; its standing (trial, current, retired) marks its dot.
  // A bough takes the tier nearest the trunk of what grows from it.
  const RANK = ['core', 'pack', 'owner', 'learned'];
  const tierOf = (node) => (node.item || node.preset ? story.nodes.get(node.id)?.tier ?? 'owner' : RANK[Math.min(...node.kids.map((k) => RANK.indexOf(tierOf(k))))] ?? 'owner');
  const standing = (node) => story.nodes.get(node.id)?.status ?? 'current';
  const { place, branch, width, height, centre } = placed;
  const branches = tree.order.filter((node) => node.parent).map((node) => {
    const on = shown(node);
    return m('path', { key: `b:${node.id}`, class: `rt-branch rt-b${Math.min(node.depth, n('reflex_branch_levels'))} rt-t-${tierOf(node)}`, d: branch.get(node.id), pathLength: 1, 'stroke-dasharray': '1 2', 'stroke-dashoffset': on ? 0 : HIDDEN });
  });
  const nodes = tree.order.filter((node) => node.parent).map((node) => {
    const p = place.get(node.id), label = placed.labels.get(node.id), spot = label && nameAt(label);
    const r = node.kids.length ? z('reflex_node') : z('reflex_leaf'), pack = packOf(node, story);
    // A rule is a square (reflex_rule_node across), an instruction a round dot; each in its pack's hue.
    const rule = node.rule && (story.rules ?? []).find((x) => x.id === node.id), side = z('reflex_rule_node');
    const said = pack ? ` \u00b7 ${rule ? `rule, ${rule.effect ?? 'guards'}` : 'instruction'} \u00b7 ${pack}` : '';
    return m(
      'g',
      { key: `n:${node.id}`, class: `rt-node rt-${standing(node)}${shown(node) ? ' on' : ''}${node.item || node.preset ? '' : ' rt-bough'}${gapped.has(node.id) ? ' rt-gap' : ''}${pack ? ` ${packClass(pack)}` : ''}${rule ? ' rt-rule' : ''}${adds(node) ? ' rt-adds' : ''}`, ...(node.item && { item: node.item.id, on: ['click', 'enter', 'leave'], role: 'link' }), ...(!node.item && adds(node) && { on: ['click'], role: 'button' }) },
      // Its whole name is its tooltip, whether its name shows or gives way.
      m('title', {}, `${node.title}${said}${adds(node) ? ' · click to add a trial node here' : ''}`),
      m('circle', { class: 'rt-hit', cx: at(p.x), cy: at(p.y), r: z('reflex_hit') }),
      rule ? m('rect', { class: 'rt-dot', x: at(p.x - side / 2), y: at(p.y - side / 2), width: side, height: side }) : m('circle', { class: 'rt-dot', cx: at(p.x), cy: at(p.y), r }),
      label && m('text', { key: `nm:${node.id}`, class: `rt-name${named.has(node.id) ? '' : ' rt-quiet'}`, x: at(spot.x), y: at(spot.y), transform: nameTransform(label, 1, at), 'text-anchor': spot.anchor, 'dominant-baseline': 'middle' }, label.text),
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
