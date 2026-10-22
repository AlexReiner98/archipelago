// How a story looks (story.js, play.js): the chapters above the picture, what was said below it, and the marks of a
// step: what comes in, in the accent; what goes, in the colour of what is wrong; a flag in it too. Every colour and
// length is the page's (its theme and lengths, read as --<name>).

export const css = `
.sp-top { display: grid; gap: var(--space-6); margin-bottom: var(--space-6); }
.sp-rail { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--space-4); overflow-x: auto; }
.sp-era { all: unset; cursor: pointer; display: block; min-width: 0; padding: 0 var(--space-3) var(--space-4); border-bottom: var(--border-4) solid var(--line); transition: border-color 0.4s; }
.sp-era:focus-visible { outline: var(--border-3) solid var(--accent); outline-offset: var(--space-2); }
.sp-era b, .sp-era small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-era b { font-size: var(--text-3); font-weight: 600; color: var(--muted); }
.sp-era small { font-size: var(--text-2); color: var(--muted); font-variant-numeric: tabular-nums; }
.sp-era.done { border-bottom-color: var(--edge); }
.sp-era.done b, .sp-era.now b { color: var(--text); }
.sp-era.now { border-bottom-color: var(--accent); }
.sp-key { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-9); margin: 0; padding: 0; list-style: none; font-size: var(--text-3); color: var(--muted); }
.sp-key li { display: flex; align-items: center; gap: var(--space-4); white-space: nowrap; }
.sp-swatch { width: var(--box-3); height: var(--box-3); border-radius: 50%; background: var(--muted); }
.sp-off { pointer-events: none; }
.ar-part .ar-shape { transition: fill 0.5s, stroke 0.8s, stroke-width 0.8s; }
.ar-wire, .ar-head { transition: stroke 0.8s, stroke-width 0.8s, fill 0.8s; }
.ar-part.sp-new .ar-shape { stroke: var(--accent); stroke-width: var(--border-3); }
.ar-part.sp-gone .ar-shape { stroke: var(--bad); stroke-width: var(--border-3); fill: var(--bad-soft); }
.ar-part.sp-gone text { fill: var(--bad); }
.ar-wire.sp-new { stroke: var(--accent); stroke-width: var(--border-3); }
.ar-head.sp-new { fill: var(--accent); }
.ar-wire.sp-gone { stroke: var(--bad); stroke-width: var(--border-3); }
.ar-head.sp-gone { fill: var(--bad); }
.sp-flag { fill: var(--bad); font-size: var(--text-1); font-weight: 700; text-anchor: end; dominant-baseline: middle; }
.ar-part.sp-flagged .ar-shape { fill: var(--bad-soft); stroke: var(--bad); }
.ar-place-box.sp-flagged { stroke: var(--bad); stroke-width: var(--border-2); }
.ar-place.sp-flagged text { fill: var(--bad); }
.sp-chat { position: relative; height: calc(var(--box-9) * 5); margin-top: var(--space-6); background: var(--panel); border: var(--border-1) solid var(--line); border-radius: var(--radius-4); }
.sp-head { display: flex; align-items: center; gap: var(--space-5); height: var(--box-8); padding: 0 var(--space-7); border-bottom: var(--border-1) solid var(--line); font-size: var(--text-2); color: var(--muted); }
.sp-head .grow { flex: 1; }
.sp-live { width: var(--box-3); height: var(--box-3); border-radius: 50%; background: var(--ok); }
.sp-count { font-variant-numeric: tabular-nums; }
.sp-head button { font: inherit; color: var(--text); background: var(--bg); border: var(--border-1) solid var(--line); border-radius: var(--radius-pill); padding: var(--space-1) var(--space-7); cursor: pointer; }
.sp-log { position: absolute; inset: var(--box-8) 0 0 0; margin: 0; padding: var(--space-6) var(--space-7); list-style: none; display: flex; flex-direction: column; justify-content: flex-end; gap: var(--space-4); overflow: hidden; mask-image: linear-gradient(to bottom, transparent 0, black var(--box-9)); }
.sp-line { flex: none; max-width: min(88%, 62ch); opacity: 0; transform: translateY(var(--space-4)); transition: opacity 0.35s ease, transform 0.35s ease; display: flex; gap: var(--space-5); align-items: baseline; }
.sp-line.in { opacity: 1; transform: none; }
.sp-line p { margin: 0; font-size: var(--text-4); line-height: 1.4; }
.sp-who { flex: none; font-size: var(--text-1); letter-spacing: var(--track-2); text-transform: uppercase; color: var(--muted); }
.sp-line.mine { align-self: flex-end; background: var(--accent-soft); border-radius: var(--radius-4) var(--radius-4) var(--radius-1) var(--radius-4); padding: var(--space-3) var(--space-6); }
.sp-line.theirs, .sp-typing { align-self: flex-start; background: var(--closed-soft); border-radius: var(--radius-4) var(--radius-4) var(--radius-4) var(--radius-1); padding: var(--space-3) var(--space-6); }
.sp-line.chapter { align-self: center; max-width: none; color: var(--muted); }
.sp-line.chapter p { font-size: var(--text-1); letter-spacing: var(--track-2); }
.sp-line.note { align-self: center; }
.sp-line.note p { font-weight: 600; }
`;
