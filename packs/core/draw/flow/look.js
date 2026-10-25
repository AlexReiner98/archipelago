// How the flow drawing looks (index.js): a flat graph in the lens's colours. The frame, the key and the breaks' place
// are the page's (ui/flow.css). Every width and number here is the style's (sizes and numbers, read as --ln-*).

export const css = `
.lf-step { cursor: pointer; }
.lf-step.dragging { cursor: grabbing; }
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
.lf-wire { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-flow-stroke); }
.lf-wire.dashed { stroke-dasharray: var(--ln-flow-dash-choice); }
.lf-wire.lit { stroke: var(--ln-text); stroke-width: var(--ln-flow-stroke-lit); }
.lf-head { fill: var(--ln-muted); } .lf-head.lit { fill: var(--ln-text); }
/* A tie (part_of, or any link that is not the order): quiet, under the wires; one to what a step is part of is solid. */
.lf-tie { fill: none; stroke: var(--ln-line); stroke-width: var(--ln-rule); stroke-dasharray: var(--ln-flow-dash-choice); }
.lf-tie.near { stroke-dasharray: none; }
.lf-tie.lit { stroke: var(--ln-text); stroke-width: var(--ln-flow-stroke); }
/* A change held for the owner, where it would land: a new step faint, an edit marked on its step, a link dashed in the
   colour of what waits on you; a link just drawn here dashed until it is; the badge where it is decided. */
.lf-step.ghost { opacity: var(--ln-flow-ghost); cursor: default; }
.lf-step.ghost .lf-shape, .lf-step.held .lf-shape { stroke: var(--ln-you); stroke-dasharray: var(--ln-flow-dash-held); }
.lf-wire.held, .lf-tie.held { stroke: var(--ln-you); stroke-width: var(--ln-flow-stroke); stroke-dasharray: var(--ln-flow-dash-held); }
.lf-wire.held.mine, .lf-tie.held.mine { stroke: var(--ln-text); }
.lf-head.held { fill: var(--ln-you); } .lf-head.held.mine { fill: var(--ln-text); }
.lf-held { cursor: pointer; }
.lf-held circle { fill: var(--ln-land); stroke: var(--ln-you); stroke-width: var(--ln-flow-stroke); }
.lf-held:hover circle { stroke-width: var(--ln-flow-stroke-lit); }
.lf-held text { fill: var(--ln-you); font-size: var(--ln-flow-held-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: central; }
/* A step's tip (the page puts it beside the step): its title, then the start of its note. */
.lf-tip { max-width: var(--tip-most); padding: var(--space-5) var(--space-7); background: var(--panel); color: var(--text); border: var(--border-1) solid var(--edge); border-radius: var(--radius-3); font-size: var(--text-3); line-height: 1.4; }
.lf-tip b { display: block; }
.lf-tip span { display: block; margin-top: var(--space-2); color: var(--muted); }
.lf-break rect { fill: var(--ln-sea); } .lf-break path { stroke: var(--ln-muted); stroke-width: var(--ln-flow-stroke); }
/* Zoomed out until only names are read (ui/pan-zoom.js): what a choice is is not drawn. */
[data-text=names] .lf-says { display: none; }
.lf-says rect { fill: var(--ln-sea); } .lf-says text { fill: var(--ln-muted); font-size: var(--ln-flow-says-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: middle; }
`;
