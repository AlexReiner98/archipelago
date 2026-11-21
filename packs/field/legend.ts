/**
 * The legend, and the filter: each type with its colour, each side (open,
 * closed), each kind of link, and items with no links, each with how many
 * the map has and how many show. A box switches each one; a type opens to
 * its statuses and kinds, each switched the same way. Every switch settles
 * the graph again with what is shown. Folded, it is one line of types,
 * still switches.
 */
import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import { toggle, type Count, type Facets, type Hide } from "./filter.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const LEGEND_STYLE = `
.fl-key { position:absolute; left:8px; bottom:6px; color:var(--dim); font-size:11px; background:color-mix(in srgb, var(--bg) 92%, transparent); border:1px solid var(--line); border-radius:4px; max-width:min(340px, calc(100% - 32px)); max-height:calc(100% - 24px); overflow:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--dim) 55%, transparent) transparent; }
.fl-key .hd { display:flex; align-items:center; gap:8px; padding:4px 8px; position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); }
.fl-key .hd b { color:var(--fg); font-weight:600; }
.fl-key .hd .sp { flex:1; }
.fl-key button { font:inherit; color:var(--fg); background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:0 6px; cursor:pointer; }
.fl-key button.ln { border:0; background:none; color:var(--dim); padding:0 2px; }
.fl-key button.ln:hover { color:var(--pick); }
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
.fl-key .inline { display:flex; flex-wrap:wrap; gap:0 12px; padding:3px 8px 4px; }
.fl-key .inline label { line-height:1.5; }
.fl-key i { display:inline-block; width:9px; height:9px; border-radius:50%; flex:none; }
.fl-key i.shut { opacity:.3; background:var(--dim); }
.fl-key i.open { background:var(--dim); }
.fl-key i.ring { background:transparent; border:2px solid var(--pick); width:7px; height:7px; }
.fl-key svg { width:20px; height:8px; flex:none; }
.fl-key .note { padding:3px 8px 5px; display:flex; align-items:center; gap:5px; }
`;

const num = (c: Count) => (c.shown === c.n ? String(c.n) : `${c.shown} of ${c.n}`);

export function Legend({ facets, hide, set }: { facets: Facets; hide: Hide; set: (next: Hide | undefined) => void }) {
  const [open, setOpen] = useState(false);
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
    box(!hide.types?.includes(t.name), () => set(toggle(hide, "types", t.name)), html`<i style=${`background:${t.colour}`}></i><span class="nm">${t.name}</span>`, t, `Show or hide every ${t.name}`);

  if (!open)
    return html`
      <div class="fl-key">
        <div class="hd">
          <b>${num(facets.items)}</b> items
          <span class="sp"></span>
          ${any && html`<button class="ln" onClick=${() => set(undefined)} title="Show everything again">show all</button>`}
          <button class="ln" onClick=${() => setOpen(true)} title="Open the legend: every status, kind and link, each a switch">filter ▴</button>
        </div>
        <div class="inline">${facets.types.map((t) => html`<span key=${t.name}>${typeBox(t)}</span>`)}</div>
      </div>
    `;

  return html`
    <div class="fl-key">
      <div class="hd">
        <span>showing <b>${num(facets.items)}</b> items</span>
        <span class="sp"></span>
        ${any && html`<button onClick=${() => set(undefined)} title="Show everything again">show all</button>`}
        <button class="ln" onClick=${() => setOpen(false)} title="Fold the legend to one line">fold ▾</button>
      </div>
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
                ${t.statuses.map((s) => box(!hide.statuses?.includes(`${t.name}:${s.name}`), () => set(toggle(hide, "statuses", `${t.name}:${s.name}`)), html`<i class=${s.closed ? "shut" : "open"}></i><span class="nm">${s.name || "no status"}</span>`, s, `${t.name} that is ${s.name || "without a status"}${s.closed ? " (closed)" : ""}`))}
                ${t.kinds.length > 1 &&
                html`<div class="gt">kind</div>
                  ${t.kinds.map((k) => box(!hide.kinds?.includes(`${t.name}:${k.name}`), () => set(toggle(hide, "kinds", `${t.name}:${k.name}`)), html`<span class="nm">${k.name}</span>`, k, `${t.name} of kind ${k.name}`))}`}
              </div>`}
            </div>
          `,
        )}
      </div>
      <div class="grp">
        <div class="gt">state</div>
        ${box(!hide.open, () => set(toggle(hide, "open")), html`<i class="open"></i><span class="nm">open</span>`, facets.open, "Items whose status is on the open side: drawn full")}
        ${box(!hide.closed, () => set(toggle(hide, "closed")), html`<i class="shut"></i><span class="nm">closed</span>`, facets.closed, "Items whose status is on the closed side (done, dropped, decided): drawn faded")}
        ${box(!hide.lone, () => set(toggle(hide, "lone")), html`<span class="nm">with no links</span>`, facets.lone, "Items with no link to any other drawn item")}
      </div>
      <div class="grp">
        <div class="gt">links</div>
        ${facets.links.map((l) => box(!hide.links?.includes(l.name), () => set(toggle(hide, "links", l.name)), html`<svg viewBox="0 0 20 8"><path d="M0 4H20" stroke="currentColor" stroke-width=${l.name === "part_of" ? 1.6 : 1} /></svg><span class="nm">${l.name}</span>`, l, `Show or hide ${l.name} links`))}
      </div>
      <div class="note"><i class="ring"></i> pointed at: it and its links light, the rest dims</div>
    </div>
  `;
}
