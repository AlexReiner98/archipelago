// How the channels table looks (index.js): a head, a band for each month, a row per channel on one line. Every length
// is the style's (sizes, read as --ln-table-*: the social pack's preset names them); the colours are the page's. Where
// the style gives a narrow width (table.narrow), below it the bars fold away and their shares stay: a container
// query cannot read a variable, so that one length comes in as a value.

const columns = (ratio) => `minmax(0, 1fr) repeat(3, var(--ln-table-num)) ${ratio} var(--ln-table-num) ${ratio} repeat(2, var(--ln-table-num)) var(--ln-table-mark)`;

const base = `
.tb-stage { container-type: inline-size; display: flex; flex-direction: column; gap: var(--ln-table-gap); padding: var(--ln-table-pad); max-width: var(--ln-table-most); margin: 0 auto; box-sizing: border-box; color: var(--ln-text); font-size: var(--ln-text-size); }
.tb-band { display: flex; flex-direction: column; min-width: 0; }
.tb-month { color: var(--ln-muted); font-size: var(--ln-table-head-text); border-bottom: var(--ln-rule) solid var(--ln-line); padding-bottom: var(--ln-rule); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb-row { display: grid; grid-template-columns: ${columns('var(--ln-table-ratio)')}; align-items: center; column-gap: var(--ln-table-col-gap); min-height: var(--ln-table-row); color: var(--ln-text); text-decoration: none; min-width: 0; }
.tb-head { color: var(--ln-muted); font-size: var(--ln-table-head-text); min-height: 0; }
a.tb-row:hover .tb-name { text-decoration: underline; }
.tb-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.tb-row:not(.tb-head):not(.source) .tb-name { font-weight: 600; }
.tb-num { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; font-variant-numeric: tabular-nums; min-width: 0; }
.tb-ratio { display: flex; align-items: center; gap: var(--ln-table-bar-gap); min-width: 0; }
.tb-bar { display: block; flex: 1; min-width: 0; height: var(--ln-table-bar); }
.tb-track { fill: color-mix(in srgb, var(--ln-line) var(--ln-table-track-mix), transparent); }
.tb-fill { fill: var(--ok); }
.tb-share { white-space: nowrap; color: var(--ln-muted); font-variant-numeric: tabular-nums; text-align: right; flex: none; min-width: var(--ln-table-share); }
.tb-mark { display: flex; justify-content: center; }
.tb-dot { display: block; width: var(--ln-table-dot); height: var(--ln-table-dot); }
.tb-dot circle { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-table-dot-line); }
.tb-dot.met circle { fill: var(--ok); stroke: var(--ok); }
`;

const LENGTH = /^\d+(?:\.\d+)?(?:px|rem|em|ch)$/;

/** The stylesheet, with the fold below `narrow` (a length) where one is given. */
export const css = (narrow) =>
  typeof narrow === 'string' && LENGTH.test(narrow)
    ? `${base}@container (max-width: ${narrow}) { .tb-bar { display: none; } .tb-row { grid-template-columns: ${columns('var(--ln-table-share)')}; } }\n`
    : base;
