/**
 * The field's panel: a section per behaviour, with its switch and every one
 * of its dials, then the start, the run and the drawing. Each dial says
 * what it does on hover and goes back to where it started with ↺. Above
 * them, how the run is going: particles, links, step, time per step,
 * crossings, and whether it settles, untangles or is settled.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { Behaviour, Dial } from "./behaviour.ts";
import type { Settings } from "./graph.ts";
import type { Stats } from "./engine.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const PANEL_STYLE = `
.fl-panel { width:270px; flex:none; border-right:1px solid var(--line); overflow:auto; font-size:12px; background:var(--bg); }
.fl-run { padding:6px 10px; border-bottom:1px solid var(--line); color:var(--dim); font-variant-numeric:tabular-nums; display:grid; grid-template-columns:auto 1fr; column-gap:8px; }
.fl-run b { color:var(--fg); font-weight:600; }
.fl-run .st-settling { color:var(--pick); } .fl-run .st-untangling { color:var(--pick); } .fl-run .st-settled { color:var(--held); }
.fl-acts { display:flex; gap:6px; padding:6px 10px; border-bottom:1px solid var(--line); }
.fl-acts button { font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; padding:1px 6px; cursor:pointer; }
.fl-sec { border-bottom:1px solid var(--line); }
.fl-sec > summary { padding:5px 10px; cursor:pointer; display:flex; gap:6px; align-items:center; list-style:none; }
.fl-sec > summary::-webkit-details-marker { display:none; }
.fl-sec > summary .nm { font-weight:600; }
.fl-sec > summary .doc { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
.fl-sec.off > summary .nm { color:var(--dim); text-decoration:line-through; }
.fl-dial { display:grid; grid-template-columns:96px 1fr 44px 14px; gap:4px; align-items:center; padding:1px 10px 1px 18px; }
.fl-dial .lb { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fl-dial.moved .lb { color:var(--fg); }
.fl-dial input[type=range] { width:100%; margin:0; accent-color:var(--pick); }
.fl-dial input[type=number] { width:44px; font:inherit; font-size:11px; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; padding:0 2px; }
.fl-dial .rs { cursor:pointer; color:var(--dim); visibility:hidden; }
.fl-dial.moved .rs { visibility:visible; }
.fl-dial select { font:inherit; font-size:11px; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; grid-column:2 / 4; }
.fl-sec .pad { height:4px; }
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
    <div class=${`fl-dial${moved ? " moved" : ""}`} title=${title}>
      <span class="lb">${d.label}</span>
      ${d.choices
        ? html`<select value=${String(value)} onChange=${(e: Event) => set(d.key, Number((e.target as HTMLSelectElement).value))}>
            ${d.choices.map((c, i) => html`<option value=${String(d.min + i * d.step)}>${c}</option>`)}
          </select>`
        : html`
            <input type="range" min=${d.min} max=${d.max} step=${d.step} value=${value} onInput=${(e: Event) => set(d.key, Number((e.target as HTMLInputElement).value))} />
            <input type="number" min=${d.min} max=${d.max} step=${d.step} value=${fmt(value, d.step)} onChange=${(e: Event) => {
              const v = Number((e.target as HTMLInputElement).value);
              if (Number.isFinite(v)) set(d.key, v);
            }} />
          `}
      <span class="rs" title="Back to where it started" onClick=${() => set(d.key, undefined)}>↺</span>
    </div>
  `;
};

const RunLine = ({ stats }: { stats: () => Stats | undefined }) => {
  const [s, setS] = useState(stats());
  useEffect(() => {
    const t = setInterval(() => setS(stats()), 250);
    return () => clearInterval(t);
  }, []);
  if (!s) return html`<div class="fl-run">…</div>`;
  return html`
    <div class="fl-run">
      <span>state</span><b class=${`st-${s.state}`}>${s.state}</b>
      <span>drawn</span><span><b>${s.n}</b> particles · ${s.m} links</span>
      <span>step</span><span><b>${s.steps}</b> · ${s.ms.toFixed(1)} ms each · warmth ${s.alpha.toFixed(3)}</span>
      <span>crossings</span><b>${s.crossings}</b>
      ${s.settledIn && html`<span>last settle</span><span>${s.settledIn.steps} steps in ${(s.settledIn.ms / 1000).toFixed(1)} s</span>`}
    </div>
  `;
};

export function Panel({ sections, S, set, reset, stats, reseed, fit }: {
  sections: Section[];
  S: Settings;
  set: (key: string, v: number | undefined) => void;
  reset: () => void;
  stats: () => Stats | undefined;
  reseed: () => void;
  fit: () => void;
}) {
  return html`
    <div class="fl-panel">
      <${RunLine} stats=${stats} />
      <div class="fl-acts">
        <button onClick=${reseed} title="Start every particle from its seed again and settle">Settle again</button>
        <button onClick=${fit} title="Fit the picture to the view (also: double-click the sea)">Fit</button>
        <button onClick=${reset} title="Every dial back to where it started">Reset dials</button>
      </div>
      ${sections.map((sec) => {
        const b = sec.behaviour;
        const onKey = b ? `on_${b.name}` : "";
        const on = b ? (S[onKey] ?? (b.on ? 1 : 0)) > 0 : true;
        return html`
          <details key=${sec.key} class=${`fl-sec${on ? "" : " off"}`} open=${on && !!b}>
            <summary title=${sec.doc}>
              ${b && html`<input type="checkbox" checked=${on} title=${`Turn ${b.name} ${on ? "off" : "on"}`} onClick=${(e: Event) => e.stopPropagation()} onChange=${(e: Event) => set(onKey, (e.target as HTMLInputElement).checked ? 1 : 0)} />`}
              <span class="nm">${sec.title}</span>
              <span class="doc">${sec.doc}</span>
            </summary>
            ${sec.dials.map((d) => html`<${DialRow} key=${d.key} d=${d} value=${S[d.key] ?? d.value} set=${set} />`)}
            <div class="pad"></div>
          </details>
        `;
      })}
    </div>
  `;
}
