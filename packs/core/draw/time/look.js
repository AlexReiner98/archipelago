// How the time drawing looks (index.js): rules, day and hour heads, lanes, and each block in what it counts toward.
// Every length here is the style's (sizes, read as --ln-time-*): the house style names them. A block's colour and a
// key's stripe are classes the drawing writes rules for (hueRule): a drawing sets no style on a mark. A block coloured
// so weighs more than the page's colours by kind (.group-work .dot), as the kernel's inline colour did.

export const css = `
.t-rule { stroke: var(--ln-line); stroke-width: var(--ln-rule); }
.t-head { fill: var(--ln-muted); font-size: var(--ln-time-head-text); }
.t-hour { fill: var(--ln-muted); font-size: var(--ln-time-hour-text); }
.t-row { fill: var(--ln-text); font-size: var(--ln-small-text); }
.t-lane { stroke: var(--ln-line); stroke-width: var(--ln-rule); stroke-dasharray: var(--ln-time-lane-dash); }
.t-block { cursor: pointer; }
.timeline .t-block .dot.t-hued { fill: var(--t-hue); }
.t-key-chip rect { fill: var(--t-hue); }
.t-h-none { --t-hue: var(--ln-muted); }
`;

/** The class a colour is drawn by, and its rule: named by the colour itself, so two pictures on a page never differ on one. */
export const hueClass = (hex) => `t-h-${hex.slice(1).toLowerCase()}`;
export const hueRule = (hex) => `.${hueClass(hex)} { --t-hue: ${hex}; }`;
