// The sessions on a step (task e_7csnapar; Alex, 18 Nov 2026: the session's hue as a ring): each open session the
// answer says is on an item (its `sessions`, the runs pack's mark) rings the step in that session's hue, one ring
// outside another where two are on it. The mark's age fades the ring (`fresh`, the style's session_faded at the
// least), and a dormant session's ring is dashed, apart from work under way and from work done, in every layout alike.
// The step's tip says who is on it, how, and since when. Layer: marks. Pure: an item and the style in, marks and rules out.

import { HEX } from './marks.js';

/** The sessions the answer says are on an item, those with a hue to ring it in. */
export const sessionsOn = (i) => (Array.isArray(i?.sessions) ? i.sessions.filter((s) => s && typeof s === 'object' && HEX.test(String(s.hue))) : []);

/** The class that gives a ring its hue: a drawing sets no style on a mark. */
export const hueClass = (hex) => `lf-sr-${hex.slice(1).toLowerCase()}`;

/** How see-through a ring is, by how fresh its session is: whole while fresh, down to the style's session_faded. */
export function opacityOf(s, style) {
  const least = style.numbers?.session_faded;
  const fresh = typeof s.fresh === 'number' ? Math.min(1, Math.max(0, s.fresh)) : 1;
  if (fresh >= 1 || typeof least !== 'number') return undefined;
  return Math.round((least + (1 - least) * fresh) * 100) / 100;
}

/**
 * The rings round a step, under it: `outline(shape, x, y, w, h, rx, cut)` draws the step's own shape, here grown by the
 * style's flow_session_gap for each ring outward. None where nobody is on it.
 */
export function sessionRings({ item, shape, x, y, w, h, corner, bevel, z, outline, m, style }) {
  const on = sessionsOn(item);
  if (!on.length) return null;
  const gap = z('session_gap');
  return m('g', { class: 'lf-srs', 'aria-hidden': 'true' }, ...on.map((s, k) => {
    const out = gap * (k + 1), faint = opacityOf(s, style);
    return m('g', { class: `lf-sr ${hueClass(s.hue)}${s.dormant ? ' dormant' : ''}`, ...(faint !== undefined && { opacity: faint }) },
      outline(shape, x, y, w + 2 * out, h + 2 * out, corner + out, bevel));
  }));
}

/** How long ago, in a few letters: minutes, hours or days. */
export function agoOf(minutes) {
  if (typeof minutes !== 'number') return '';
  const hours = minutes / 60, days = hours / 24;
  return hours < 1 ? `${Math.round(minutes)} min` : days < 1 ? `${Math.round(hours)} h` : `${Math.round(days)} d`;
}

/** What the step's tip says of each session on it: who, how, and when it was last heard. */
export const ringLines = (i, words) => sessionsOn(i).map((s) => [`On it: ${s.title}`, s.dormant ? 'dormant' : words(s.state), s.age ? `${agoOf(s.age)} ago` : ''].filter(Boolean).join(', '));

/** Each hue's rule, for the rings of these items. */
export const ringRules = (items) => [...new Set(items.flatMap((i) => sessionsOn(i).map((s) => s.hue.toLowerCase())))].map((hex) => `.${hueClass(hex)} { --lf-sr: ${hex}; }`);

/** The key's row: a ring round a step, where any step is ringed. */
export const ringKey = (items, glyph) => items.some((i) => sessionsOn(i).length) && glyph;

export const css = `
.lf-step .lf-sr .lf-shape, .lf-step:hover .lf-sr .lf-shape { fill: none; stroke: var(--lf-sr, var(--ln-session)); stroke-width: var(--ln-flow-session-ring); }
.lf-step .lf-sr.dormant .lf-shape { stroke-dasharray: var(--ln-flow-dash-dormant); }
`;
