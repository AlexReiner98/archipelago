// How the time drawing looks (index.js): rules, day and hour heads, lanes, and each block in what it counts toward.
// Every length here is the style's (sizes, read as --ln-time-*): the house style names them. A block's colour and a
// key's stripe are classes the drawing writes rules for (hueRule): a drawing sets no style on a mark. A block coloured
// so weighs more than the page's colours by kind (.group-work .dot), as the kernel's inline colour did.

import { hues } from './marks.js';

export const css = `
.timeline { display: block; max-width: 100%; }
.t-rule { stroke: var(--ln-line); stroke-width: var(--ln-rule); }
.t-head { fill: var(--ln-muted); font-size: var(--ln-time-head-text); }
.t-hour { fill: var(--ln-muted); font-size: var(--ln-time-hour-text); }
.t-row { fill: var(--ln-text); font-size: var(--ln-small-text); }
.t-lane { stroke: var(--ln-line); stroke-width: var(--ln-rule); stroke-dasharray: var(--ln-time-lane-dash); }
.t-block { cursor: pointer; }
.timeline .t-block .dot.t-hued { fill: var(--t-hue); stroke: var(--t-hue); }
.t-key-chip rect { fill: var(--t-hue); }
.t-day-key rect { fill: var(--t-hue); }
.t-day-key[role=link] { cursor: pointer; }
.t-h-none { --t-hue: var(--ln-muted); }
.t-controls { display: flex; align-items: baseline; gap: var(--ln-time-key-gap); padding: var(--ln-time-key-pad) 0; font-size: var(--ln-small-text); color: var(--ln-muted); white-space: nowrap; overflow: hidden; }
.t-control { background: none; border: 0; padding: 0; font: inherit; color: var(--ln-muted); cursor: pointer; }
.t-control:hover, .t-control.on { color: var(--ln-text); }
.t-control.on { text-decoration: underline; text-underline-offset: var(--ln-time-key-pad); }
.t-control-at { color: var(--ln-text); }
.t-control-gap { flex: 0 0 var(--ln-time-key-stripe); }
`;

/** The class a colour is drawn by, and its rule: named by the colour itself, so two pictures on a page never differ on one. */
export const { hueClass, hueRule } = hues('t-h', '--t-hue');
