/**
 * The beam picked: its own diameter (a slider; for several beams picked,
 * all of them at once), and for one beam what it rests on and what rests
 * on it, at which node, with each contact's gap and whether it closes a
 * fan's cycle; its DAG level. A beam named in the list picks it.
 */
import { h } from "preact";
import htm from "htm";
import type { Settings } from "../field/graph.ts";
import type { RG } from "./beams.ts";
import type { Measure } from "./pipeline.ts";
import { diameterKey } from "./pipeline.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const BEAM_STYLE = `
.rf-beam { padding:var(--space-3) var(--space-4); border-bottom:1px solid var(--line); display:flex; flex-direction:column; gap:var(--space-2); }
.rf-beam .hint { color:var(--dim); }
.rf-beam .hd { display:flex; justify-content:space-between; align-items:baseline; }
.rf-beam .hd b { font-weight:600; }
.rf-beam .hd span { color:var(--dim); font-size:var(--text-s); }
.rf-beam .dia { display:grid; grid-template-columns:auto 1fr 52px auto; gap:var(--space-3); align-items:center; }
.rf-beam .dia input[type=range] { width:100%; min-width:0; accent-color:var(--pick); }
.rf-beam .dia input[type=number] { width:52px; box-sizing:border-box; font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:var(--radius); padding:0 2px; }
.rf-beam button { font:inherit; font-size:var(--text-s); background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:var(--radius); padding:0 6px; cursor:pointer; }
.rf-beam button:hover { border-color:var(--dim); }
.rf-beam .ct { display:grid; grid-template-columns:auto auto 1fr; column-gap:var(--space-3); font-size:var(--text-s); font-variant-numeric:tabular-nums; }
.rf-beam .ct a { color:var(--pick); cursor:pointer; }
.rf-beam .ok { color:var(--held); } .rf-beam .off { color:var(--failed); }
.rf-beam .dim { color:var(--dim); }
`;

export function Beam({ g, mz, picked, S, pick, setDiameter, ownCount, clear }: {
  g: RG | null;
  mz: Measure | null;
  picked: number[];
  S: Settings;
  pick: (beams: number[]) => void;
  setDiameter: (beams: number[], d: number | undefined) => void;
  ownCount: number;
  clear: () => void;
}) {
  const clearAll = ownCount > 0 && html`<div><button onClick=${clear} title="Every beam back to the default diameter">Clear ${ownCount} own diameter${ownCount === 1 ? "" : "s"}</button></div>`;
  const beams = g ? picked.filter((b) => b < g.m) : [];
  if (!g || !beams.length) return html`<div class="rf-beam"><div class="hint">Click a beam to tune its diameter; shift-click for more than one.</div>${clearAll}</div>`;
  const first = beams[0]!;
  const d = S[diameterKey(first)] ?? S.diameter!;
  const own = beams.some((b) => S[diameterKey(b)] !== undefined);
  const set = (v: number) => Number.isFinite(v) && v > 0 && setDiameter(beams, v);
  const rests = g.rf.rests;
  const rows = beams.length === 1
    ? rests.contacts.flatMap((c, k) => {
        if (c.over !== first && c.under !== first) return [];
        const other = c.over === first ? c.under : c.over;
        const gap = mz?.gap[k] ?? 0, ok = Math.abs(gap) < 0.1 * 2 * g.rf.r[first]!;
        return [html`<span key=${`a${k}`}>${c.over === first ? "rests on" : "carries"}</span>
          <a key=${`b${k}`} onClick=${() => pick([other])} title="Pick this beam">beam ${other}</a>
          <span key=${`c${k}`}>node ${c.node} · <span class=${ok ? "ok" : "off"}>gap ${gap.toFixed(2)} cm</span>${c.closing ? html` · <span class="dim" title="This contact closes its fan's cycle: the DAG leaves it to the pushes, not the sweep">closing</span>` : ""}</span>`];
      })
    : [];
  return html`
    <div class="rf-beam">
      <div class="hd">
        <b>${beams.length === 1 ? `Beam ${first}` : `${beams.length} beams`}</b>
        <span>${beams.length === 1 ? `DAG level ${rests.level[first]} · ${g.fixed[2 * first] || g.fixed[2 * first + 1] ? "on a support" : "free"}` : beams.join(", ")}</span>
      </div>
      <div class="dia" title="This beam's own diameter, in cm: only the radii rule runs again, and the solve warms from where it is">
        <span>⌀</span>
        <input type="range" aria-label="diameter" min="2" max="40" step="0.5" value=${d} onInput=${(e: Event) => set(Number((e.target as HTMLInputElement).value))} />
        <input type="number" aria-label="diameter in cm" min="2" max="40" step="0.5" value=${d} onChange=${(e: Event) => set(Number((e.target as HTMLInputElement).value))} />
        <button disabled=${!own} onClick=${() => setDiameter(beams, undefined)} title="Back to the default diameter">↺</button>
      </div>
      ${rows.length > 0 && html`<div class="ct">${rows}</div>`}
      ${clearAll}
    </div>
  `;
}
