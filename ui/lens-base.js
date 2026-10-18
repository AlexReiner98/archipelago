// What every drawing of a lens shares: the answer as a tree, what stays lit and the switch for it, and the
// colours and sizes a style may set. The drawings (flow, list, a style's own code) import this; lens.js picks one.

import { h } from './base.js';

export const LIT = [
  ['all', 'All', 'Everything in the picture'],
  ['you', 'Needs you', 'Only what waits on you stays lit'],
  ['blocked', 'Blocked', 'Only what is blocked stays lit'],
];

/** A style's colours and sizes, by the name the stylesheet knows each by, with the range a size may take. */
export const STYLE_COLORS = ['sea', 'land', 'inner', 'line', 'text', 'muted', 'blocked', 'you', 'session', 'done'];
export const STYLE_SIZES = { text: [9, 22], radius: [0, 40], gap: [0, 40], column: [140, 640] };
/** A style's colours and sizes are handed to the stylesheet. Only a plain hex colour or a number in range is: a style is written by anyone who can change the map. */
export function dress(host, style) {
  for (const name of STYLE_COLORS) {
    const colour = style.colors?.[name];
    if (typeof colour === 'string' && /^#[0-9a-f]{3,8}$/i.test(colour)) host.style.setProperty(`--ln-${name}`, colour);
    else host.style.removeProperty(`--ln-${name}`);
  }
  for (const [name, [least, most]] of Object.entries(STYLE_SIZES)) {
    if (Number.isFinite(style[name])) host.style.setProperty(`--ln-${name}-size`, `${Math.max(least, Math.min(most, style[name]))}px`);
    else host.style.removeProperty(`--ln-${name}-size`);
  }
}

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it: the same numbers at every depth. */
export function lensTree(answer) {
  const me = answer.viewer;
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [], depth: -1, x: 0, y: 0, title: 'Everything' };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(Object.assign(n, { up: byId.get(n.inside) ?? root }));
  for (const n of byId.values()) {
    n.all = 1 + n.within.items;
    n.you = (me && n.state.waits_on.includes(me) ? 1 : 0) + ((me && n.within.waits_on[me]) || 0);
    n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
    n.work = n.size.work + n.within.work;
    n.at = n.state.sessions + n.within.sessions;
  }
  const deepen = (n, depth) => ((n.depth = depth), n.kids.sort((a, b) => a.place - b.place).forEach((kid) => deepen(kid, depth + 1)));
  deepen(root, -1);
  return { me, byId, root };
}

/** How much of a thing stays lit: what was asked for by name (style.only), else what the style's lit says; a thing that holds others, by what is in it. */
export function litCount(n, style) {
  if (Array.isArray(style.only)) {
    const only = new Set(style.only);
    const any = (m) => only.has(m.id) || m.kids.some(any);
    return any(n) ? 1 : 0;
  }
  return style.lit === 'you' ? n.you : style.lit === 'blocked' ? n.blk : 1;
}

/** The switch for what stays lit, the same in every shape. */
export function litSwitch(me, style, keep, redraw) {
  // A view that does not offer the choice has no switch.
  if (style.noLit) return '';
  const lit = h('span', { class: 'switch' });
  for (const [value, label, title] of LIT) {
    if (value === 'you' && !me) continue;
    lit.append(h('button', { class: style.lit === value ? 'on' : '', title, onclick: (ev) => (keep({ lit: value }), [...lit.children].forEach((b) => b.classList.toggle('on', b === ev.currentTarget)), redraw()) }, label));
  }
  return lit;
}
