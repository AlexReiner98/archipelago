/** The item page's sheet: style tokens only. */
import { sheet } from "../../spec/style.ts";

export const STYLE = sheet(`
.ip { padding:var(--space-3) 0 var(--space-5); line-height:var(--leading); }
.ip-head { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4) var(--space-1); }
.ip-head .t { flex:1; min-width:0; font-weight:var(--bold); font-size:var(--text-l); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ip-x { font:inherit; background:none; border:0; color:var(--dim); cursor:pointer; padding:0 var(--space-2); }
.ip-x:hover { color:var(--fg); }
.ip-mk { width:1.1em; text-align:center; flex:none; display:inline-block; }
.ip-mk.s-fresh { color:var(--mark-fresh); } .ip-mk.s-moving { color:var(--mark-moving); } .ip-mk.s-done { color:var(--mark-done); } .ip-mk.s-gone { color:var(--mark-gone); }
.ip-sub { padding:0 var(--space-4) var(--space-2); color:var(--dim); font-size:var(--text-s); }
.ip-marks { display:flex; flex-wrap:wrap; gap:var(--space-1); padding:0 var(--space-4) var(--space-2); }
.ip-chip { font-size:var(--text-s); border:1px solid var(--line); border-radius:var(--radius); padding:0 var(--space-2); white-space:nowrap; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
.ip-label { padding:var(--space-3) var(--space-4) var(--space-1); color:var(--dim); font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.06em; }
.ip-note { margin:var(--space-1) var(--space-4) var(--space-2); }
.ip-note p { margin:0 0 var(--space-2); }
.ip-note ul, .ip-note ol { margin:0 0 var(--space-2); padding-left:1.3em; }
.ip-note blockquote { margin:0 0 var(--space-2); padding-left:var(--space-3); border-left:2px solid var(--line); color:var(--dim); }
.ip-note pre { margin:0 0 var(--space-2); font-family:var(--mono); font-size:var(--text-s); white-space:pre-wrap; background:var(--panel); padding:var(--space-2); border-radius:var(--radius); }
.ip-note code { font-family:var(--mono); font-size:.92em; background:var(--panel); padding:0 3px; border-radius:var(--radius); }
.ip-note table { border-collapse:collapse; margin:0 0 var(--space-2); font-size:var(--text-s); }
.ip-note th, .ip-note td { border-bottom:1px solid var(--line); padding:1px var(--space-2); text-align:left; vertical-align:top; }
.ip-fold { margin:0 0 var(--space-1); }
.ip-fold > summary { cursor:pointer; font-weight:var(--bold); list-style:none; }
.ip-fold > summary::-webkit-details-marker { display:none; }
.ip-fold > summary::before { content:"▸"; color:var(--dim); display:inline-block; width:1em; }
.ip-fold[open] > summary::before { content:"▾"; }
.ip-fold[open] > summary { margin-bottom:var(--space-1); }
.ip-fold > :not(summary) { margin-left:1em; }
.ip-ref { cursor:pointer; color:inherit; text-decoration:underline; text-decoration-color:var(--line); text-underline-offset:2px; }
.ip-ref:hover { text-decoration-color:var(--fg); }
.ip-ref .ip-mk { width:auto; margin-right:2px; font-size:.85em; }
.ip-near { padding:0 var(--space-4); display:flex; flex-direction:column; gap:var(--space-2); }
.ip-kind { color:var(--dim); font-size:var(--text-s); }
.ip-end { display:flex; gap:var(--space-2); align-items:baseline; cursor:pointer; padding:1px var(--space-2); border-radius:var(--radius); white-space:nowrap; }
.ip-end .v { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.ip-end:hover { background:var(--pick); }
.ip-more { font:inherit; font-size:var(--text-s); background:none; border:0; color:var(--dim); cursor:pointer; padding:0 var(--space-2); text-align:left; }
.ip-more:hover { color:var(--fg); }
.ip-hist { padding:0 var(--space-4); display:flex; flex-direction:column; gap:var(--space-2); }
.ip-change { border-left:2px solid var(--line); padding:0 0 0 var(--space-3); }
.ip-change.undone { opacity:.55; }
.ip-change.undone .ip-line { text-decoration:line-through; }
.ip-change-head { display:flex; gap:var(--space-2); align-items:baseline; font-size:var(--text-s); }
.ip-who { font-weight:var(--bold); }
.ip-right { margin-left:auto; }
.ip-why { font-size:var(--text-s); color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ip-line { font-size:var(--text-s); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ip-refused { font-size:var(--text-s); color:var(--failed); }
.ip-undo { font:inherit; font-size:var(--text-xs); background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:0 var(--space-2); cursor:pointer; }
.ip-undo:hover { border-color:var(--dim); }
.ip-dim { color:var(--dim); }
.ip-foot { display:flex; gap:var(--space-2); align-items:center; padding:var(--space-4) var(--space-4) 0; }
.ip-btn { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:0 var(--space-3); cursor:pointer; }
.ip-btn:hover { border-color:var(--dim); }
`);
