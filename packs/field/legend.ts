/**
 * The legend, and the filter: each type with its colour and shape, each
 * base by its shape, each side (open, closed) with how full it is drawn,
 * each kind of link, and items with no links, each with how many
 * the map has and how many show. A box switches each one; a type opens to
 * its statuses and kinds, each switched the same way. Every switch settles
 * the graph again with what is shown. Every mark is drawn as the canvas draws
 * its particle (shapes.ts `markPath`), by the drawing's own dials (shapes,
 * hollow outline, closed fade), so the key never says other than the map. Its other tab is the layout's dials
 * (panel.ts): how it settles and draws. Closed, it is one line (the count
 * and the two tabs); either tab opens it to the same size.
 */
import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import { toggle, type Count, type Facets, type Hide } from "./filter.ts";
import type { Settings } from "./graph.ts";
import { CIRCLE, fill, markPath } from "./shapes.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const LEGEND_STYLE = `
.fl-key { position:absolute; left:8px; bottom:6px; color:var(--dim); font-size:11px; background:color-mix(in srgb, var(--bg) 92%, transparent); border:1px solid var(--line); border-radius:4px; display:flex; flex-direction:column; }
.fl-key.open { width:min(280px, calc(100% - 16px)); height:min(360px, calc(100% - 12px)); }
.fl-key .bd { flex:1; min-height:0; overflow:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--dim) 55%, transparent) transparent; }
.fl-key .hd { display:flex; align-items:center; gap:8px; padding:3px 8px; }
.fl-key.open .hd { border-bottom:1px solid var(--line); }
.fl-key .hd b { color:var(--fg); font-weight:600; }
.fl-key .hd .sp { flex:1; }
.fl-key button { font:inherit; color:var(--fg); background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:0 6px; cursor:pointer; }
.fl-key button.ln { border:0; background:none; color:var(--dim); padding:0 2px; }
.fl-key button.ln:hover, .fl-key button.ln.on { color:var(--pick); }
.fl-key .fl-panel { height:auto; overflow:visible; background:none; scrollbar-gutter:auto; font-size:11px; }
.fl-key .fl-run, .fl-key .fl-acts, .fl-key .fl-sec > summary { padding-left:8px; padding-right:8px; }
.fl-key .fl-dial { grid-template-columns:88px 1fr 40px 12px; padding:1px 8px 1px 18px; }
.fl-key .fl-dial.in { grid-template-columns:78px 1fr 40px 12px; padding-left:28px; }
.fl-key .fl-dial input[type=number] { width:40px; }
.fl-key .fl-sec .doc, .fl-key .fl-grp { padding-left:18px; }
.fl-key .grp { padding:3px 8px 4px; }
.fl-key .grp + .grp { border-top:1px solid var(--line); }
.fl-key .gt { color:var(--dim); font-size:10px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:1px; }
.fl-key label { display:flex; align-items:center; gap:5px; cursor:pointer; white-space:nowrap; line-height:1.6; }
.fl-key label:hover .nm { color:var(--pick); }
.fl-key label.off .nm { color:var(--dim); text-decoration:line-through; }
.fl-key label.off i, .fl-key label.off svg { opacity:.35; }
.fl-key input[type=checkbox] { margin:0; accent-color:var(--pick); }
.fl-key .nm { color:var(--fg); }
.fl-key .n { margin-left:auto; padding-left:10px; font-variant-numeric:tabular-nums; }
.fl-key .row { display:flex; align-items:center; gap:4px; }
.fl-key .row label { flex:1; }
.fl-key .sub { padding:0 0 3px 22px; }
.fl-key .sub .gt { margin-top:2px; }
.fl-key i { display:inline-block; width:9px; height:9px; border-radius:50%; flex:none; }
.fl-key i.shut { opacity:.3; background:var(--dim); }
.fl-key i.open { background:var(--dim); }
.fl-key i.ring { background:transparent; border:2px solid var(--pick); width:7px; height:7px; }
.fl-key svg { width:20px; height:8px; flex:none; }
.fl-key svg.mk { width:11px; height:11px; fill-rule:evenodd; }
.fl-key svg.mk.ink { fill:var(--dim); }
.fl-key .key { display:flex; align-items:center; gap:5px; white-space:nowrap; line-height:1.6; padding-left:18px; }
.fl-key .key .nm { color:var(--dim); }
.fl-key .note { padding:3px 8px 5px; display:flex; align-items:center; gap:5px; }
.fl-key .note .sp { flex:1; }
`;

const num = (c: Count) => (c.shown === c.n ? String(c.n) : `${c.shown} of ${c.n}`);

/** The mark's radius and middle in its 12 × 12 box: a triangle's corner reaches 1.56 r. */
const MARK_R = 3.7, MARK_AT = 6;

export function Legend({ facets, hide, set, dials, look }: { facets: Facets; hide: Hide; set: (next: Hide | undefined) => void; dials: () => unknown; look: Settings }) {
  /** A particle's mark: `shape` (SHAPES), `side` (SIDES; absent: full), in `colour` (absent: the dim ink), faded as closed when `shut`. */
  const mark = (shape: number | undefined, side: number | undefined, colour?: string, shut = false) => {
    const sh = look.shapes ? (shape ?? CIRCLE) : CIRCLE, how = look.shapes && side !== undefined ? fill(side) : 2;
    return html`<svg class=${`mk${colour ? "" : " ink"}`} viewBox="0 0 12 12" style=${shut ? `opacity:${look.closed_fade}` : ""}><path d=${markPath(sh, how, MARK_AT, MARK_AT, MARK_R, look.hollow_line ?? 0.4)} style=${colour ? `fill:${colour}` : ""} /></svg>`;
  };
  const [open, setOpenTab] = useState<false | "filter" | "dials">(false);
  const tabs = html`
    <button class=${`ln${open === "filter" ? " on" : ""}`} onClick=${() => setOpenTab(open === "filter" ? false : "filter")} title="Every type, status, kind and link, each a switch">filter ${open === "filter" ? "▾" : "▴"}</button>
    <button class=${`ln${open === "dials" ? " on" : ""}`} onClick=${() => setOpenTab(open === "dials" ? false : "dials")} title="The layout's dials: how it settles and draws">dials ${open === "dials" ? "▾" : "▴"}</button>
  `;
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const any = Object.keys(hide).length > 0;
  const box = (on: boolean, flip: () => void, label: unknown, c: Count, title: string) => html`
    <label class=${on ? "" : "off"} title=${title}>
      <input type="checkbox" checked=${on} onChange=${flip} />
      ${label}
      <span class="n">${num(c)}</span>
    </label>
  `;
  const typeBox = (t: Facets["types"][number]) =>
    box(!hide.types?.includes(t.name), () => set(toggle(hide, "types", t.name)), html`${mark(t.shape, undefined, t.colour)}<span class="nm">${t.name}</span>`, t, `Show or hide every ${t.name}${look.shapes ? `, drawn as its base ${t.base}'s shape` : ""}`);
  // A base's switch shows all its types, or hides them all when any shows.
  const baseOn = (types: string[]) => types.some((t) => !hide.types?.includes(t));
  const flipBase = (types: string[]) => {
    const on = baseOn(types), rest = (hide.types ?? []).filter((t) => !types.includes(t)), next = { ...hide };
    const now = on ? [...rest, ...types] : rest;
    if (now.length) next.types = now;
    else delete next.types;
    set(next);
  };

  // One header, always: the count, show all, and the two tabs. Opened, either tab's body is the same size.
  const head = html`
    <div class="hd">
      <b>${num(facets.items)}</b> items
      <span class="sp"></span>
      ${any && html`<button class="ln" onClick=${() => set(undefined)} title="Show everything again">show all</button>`}
      ${tabs}
    </div>
  `;
  if (!open) return html`<div class="fl-key">${head}</div>`;
  if (open === "dials") return html`<div class="fl-key open">${head}<div class="bd">${dials()}</div></div>`;

  return html`
    <div class="fl-key open">
      ${head}
      <div class="bd">
      <div class="grp">
        <div class="gt">types · colour</div>
        ${facets.types.map(
          (t) => html`
            <div key=${t.name}>
              <div class="row">
                ${typeBox(t)}
                <button class="ln" onClick=${() => setOpened({ ...opened, [t.name]: !opened[t.name] })} title=${`${opened[t.name] ? "Hide" : "Show"} ${t.name}'s statuses and kinds`}>${opened[t.name] ? "▾" : "▸"}</button>
              </div>
              ${opened[t.name] &&
              html`<div class="sub">
                <div class="gt">status</div>
                ${t.statuses.map((s) => box(!hide.statuses?.includes(`${t.name}:${s.name}`), () => set(toggle(hide, "statuses", `${t.name}:${s.name}`)), html`${mark(t.shape, s.side, t.colour, s.closed)}<span class="nm">${s.name || "no status"}</span>`, s, `${t.name} that is ${s.name || "without a status"}: ${s.closed ? "closed, drawn full and faded" : s.side === 0 ? "its first status, drawn hollow" : "a later open status, drawn half"}`))}
                ${t.kinds.length > 1 &&
                html`<div class="gt">kind</div>
                  ${t.kinds.map((k) => box(!hide.kinds?.includes(`${t.name}:${k.name}`), () => set(toggle(hide, "kinds", `${t.name}:${k.name}`)), html`<span class="nm">${k.name}</span>`, k, `${t.name} of kind ${k.name}`))}`}
              </div>`}
            </div>
          `,
        )}
      </div>
      ${look.shapes ? html`<div class="grp">
        <div class="gt">shape · base</div>
        ${facets.bases.map((b) => box(baseOn(b.types), () => flipBase(b.types), html`${mark(b.shape, undefined)}<span class="nm">${b.name}</span>`, b, `Every type built on ${b.name} is drawn in this shape: ${b.types.join(", ")}`))}
      </div>` : null}
      <div class="grp">
        <div class="gt">state${look.shapes ? " · fill" : ""}</div>
        ${box(!hide.open, () => set(toggle(hide, "open")), html`${mark(undefined, undefined)}<span class="nm">open</span>`, facets.open, "Items whose status is on the open side: drawn in full colour")}
        ${look.shapes ? html`
        <div class="key" title="Open at its type's first status (todo, open, proposed): drawn hollow">${mark(undefined, 0)}<span class="nm">first status</span><span class="n">${num(facets.fresh)}</span></div>
        <div class="key" title="Open at a later status (doing, in review): drawn half, solid on the left">${mark(undefined, 1)}<span class="nm">later status</span><span class="n">${num(facets.moving)}</span></div>` : null}
        ${box(!hide.closed, () => set(toggle(hide, "closed")), html`${mark(undefined, undefined, undefined, true)}<span class="nm">closed</span>`, facets.closed, `Items whose status is on the closed side (done, dropped, decided): drawn ${look.shapes ? "full and " : ""}faded`)}
        ${box(!hide.lone, () => set(toggle(hide, "lone")), html`<span class="nm">with no links</span>`, facets.lone, "Items with no link to any other drawn item")}
      </div>
      <div class="grp">
        <div class="gt">links</div>
        ${facets.links.map((l) => box(!hide.links?.includes(l.name), () => set(toggle(hide, "links", l.name)), html`<svg viewBox="0 0 20 8"><path d="M0 4H20" stroke="currentColor" stroke-width=${l.name === "part_of" ? 1.6 : 1} /></svg><span class="nm">${l.name}</span>`, l, `Show or hide ${l.name} links`))}
      </div>
      <div class="note"><i class="ring"></i> pointed at: it and its links light, the rest dims</div>
      </div>
    </div>
  `;
}
