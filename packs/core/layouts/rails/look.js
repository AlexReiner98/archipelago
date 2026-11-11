// How the rails look (index.js): stops on the land, the walk a firm line in the accent, other links quiet. Every
// length is the style's (sizes rails_*, read as --ln-rails-*), every colour the lens's. Layer: marks.

export const css = `
.rl-stop { cursor: pointer; }
.rl-box { fill: var(--ln-land); stroke: var(--ln-line); stroke-width: var(--ln-rails-stroke); }
.rl-stop:hover .rl-box, .rl-stop:focus .rl-box, .rl-stop.here .rl-box { stroke: var(--ln-accent, var(--ln-text)); stroke-width: var(--ln-rails-stroke-lit); }
.rl-name { fill: var(--ln-text); font-size: var(--ln-rails-text); font-family: var(--ln-font); dominant-baseline: middle; }
.rl-badge { fill: var(--ln-accent, var(--ln-text)); stroke: var(--ln-land); stroke-width: var(--ln-rails-stroke); }
.rl-number { fill: var(--ln-land); font-size: var(--ln-rails-number); font-family: var(--ln-font); font-weight: 600; dominant-baseline: central; }
.rl-track { fill: none; stroke: var(--ln-accent, var(--ln-text)); stroke-width: var(--ln-rails-rail); stroke-linecap: round; }
.rl-rail .rl-head { fill: var(--ln-accent, var(--ln-text)); }
.rl-line { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-rails-stroke); }
.rl-wire .rl-head { fill: var(--ln-muted); }
.rl-wire:hover .rl-line { stroke: var(--ln-text); stroke-width: var(--ln-rails-stroke-lit); }
`;
