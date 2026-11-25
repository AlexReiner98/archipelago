/**
 * The field's panel: its buttons, then a section per behaviour, with its
 * switch and every one of its dials, then the start and the run, and last,
 * closed, how the run is going (its state). Sections start closed; each names how many of its dials
 * differ from where they started. Each dial says what it does on hover and
 * goes back to where it started with ↺.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { Behaviour, Dial } from "./behaviour.ts";
import type { Settings } from "./graph.ts";
import type { Stats } from "./engine.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const PANEL_STYLE = `
.fl-panel { height:100%; min-width:0; overflow:auto; font-size:12px; background:var(--bg); scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--dim) 55%, transparent) transparent; scrollbar-gutter:stable; }
.fl-panel::-webkit-scrollbar { width:8px; }
.fl-panel::-webkit-scrollbar-track { background:transparent; }
.fl-panel::-webkit-scrollbar-thumb { background:color-mix(in srgb, var(--dim) 55%, transparent); border-radius:4px; border:2px solid var(--bg); }
.fl-panel::-webkit-scrollbar-thumb:hover { background:var(--dim); }
.fl-run { padding:6px 10px; border-bottom:1px solid var(--line); color:var(--dim); font-variant-numeric:tabular-nums; display:grid; grid-template-columns:auto 1fr; column-gap:10px; row-gap:1px; }
.fl-run b { color:var(--fg); font-weight:600; }
.fl-run .st-settling { color:var(--pick); } .fl-run .st-settled { color:var(--held); } .fl-run .st-stopped { color:var(--failed, var(--pick)); }
.fl-acts { display:flex; gap:6px; padding:6px 10px; border-bottom:1px solid var(--line); }
.fl-acts button { font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; padding:1px 8px; cursor:pointer; }
.fl-acts button:hover { border-color:var(--dim); }
.fl-sec { border-bottom:1px solid var(--line); }
.fl-sec > summary { padding:5px 10px; cursor:pointer; display:flex; gap:6px; align-items:center; list-style:none; }
.fl-sec > summary::-webkit-details-marker { display:none; }
.fl-sec > summary::before { content:"▸"; color:var(--dim); width:8px; font-size:10px; }
.fl-sec[open] > summary::before { content:"▾"; }
.fl-sec > summary:hover .nm { color:var(--pick); }
.fl-sec > summary .nm { font-weight:600; flex:1; }
.fl-sec > summary .mv { color:var(--pick); font-size:11px; }
.fl-sec.off > summary .nm { color:var(--dim); }
.fl-sec .doc { color:var(--dim); padding:0 10px 4px 24px; }
.fl-grp { color:var(--fg); padding:4px 10px 1px 24px; font-size:11px; }
.fl-dial { display:grid; grid-template-columns:112px 1fr 46px 12px; gap:4px; align-items:center; padding:1px 10px 1px 24px; }
.fl-dial.in { padding-left:34px; grid-template-columns:102px 1fr 46px 12px; }
.fl-dial .lb { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fl-dial.moved .lb { color:var(--fg); }
.fl-dial input[type=range] { width:100%; min-width:0; margin:0; accent-color:var(--pick); }
.fl-dial input[type=number] { width:46px; box-sizing:border-box; font:inherit; font-size:11px; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; padding:0 2px; }
.fl-dial .rs { cursor:pointer; color:var(--pick); visibility:hidden; border:0; background:none; padding:0; font:inherit; }
.fl-dial.moved .rs { visibility:visible; }
.fl-dial select { font:inherit; font-size:11px; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; grid-column:2 / 4; min-width:0; }
.fl-sec .pad { height:5px; }
`;

export interface Section {
  key: string;
  title: string;
  doc: string;
  /** A behaviour's section has a switch. */
  behaviour?: Behaviour;
  dials: Dial[];
}

const fmt = (v: number, step: number) => (step >= 1 ? String(Math.round(v)) : String(+v.toFixed(Math.min(4, Math.max(0, -Math.floor(Math.log10(step)))))));

const DialRow = ({ d, value, set }: { d: Dial; value: number; set: (key: string, v: number | undefined) => void }) => {
  const moved = value !== d.value;
  const title = `${d.doc} (${d.key}; starts at ${d.choices ? d.choices[d.value] : d.value})`;
  return html`
    <div class=${`fl-dial${moved ? " moved" : ""}${d.group ? " in" : ""}`} title=${title}>
      <span class="lb">${d.label}</span>
      ${d.choices
        ? html`<select aria-label=${d.label} value=${String(value)} onChange=${(e: Event) => set(d.key, Number((e.target as HTMLSelectElement).value))}>
            ${d.choices.map((c, i) => html`<option value=${String(d.min + i * d.step)}>${c}</option>`)}
          </select>`
        : html`
            <input type="range" aria-label=${d.label} min=${d.min} max=${d.max} step=${d.step} value=${value} onInput=${(e: Event) => set(d.key, Number((e.target as HTMLInputElement).value))} />
            <input type="number" aria-label=${`${d.label} value`} min=${d.min} max=${d.max} step=${d.step} value=${fmt(value, d.step)} onChange=${(e: Event) => {
              const v = Number((e.target as HTMLInputElement).value);
              if (Number.isFinite(v)) set(d.key, v);
            }} />
          `}
      <button class="rs" title="Back to where it started" aria-label=${`Reset ${d.label}`} onClick=${() => set(d.key, undefined)}>↺</button>
    </div>
  `;
};

const RunLine = ({ stats, found }: { stats: () => Stats | undefined; found: number | null }) => {
  const [s, setS] = useState(stats());
  useEffect(() => {
    const t = setInterval(() => setS(stats()), 250);
    return () => clearInterval(t);
  }, []);
  if (!s) return html`<div class="fl-run"><span>state</span><span>starting…</span></div>`;
  return html`
    <div class="fl-run">
      <span>state</span><b class=${`st-${s.state}`}>${s.state}</b>
      <span>drawn</span><span><b>${s.n}</b> items · ${s.m} links</span>
      ${found !== null && html`<span>found</span><span><b>${found}</b> lit by the find line</span>`}
      <span>step</span><span><b>${s.steps}</b> · ${s.ms.toFixed(1)} ms each</span>
      <span>warmth</span><span>${s.alpha.toFixed(3)}</span>
      ${s.moved !== undefined && html`<span>moves</span><span title="How far particles moved in the last step, on average, and the mean push left on one">${s.moved.toFixed(3)} a step · push ${(s.push ?? 0).toFixed(3)}</span>`}
      ${s.settledIn && html`<span>last settle</span><span>${s.settledIn.steps} steps in ${(s.settledIn.ms / 1000).toFixed(1)} s</span>`}
    </div>
  `;
};

export function Panel({ sections, S, set, reset, stats, reseed, fit, found }: {
  sections: Section[];
  S: Settings;
  set: (key: string, v: number | undefined) => void;
  reset: () => void;
  stats: () => Stats | undefined;
  reseed: () => void;
  fit: () => void;
  found: number | null;
}) {
  return html`
    <div class="fl-panel">
      <div class="fl-acts">
        <button onClick=${reseed} title="Start every particle from its seed again and settle">Settle again</button>
        <button onClick=${fit} title="Fit the picture to the view (also: double-click the sea)">Fit</button>
        <button onClick=${reset} title="Every dial back to where it started">Reset dials</button>
      </div>
      ${sections.map((sec) => {
        const b = sec.behaviour;
        const onKey = b ? `on_${b.name}` : "";
        const on = b ? (S[onKey] ?? (b.on ? 1 : 0)) > 0 : true;
        const moved = sec.dials.filter((d) => (S[d.key] ?? d.value) !== d.value).length;
        let group: string | undefined;
        return html`
          <details key=${sec.key} class=${`fl-sec${on ? "" : " off"}`}>
            <summary title=${sec.doc}>
              ${b && html`<input type="checkbox" checked=${on} aria-label=${`${b.name} on`} title=${`Turn ${b.name} ${on ? "off" : "on"}`} onClick=${(e: Event) => e.stopPropagation()} onChange=${(e: Event) => set(onKey, (e.target as HTMLInputElement).checked ? 1 : 0)} />`}
              <span class="nm">${sec.title}</span>
              ${moved > 0 && html`<span class="mv" title="Dials changed from where they started">${moved} changed</span>`}
            </summary>
            <div class="doc">${sec.doc}</div>
            ${sec.dials.map((d) => {
              const head = d.group && d.group !== group ? html`<div class="fl-grp" key=${`g-${d.group}`}>${d.group}</div>` : null;
              group = d.group;
              return html`${head}<${DialRow} key=${d.key} d=${d} value=${S[d.key] ?? d.value} set=${set} />`;
            })}
            <div class="pad"></div>
          </details>
        `;
      })}
      <details class="fl-sec">
        <summary title="How the run is going: its state, what is drawn, steps, warmth, and how far it still moves"><span class="nm">state</span></summary>
        <${RunLine} stats=${stats} found=${found} />
      </details>
    </div>
  `;
}
