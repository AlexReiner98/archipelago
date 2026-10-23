// How the flow drawing looks (index.js): a process map in the lens's colours. The frame, the key and the breaks' place
// are the page's (ui/flow.css). Every width and number here is the style's (sizes and numbers, read as --ln-*).

export const css = `
.lf-step { cursor: pointer; }
.lf-step .lf-shape { fill: var(--ln-land); stroke: var(--ln-line); stroke-width: var(--ln-flow-stroke); }
.lf-step.scenario .lf-shape { stroke: var(--ln-muted); stroke-dasharray: var(--ln-flow-dash-scenario); }
.lf-step.you .lf-shape { stroke: var(--ln-you); }
.lf-step.here .lf-shape, .lf-step:hover .lf-shape, .lf-step:focus .lf-shape { stroke: var(--ln-text); stroke-width: var(--ln-flow-stroke-lit); }
.lf-step text { fill: var(--ln-text); font-size: var(--ln-flow-text); font-family: var(--ln-font); dominant-baseline: middle; }
.lf-step.closed text, .lf-step.stub text { fill: var(--ln-muted); }
.lf-step.stub text { font-size: var(--ln-flow-stub-text); }
.lf-step.dim { opacity: var(--ln-dim); }
.lf-dot { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-flow-dot-ring); }
.lf-dot.done { fill: var(--ln-done); stroke: none; } .lf-dot.you { fill: var(--ln-you); stroke: none; }
.lf-dot.blocked { fill: var(--ln-blocked); stroke: none; } .lf-dot.session { fill: var(--ln-session); stroke: none; }
.lf-badge circle { fill: var(--ln-inner); stroke: var(--ln-line); } .lf-badge.you circle { fill: var(--ln-you); }
.lf-badge text { fill: var(--ln-text); font-weight: 700; font-size: var(--ln-flow-badge-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: middle; }
.lf-badge.you text { fill: var(--ln-sea); }
.lf-wire { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-flow-stroke); }
.lf-wire.dashed { stroke-dasharray: var(--ln-flow-dash-choice); }
.lf-wire.lit { stroke: var(--ln-text); stroke-width: var(--ln-flow-stroke-lit); }
.lf-head { fill: var(--ln-muted); } .lf-head.lit { fill: var(--ln-text); }
.lf-break rect { fill: var(--ln-sea); } .lf-break path { stroke: var(--ln-muted); stroke-width: var(--ln-flow-stroke); }
.lf-says rect { fill: var(--ln-sea); } .lf-says text { fill: var(--ln-muted); font-size: var(--ln-flow-says-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: middle; }
/* A checklist: plain things before one step, a row each. The head says the type and how many are left. */
.lf-list { cursor: default; }
.lf-list:hover .lf-shape { stroke: var(--ln-line); stroke-width: var(--ln-flow-stroke); }
.lf-step text.lf-list-head { font-size: var(--ln-flow-row-text); font-weight: 600; fill: var(--ln-muted); }
.lf-list-rule { stroke: var(--ln-line); stroke-width: var(--ln-rule); }
.lf-row { cursor: pointer; }
.lf-row text { font-size: var(--ln-flow-row-text); }
.lf-row-hit { fill: transparent; }
.lf-row:hover .lf-row-hit, .lf-row:focus .lf-row-hit { fill: var(--ln-sea); }
.lf-row.closed text { fill: var(--ln-muted); }
.lf-row.dim { opacity: var(--ln-dim); }
`;
