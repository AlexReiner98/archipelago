/**
 * The solve's rules drawn as their DAG: a box per rule, in rows by depth,
 * an arrow from each rule to every rule that needs it (one that skips a
 * row bends round the side). A box says what its rule made; it is lit when
 * the rule ran on the last change, and dashed when it is live (stepped
 * every frame). Its tooltip: what it makes, how often it has run, and how
 * long it took.
 */
import { h } from "preact";
import htm from "htm";
import { order } from "./rules.ts";
import { RULES } from "./pipeline.ts";
import type { Evaluation } from "./rules.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const RULES_STYLE = `
.rf-dag { display:block; width:100%; padding:var(--space-2) 0; }
.rf-dag rect { fill:var(--panel); stroke:var(--line); stroke-width:1; }
.rf-dag .live rect { stroke-dasharray:4 3; }
.rf-dag .ran rect { stroke:var(--pick); stroke-width:1.6; }
.rf-dag .nm { fill:var(--fg); font-size:11px; font-weight:600; }
.rf-dag .sm { fill:var(--dim); font-size:9.5px; }
.rf-dag path { fill:none; stroke:var(--dim); stroke-width:1; }
.rf-dag marker path { fill:var(--dim); stroke:none; }
`;

const W = 300, ROW = 46, BH = 34;

export function Rules({ ev }: { ev: Evaluation | undefined }) {
  const { depth } = order(RULES);
  const rows: string[][] = [];
  for (const r of RULES) (rows[depth[r.name]!] ??= []).push(r.name);
  const pos: Record<string, { x: number; y: number; w: number }> = {};
  rows.forEach((row, d) => {
    const w = row.length > 1 ? (W - 30) / row.length - 10 : 200;
    row.forEach((name, k) => (pos[name] = { x: row.length > 1 ? 15 + (k + 0.5) * ((W - 30) / row.length) : W / 2, y: 8 + d * ROW, w }));
  });
  const arrows = RULES.flatMap((r) =>
    r.needs.map((n) => {
      const a = pos[n]!, b = pos[r.name]!, y0 = a.y + BH, y1 = b.y - 2;
      if (depth[r.name]! - depth[n]! === 1) return html`<path key=${`${n}-${r.name}`} d=${`M${a.x},${y0} C${a.x},${y0 + 8} ${b.x},${y1 - 8} ${b.x},${y1}`} marker-end="url(#rf-arrow)" />`;
      // A skip bends round the side the rule it starts from is on.
      const side = a.x <= W / 2 ? 4 : W - 4;
      return html`<path key=${`${n}-${r.name}`} d=${`M${a.x - a.w / 2 + (side < W / 2 ? 0 : a.w)},${a.y + BH / 2} C${side},${a.y + BH / 2} ${side},${b.y + BH / 2} ${b.x - b.w / 2 + (side < W / 2 ? 0 : b.w) - (side < W / 2 ? 2 : -2)},${b.y + BH / 2}`} marker-end="url(#rf-arrow)" />`;
    }),
  );
  return html`
    <svg class="rf-dag" viewBox=${`0 0 ${W} ${rows.length * ROW + 6}`} role="img" aria-label="The solve's rules as a DAG">
      <defs><marker id="rf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
      ${arrows}
      ${RULES.map((r) => {
        const p = pos[r.name]!, ran = ev?.ran[r.name];
        const tip = `${r.doc}${r.live ? " Live: stepped every frame." : ""}\nNeeds: ${r.needs.join(", ") || "nothing"}. Dials: ${r.dials.join(", ") || "none"}.\nRun ${ran?.runs ?? 0} times${ran && !r.live ? `, last in ${ran.ms.toFixed(1)} ms` : ""}.`;
        return html`<g key=${r.name} class=${`${r.live ? "live" : ""} ${ran?.ran ? "ran" : ""}`}>
          <title>${tip}</title>
          <rect x=${p.x - p.w / 2} y=${p.y} width=${p.w} height=${BH} rx="3" />
          <text class="nm" x=${p.x} y=${p.y + 14} text-anchor="middle">${r.name}</text>
          <text class="sm" x=${p.x} y=${p.y + 27} text-anchor="middle">${(ran?.summary ?? "").slice(0, p.w / 5)}</text>
        </g>`;
      })}
    </svg>
  `;
}
