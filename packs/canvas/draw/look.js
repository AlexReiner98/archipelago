// How the canvas looks (index.js): land on a clean sea, in the lens's colours. Every length is the style's (sizes,
// read as --ln-space-*), every colour the theme's (--ln-*): change them in a style on the map, never here.

export const css = `
.sp-region .sp-shore { fill: var(--ln-land); stroke: var(--ln-line); stroke-width: var(--ln-space-stroke); }
.sp-region.d1 .sp-shore, .sp-region.d3 .sp-shore { fill: var(--ln-inner); }
.sp-region .sp-shore.behind { fill: var(--ln-sea); }
.sp-region .sp-shore.fold { fill: none; }
.sp-region.here > .sp-shore, .sp-region:hover > .sp-shore { stroke: var(--ln-text); }
.sp-region.dim { opacity: var(--ln-dim); }
.sp-head { cursor: pointer; }
.sp-hit { fill: transparent; }
.sp-head text { fill: var(--ln-muted); font: 600 var(--ln-space-head-text) var(--ln-font); letter-spacing: 0.02em; dominant-baseline: middle; }
.sp-region.here .sp-head text, .sp-head:hover text { fill: var(--ln-text); }
.sp-count rect { fill: var(--ln-sea); stroke: var(--ln-line); }
.sp-count.you rect { fill: var(--ln-you); stroke: none; } .sp-count.blocked rect { fill: var(--ln-blocked); stroke: none; }
.sp-count text { fill: var(--ln-text); font: 600 var(--ln-space-count-text) var(--ln-font); text-anchor: middle; dominant-baseline: middle; }
.sp-count.you text, .sp-count.blocked text { fill: var(--ln-sea); }
.sp-node { cursor: pointer; }
.sp-node .sp-shape { fill: var(--ln-sea); stroke: var(--ln-line); stroke-width: var(--ln-space-stroke); }
.sp-node .sp-shape.behind { fill: var(--ln-inner); }
.sp-node .sp-shape.fold, .sp-node .sp-shape.rim, .sp-node .sp-shape.pole { fill: none; }
.sp-node .sp-shape.glyph { fill: none; stroke: var(--ln-muted); }
.sp-node .sp-shape.hole { fill: var(--ln-land); }
.sp-node.you .sp-shape { stroke: var(--ln-you); }
.sp-node.blocked .sp-shape { stroke: var(--ln-blocked); }
.sp-node:hover .sp-shape, .sp-node.here .sp-shape { stroke: var(--ln-text); stroke-width: var(--ln-space-stroke-lit); }
.sp-node.here .sp-shape:not(.fold):not(.rim):not(.pole):not(.glyph) { fill: var(--ln-land); }
.sp-node text { fill: var(--ln-text); font-size: var(--ln-space-text); font-family: var(--ln-font); dominant-baseline: middle; }
.sp-node.closed text { fill: var(--ln-muted); }
.sp-node.dim { opacity: var(--ln-dim); }
.sp-dot { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-space-stroke); }
.sp-dot.done { fill: var(--ln-done); stroke: none; } .sp-dot.you { fill: var(--ln-you); stroke: none; }
.sp-dot.blocked { fill: var(--ln-blocked); stroke: none; } .sp-dot.session { fill: var(--ln-session); stroke: none; }
.sp-badge circle { fill: var(--ln-inner); stroke: var(--ln-line); }
.sp-badge text { fill: var(--ln-muted); font: 600 var(--ln-space-count-text) var(--ln-font); text-anchor: middle; dominant-baseline: middle; }
.sp-wire { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-space-stroke); opacity: 0.7; }
.sp-wire.waits_on { stroke: var(--ln-you); }
.sp-wire.mentions { stroke-dasharray: var(--ln-space-dash-mention); opacity: 0.45; }
.sp-wire.other { stroke-dasharray: var(--ln-space-dash-other); }
.sp-wire.broken { stroke: var(--ln-blocked); }
.sp-wire.lit { stroke: var(--ln-text); stroke-width: var(--ln-space-stroke-lit); opacity: 1; }
.sp-arrow { fill: var(--ln-muted); opacity: 0.7; } .sp-arrow.waits_on { fill: var(--ln-you); }
.sp-arrow.lit { fill: var(--ln-text); opacity: 1; }
.sp-faded { opacity: var(--ln-dim); }
.sp-tip { max-width: var(--ln-space-tip-most); padding: var(--ln-space-tip-pad); background: var(--ln-land); color: var(--ln-text); border: var(--ln-space-stroke) solid var(--ln-line); border-radius: var(--ln-space-corner); font: var(--ln-space-tip-text) var(--ln-font); line-height: 1.35; }
.sp-tip strong { display: block; }
.sp-tip .sp-meta { color: var(--ln-muted); }
.sp-tip p { margin: var(--ln-space-tip-gap) 0 0; }
.sp-tip .sp-flag { color: var(--ln-you); font-weight: 600; }
`;
