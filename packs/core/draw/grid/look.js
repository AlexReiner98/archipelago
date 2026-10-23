// How the grid drawing looks (index.js): rows by what the start holds, columns by lane, each thing a card coloured by
// one of its fields. Every length and number here is the style's (sizes and numbers, read as --ln-*): the house style
// names them. A card's colour and the grid's columns are classes the drawing writes rules for (hues, columns): a
// drawing sets no style on a mark.

export const css = `
.lg-card.here { outline: var(--ln-here-ring) solid var(--accent); outline-offset: var(--ln-here-ring); }
.lg-stage { position: relative; background: var(--ln-sea); padding: var(--ln-grid-pad); overflow-x: auto; }
.lg-grid { display: grid; gap: var(--ln-grid-gap); font-size: var(--ln-text-size); color: var(--ln-text); }
.lg-corner { min-height: var(--ln-rule); }
.lg-lane { padding: var(--ln-grid-head-pad-y) var(--ln-grid-head-pad-x); border-radius: var(--ln-radius-size); background: var(--ln-text); color: var(--ln-sea); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lg-row { padding: var(--ln-grid-row-pad-y) var(--ln-grid-gap); font-weight: 600; color: var(--ln-text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; border-top: var(--ln-rule) solid var(--ln-line); }
a.lg-row:hover { text-decoration: underline; }
.lg-row.loose { color: var(--ln-muted); font-weight: 500; }
.lg-cell { display: flex; flex-direction: column; gap: var(--ln-grid-gap); padding: var(--ln-grid-gap) 0; border-top: var(--ln-rule) solid var(--ln-line); min-width: 0; }
.lg-card { position: relative; z-index: 2; display: flex; flex-direction: column; gap: var(--ln-grid-card-gap); padding: var(--ln-grid-gap) var(--ln-grid-card-pad-right) var(--ln-grid-gap) var(--ln-grid-card-pad-left); border-radius: var(--ln-radius-size); border: var(--ln-rule) solid color-mix(in srgb, var(--lg-hue) var(--ln-grid-edge-mix), var(--ln-line)); border-left: var(--ln-grid-stripe) solid var(--lg-hue); background: color-mix(in srgb, var(--lg-hue) var(--ln-grid-tint), var(--ln-land)); color: var(--ln-text); text-decoration: none; min-width: 0; transition: opacity 0.15s; }
.lg-card:hover { background: color-mix(in srgb, var(--lg-hue) var(--ln-grid-tint-hover), var(--ln-land)); }
.lg-card.closed .lg-title { text-decoration: line-through; color: var(--ln-muted); }
.lg-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lg-detail { color: var(--ln-muted); font-size: var(--ln-grid-detail-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lg-marks { display: flex; gap: var(--ln-grid-mark-gap); flex-wrap: wrap; margin-top: var(--ln-grid-card-gap); }
.lg-due { padding: 0 var(--ln-pill-pad-x); border-radius: 999px; background: var(--ln-blocked); color: var(--on-mark); font-size: var(--ln-grid-mark-text); font-weight: 600; white-space: nowrap; }
.lg-legend { display: flex; gap: var(--ln-grid-legend-gap); flex-wrap: wrap; padding: var(--ln-grid-legend-pad-y) var(--ln-grid-legend-pad-x); font-size: var(--ln-legend-text); color: var(--ln-muted); }
.lg-chip { display: inline-block; box-sizing: content-box; width: var(--ln-swatch); height: var(--ln-swatch); margin-right: var(--ln-grid-gap); vertical-align: middle; border-radius: var(--ln-swatch-radius); background: color-mix(in srgb, var(--lg-hue) var(--ln-grid-swatch-mix), var(--ln-land)); border: var(--ln-rule) solid var(--lg-hue); }
.lg-card.dim { opacity: var(--ln-dim); }
.lg-h-none { --lg-hue: var(--ln-line); }
`;

/** The class a colour is drawn by, and its rule: named by the colour itself, so two pictures on a page never differ on one. */
export const hueClass = (hex) => `lg-h-${hex.slice(1).toLowerCase()}`;
export const hueRule = (hex) => `.${hueClass(hex)} { --lg-hue: ${hex}; }`;

/** The class a grid's columns are laid out by, and its rule: named by what it lays out, as hueClass is. */
const n = (v) => String(v).replace('.', '_');
export const columnsClass = (lanes, head, lane, gap) => `lg-c-${lanes}-${n(head)}-${n(lane)}-${n(gap)}`;
export const columnsRule = (lanes, head, lane, gap) => `.${columnsClass(lanes, head, lane, gap)} { grid-template-columns: minmax(${head}px, 0.7fr) repeat(${lanes}, minmax(${lane}px, 1fr)); min-width: ${head + lanes * (lane + gap)}px; }`;
