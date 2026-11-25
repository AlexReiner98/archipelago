/**
 * The Context interface's style sheet: the panes, the bar, the rows and the
 * lines the harness view draws, and the sheets of its parts (keep, agents,
 * dials, trees, bar, canvas, timeline, window bar, trend, calls, spend, and
 * the item page's button into the view).
 * index.ts puts it in the page while the plugin is loaded.
 */
import { sheet } from "../../spec/style.ts";
import { AGENTS_STYLE } from "./agents.ts";
import { BAR_STYLE } from "./bar.ts";
import { CALLS_STYLE } from "./calls.ts";
import { CANVAS_STYLE } from "./canvas.ts";
import { DIALS_STYLE } from "./dials.ts";
import { KEEP_STYLE } from "./keep.ts";
import { OPEN_STYLE } from "./open.ts";
import { SPEND_STYLE } from "./spend.ts";
import { TIMELINE_STYLE } from "./timeline.ts";
import { TREES_STYLE } from "./trees.ts";
import { TREND_STYLE } from "./trend.ts";
import { WINDOWBAR_STYLE } from "./windowbar.ts";

export const STYLE = sheet(`
.hv-pane { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; }
.hv-head { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-height:20px; min-width:0; overflow:hidden; }
.hv-head .t { font-weight:var(--bold); }
.hv-head .sp, .hv-bar .sp { flex:1; }
.hv-dim { color:var(--dim); }
.hv-cut { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.hv-body { flex:1; overflow:auto; min-height:0; }
.hv-row { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4); white-space:nowrap; cursor:pointer; }
.hv-row:hover, .hv-ev:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-row .x { overflow:hidden; text-overflow:ellipsis; flex:1; min-width:6em; }
.hv-row .n { color:var(--dim); font-variant-numeric:tabular-nums; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.hv-group { padding:var(--space-3) var(--space-4) 1px; color:var(--dim); font-size:var(--text-s); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-lit { background:var(--lit) !important; }
.hv-pick { box-shadow:inset 3px 0 0 var(--pick); }
.hv-m { width:1em; text-align:center; flex:none; }
.m-held { color:var(--held); } .m-failed { color:var(--failed); } .m-quiet, .m-none { color:var(--quiet); } .m-act { color:${"var(--write)"}; }
.hv-btn { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--dim); padding:0 var(--space-3); border-radius:var(--radius); cursor:pointer; }
.hv-bar button { font:inherit; background:none; border:0; color:var(--dim); padding:0; cursor:pointer; flex:none; }
.hv-bar button:hover { color:var(--fg); }
.hv-bar button.on { color:var(--fg); text-decoration:underline; text-underline-offset:4px; }
.hv-select { font:inherit; background:var(--control); color:var(--fg); border:1px solid var(--control-line); border-radius:var(--radius); max-width:220px; min-width:0; }
.hv-select option { background:var(--panel); color:var(--fg); }
.hv-ev { cursor:pointer; animation:hv-ev-in var(--hv-row, .6s) ease-out both; }
@keyframes hv-ev-in { from { background-color:color-mix(in srgb, var(--pick) 22%, transparent); } }
.hv-line { display:flex; gap:var(--space-2); align-items:baseline; padding:1px var(--space-4) 1px var(--space-2); white-space:nowrap; min-width:0; }
.hv-line .x { overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
.hv-line .p { color:var(--dim); flex:none; max-width:35%; overflow:hidden; text-overflow:ellipsis; }
.hv-line .s { color:var(--dim); flex:none; font-variant-numeric:tabular-nums; width:2.5em; text-align:right; }
.hv-dir { color:var(--dim); flex:none; width:1em; text-align:center; }
.hv-later { opacity:.4; }
.hv-ev.broke { box-shadow:inset -3px 0 0 var(--failed); }
.hv-open { margin:0 var(--space-2) var(--space-2) var(--space-3); padding:var(--space-1) 0 var(--space-1) var(--space-3); border-left:2px solid var(--line); cursor:default; white-space:normal; }
.hv-part { padding:2px 0; min-width:0; }
.hv-part .k { display:block; color:var(--dim); font-size:var(--text-xs); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hv-part pre { margin:0; font:var(--text-s)/var(--leading) var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; max-width:70ch; }
.hv-fold { font:inherit; font-size:var(--text-xs); background:none; border:0; color:var(--pick); cursor:pointer; padding:0; }
.hv-kv { display:flex; gap:var(--space-3); padding:1px var(--space-4); white-space:nowrap; }
.hv-kv .k { color:var(--dim); width:4.5em; flex:none; }
.hv-kv .v { overflow:hidden; text-overflow:ellipsis; }
.hv-kv .v.hv-link { color:var(--pick); cursor:pointer; }
.hv-words { margin:var(--space-3) var(--space-4); }
.hv-given { padding:var(--space-2) var(--space-4); }
.hv-words textarea { width:100%; box-sizing:border-box; min-height:84px; overflow:hidden; font:inherit; background:var(--control); color:var(--fg); border:1px solid var(--control-line); border-radius:var(--radius); padding:var(--space-2) var(--space-3); resize:none; }
.hv-words .ro { white-space:pre-wrap; padding:var(--space-2) var(--space-3); border-left:2px solid var(--line); }
.hv-words .bar { display:flex; gap:var(--space-3); align-items:center; margin-top:var(--space-2); color:var(--dim); white-space:nowrap; }
.hv-empty { padding:var(--space-4); color:var(--dim); display:flex; gap:var(--space-3); align-items:baseline; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-empty::before { content:var(--glyph-circle-fresh); color:var(--mark-fresh); flex:none; }
.hv-tag { flex:none; font-size:var(--text-xs); padding:0 var(--space-2); border-radius:var(--radius); border:1px dashed var(--pick); color:var(--pick); }
.hv-prof { display:flex; gap:var(--space-4); padding:var(--space-1) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; overflow:hidden; }
.hv-prof .part { color:var(--dim); }
.hv-miss { margin:var(--space-1) var(--space-4) var(--space-3); padding:var(--space-2) var(--space-3); border-left:3px solid var(--failed); white-space:pre-wrap; color:var(--dim); max-height:8em; overflow:auto; }
.hv-view { display:grid; grid-template-rows:auto auto 1fr auto; height:100%; min-height:0; }
.hv-bar { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-width:0; position:relative; z-index:2; }
.hv-bar .live { color:var(--say); flex:none; }
.hv-n { font-variant-numeric:tabular-nums; flex:none; }
${KEEP_STYLE}
${OPEN_STYLE}
${AGENTS_STYLE}
${DIALS_STYLE}
${TREES_STYLE}
${BAR_STYLE}
${CANVAS_STYLE}
${TIMELINE_STYLE}
${WINDOWBAR_STYLE}
${TREND_STYLE}
${CALLS_STYLE}
${SPEND_STYLE}
.hv-onerun { display:grid; grid-template-rows:minmax(0,1fr) auto; min-height:0; min-width:0; }
.hv-onerun > .rx-canvas { grid-row:1; }`);
