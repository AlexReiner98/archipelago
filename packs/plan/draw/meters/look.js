// How the meters drawing looks (index.js): a band for each limit, its bar, and the lists under it. Every length is
// the style's (sizes, read as --ln-meter-*: the plan pack's preset names them); the colours are the page's. A
// share's colour is a class the drawing writes a rule for (hueRule): a drawing sets no style on a mark.

export const css = `
.mt-stage { display: flex; flex-direction: column; gap: var(--ln-meter-gap); padding: var(--ln-meter-pad); max-width: var(--ln-meter-most); color: var(--ln-text); font-size: var(--ln-text-size); }
.mt-head { display: flex; gap: var(--ln-meter-row-gap); color: var(--ln-muted); font-size: var(--ln-meter-head-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-band { display: flex; flex-direction: column; gap: var(--ln-meter-bar-gap); min-width: 0; }
.mt-top { display: flex; align-items: baseline; gap: var(--ln-meter-row-gap); min-width: 0; }
.mt-name { flex: 1; min-width: 0; font-size: var(--ln-meter-name-text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-num { white-space: nowrap; color: var(--ln-muted); }
.mt-num strong { color: var(--ln-text); }
.mt-band.near .mt-num strong { color: var(--warn); }
.mt-band.over .mt-num strong { color: var(--bad); }
.mt-bar { display: block; width: 100%; height: var(--ln-meter-bar); }
.mt-track { fill: color-mix(in srgb, var(--ln-line) var(--ln-meter-track-mix), transparent); }
.mt-band.over > .mt-bar .mt-track { fill: color-mix(in srgb, var(--bad) var(--ln-meter-over-mix), transparent); }
.mt-fill { fill: var(--ok); }
.mt-band.near > .mt-bar .mt-fill { fill: var(--warn); }
.mt-band.over > .mt-bar .mt-fill { fill: var(--bad); }
.mt-share { fill: var(--mt-hue); }
.mt-list { display: flex; flex-direction: column; min-width: 0; margin-top: var(--ln-meter-list-gap); }
.mt-list-head { color: var(--ln-muted); font-size: var(--ln-meter-head-text); border-bottom: var(--ln-rule) solid var(--ln-line); padding-bottom: var(--ln-rule); }
.mt-row { display: grid; grid-template-columns: minmax(0, 1fr) var(--ln-meter-row-bar) var(--ln-meter-num); align-items: center; gap: var(--ln-meter-row-gap); min-height: var(--ln-meter-row); color: var(--ln-text); text-decoration: none; min-width: 0; }
a.mt-row:hover .mt-row-name { text-decoration: underline; }
.mt-row.hidden-part .mt-row-name { color: var(--ln-muted); font-style: italic; }
.mt-row-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mt-row-bar { display: block; width: 100%; height: var(--ln-meter-row-bar-height); }
.mt-row-bar .mt-fill { fill: var(--ln-muted); }
.mt-row-num { white-space: nowrap; color: var(--ln-muted); font-variant-numeric: tabular-nums; text-align: right; }
.mt-key-chip rect { fill: var(--mt-hue); }
`;

/** The class a colour is drawn by, and its rule: named by the colour itself. */
export const hueClass = (hex) => `mt-h-${hex.slice(1).toLowerCase()}`;
export const hueRule = (hex) => `.${hueClass(hex)} { --mt-hue: ${hex}; }`;
