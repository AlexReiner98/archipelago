// What every drawing of a lens shares: the answer as a tree, what stays lit and the switch for it, and the
// colours and sizes a style may set. The drawings (flow, list, a style's own code) import this; lens.js picks one.

import { h } from './base.js';
import { typeVars } from './theme.js';

export const LIT = [
  ['all', 'All', 'Everything in the view'],
  ['you', 'Needs you', 'Only what needs you stays lit: it waits on you, is yours to confirm, is due, or is yours to settle'],
  ['blocked', 'Blocked', 'Only what is blocked stays lit'],
];

/** A style's colours, by the name the stylesheet knows each by. */
export const STYLE_COLORS = ['sea', 'land', 'inner', 'line', 'text', 'muted', 'blocked', 'you', 'session', 'done', 'warn'];
/** The sizes a style names at its top, and the stylesheet's name for each. */
const TOP_SIZES = ['text', 'radius', 'gap', 'column'];
/** A length as a style may give it: a number of pixels, or a number with one of these units. */
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;
const NAME = /^[a-z][a-z0-9_]*$/;
const asLength = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? `${v}px` : typeof v === 'string' && LENGTH.test(v) ? v : null);
/**
 * A style's colours, sizes, numbers and faces, handed to the stylesheet as --ln-<name>. Only a plain hex colour, a length
 * or a number is: a style is written by anyone who can change the map. What the style does not say is not set: the
 * values are the presets' (each pack's styles), never the kernel's.
 */
export function dress(host, style) {
  const set = new Map();
  for (const name of STYLE_COLORS) if (typeof style.colors?.[name] === 'string' && /^#[0-9a-f]{3,8}$/i.test(style.colors[name])) set.set(`--ln-${name}`, style.colors[name]);
  for (const name of TOP_SIZES) if (asLength(style[name])) set.set(`--ln-${name}-size`, asLength(style[name]));
  for (const [name, value] of Object.entries(style.sizes ?? {})) if (NAME.test(name) && asLength(value)) set.set(`--ln-${name.replaceAll('_', '-')}`, asLength(value));
  for (const [name, value] of Object.entries(style.numbers ?? {})) if (NAME.test(name) && Number.isFinite(value)) set.set(`--ln-${name.replaceAll('_', '-')}`, String(value));
  if (typeof style.font === 'string' && !/[;{}]/.test(style.font)) set.set('--ln-font', style.font);
  // A view's own faces and text roles, over the page's: the same variables the page sets, so a drawing's text keeps
  // to the roles the page's does.
  if (style.faces || style.type) for (const [name, value] of typeVars(style.type, style.faces)) set.set(name, value);
  for (const name of [...host.style].filter((n) => /^--(ln|face|type)-/.test(n) && !set.has(n))) host.style.removeProperty(name);
  for (const [name, value] of set) host.style.setProperty(name, value);
}
/** A size a drawing's code lays out by, in pixels: the style's, named by the house style. */
export const sizeOf = (style, name) => {
  const v = style.sizes?.[name];
  if (typeof v !== 'number') throw new Error(`The style names no size "${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
  return v;
};
/** A number a drawing's code is drawn by: the style's, named by the house style. */
export const numberOf = (style, name) => {
  const v = style.numbers?.[name];
  if (typeof v !== 'number') throw new Error(`The style names no number "${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
  return v;
};

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it: the same numbers at every depth. */
export function lensTree(answer) {
  const me = answer.viewer;
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [], depth: -1, x: 0, y: 0, title: 'Everything' };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(Object.assign(n, { up: byId.get(n.inside) ?? root }));
  for (const n of byId.values()) {
    n.all = 1 + n.within.items;
    n.you = (n.state.needs_you ? 1 : 0) + (n.within.needs_you ?? 0);
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
