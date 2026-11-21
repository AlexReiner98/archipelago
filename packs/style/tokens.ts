/**
 * The style's tokens as data: colours for light and dark, type, space and
 * marks (spec/style.md). `css()` writes them as custom properties on the
 * page's root; nothing else here touches the page, so Node can read them.
 */
import { glyph, SHAPES, SIDES, verdictGlyph, type Token } from "../../spec/style.ts";

export type Tokens = Partial<Record<Token, string>>;

/** Colours by day. A token not named in `DARK` is the same by night. */
export const LIGHT: Tokens = {
  bg: "#fbfbfa",
  fg: "#1d1d1b",
  dim: "#77756f",
  line: "#e4e2dc",
  panel: "#ffffff",
  lit: "#fff3c4",
  pick: "#2f6fdf",
  held: "#1f8a4c",
  failed: "#c8322d",
  quiet: "#9a978f",
  say: "#2f6fe4",
  write: "#e8912d",
  fire: "#3fb27f",
  owner: "#b06ee8",
  learned: "#d99a2b",
  schema: "#8c9bb0",
  "hue-1": "#5aa9e6",
  "hue-2": "#e07a5f",
  "hue-3": "#81b29a",
  "hue-4": "#e3b65f",
  "hue-5": "#9d79bc",
  "hue-6": "#4ecdc4",
};

/**
 * Tokens made of others. A custom property resolves where it is set, so
 * these are set again wherever a scheme is, to follow it.
 */
export const DERIVED: Tokens = {
  "mark-fresh": "var(--dim)",
  "mark-moving": "var(--pick)",
  "mark-done": "var(--held)",
  "mark-gone": "var(--quiet)",
  control: "var(--panel)",
  "control-fg": "var(--fg)",
  "control-line": "var(--line)",
};

/** Colours by night. */
export const DARK: Tokens = {
  bg: "#151514",
  fg: "#e8e6e1",
  dim: "#8d8a83",
  line: "#2c2b29",
  panel: "#1c1c1a",
  lit: "#4a3f12",
  pick: "#6c9cf2",
  held: "#4cc27e",
  failed: "#ef6b63",
  quiet: "#77746d",
  say: "#6c9cf2",
  write: "#eda04a",
  fire: "#4cc27e",
  owner: "#c58af9",
  learned: "#e8b04a",
  schema: "#8c9bb0",
};

export const TYPE: Tokens = {
  font: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  "text-xs": "10px",
  "text-s": "11px",
  "text-m": "12px",
  text: "13px",
  "text-l": "15px",
  leading: "1.45",
  bold: "600",
};

export const SPACE: Tokens = {
  "space-1": "2px",
  "space-2": "4px",
  "space-3": "6px",
  "space-4": "10px",
  "space-5": "16px",
  radius: "3px",
  "frame-left": "260px",
  "frame-right": "360px",
};

/** Each shape at each side: hollow, half, full, and full again (a later closed status is told by its colour). */
const DRAWN: Record<(typeof SHAPES)[number], string[]> = {
  square: ["□", "◧", "■", "■"],
  diamond: ["◇", "◈", "◆", "◆"],
  circle: ["○", "◐", "●", "●"],
  triangle: ["△", "◭", "▲", "▲"],
};

export const MARKS: Tokens = {
  ...Object.fromEntries(SHAPES.flatMap((s) => SIDES.map((side, i) => [glyph(s, side), `"${DRAWN[s][i]}"`]))),
  [verdictGlyph("held")]: '"✓"',
  [verdictGlyph("failed")]: '"✕"',
  [verdictGlyph("quiet")]: '"○"',
  [verdictGlyph("none")]: '"·"',
};

const block = (t: Tokens) =>
  Object.entries(t)
    .map(([k, val]) => `--${k}:${val};`)
    .join(" ");

/**
 * The tokens as a style sheet: the root's properties, night's over them
 * when the system is dark, and either scheme on any element that asks for
 * it with `data-scheme`.
 */
export function css(): string {
  const day = block({ ...LIGHT, ...DERIVED });
  const night = block({ ...LIGHT, ...DARK, ...DERIVED });
  return [
    `:root { color-scheme:light dark; ${block({ ...TYPE, ...SPACE, ...MARKS })} ${day} }`,
    `@media (prefers-color-scheme: dark) { :root { ${night} } }`,
    `[data-scheme="light"] { color-scheme:light; ${day} }`,
    `[data-scheme="dark"] { color-scheme:dark; ${night} }`,
    "",
  ].join("\n");
}
