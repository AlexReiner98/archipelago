/**
 * The operate plugin, page side: the look of a tool people work in, after
 * the Operate mode of Impeccable (github.com/pbakaus/impeccable, Apache-2.0;
 * its ideas, in this plugin's own words and code). Restrained colour, one
 * family, a tight fixed type scale, density with room between groups, every
 * control with all its states, motion only for state.
 *
 * Narrow first: it styles only what `config.scope` names (default `.gm`, the
 * Games page of plugins/game), by setting the style tokens of spec/style.ts
 * there and giving that page's own elements their states. Tokens cascade,
 * so nothing outside the scope changes, and unloading takes the sheet out:
 * the page is as the game plugin draws it again.
 */
import type { Context, Plugin } from "../../runtime/core.ts";

export interface OperateConfig {
  /** The element the look applies inside: a CSS class selector. Default `.gm` (Games). */
  scope?: string;
}

/** Only a class selector, so the sheet can't reach outside what it names. */
const SCOPE = /^\.[A-Za-z][\w-]*$/;

/**
 * The sheet for a scope. Every rule starts `body <scope>`: one step more
 * specific than the page's own rules, so it wins whatever order the sheets
 * load in. Colours are tokens, or tokens mixed: no colour of its own.
 */
export function operateSheet(scope = ".gm"): string {
  if (!SCOPE.test(scope)) throw new Error(`operate: scope must be one class selector, like .gm (was ${scope})`);
  const s = `body ${scope}`;
  // A second neutral layer, a hover and a selection tint: each made from the style's own colours.
  const layer = "color-mix(in srgb, var(--fg) 4%, var(--bg))";
  const hover = "color-mix(in srgb, var(--fg) 7%, transparent)";
  const press = "color-mix(in srgb, var(--fg) 12%, transparent)";
  const picked = "color-mix(in srgb, var(--pick) 14%, transparent)";
  const control = "calc(var(--text-s) * 2)";
  return `
${s} {
  --text-xs: 11px; --text-s: 13px; --text-m: 14px; --text-l: 17px;
  --space-1: 2px; --space-2: 4px; --space-3: 8px; --space-4: 12px; --space-5: 20px;
  --radius: 4px;
  font-family: var(--font); font-size: var(--text-s); line-height: 1.45;
  font-variant-numeric: tabular-nums;
  padding: 0; gap: 0;
  accent-color: var(--pick); caret-color: var(--pick);
  scrollbar-color: color-mix(in srgb, var(--dim) 45%, transparent) transparent;
}
${s} ::selection { background: color-mix(in srgb, var(--pick) 32%, transparent); }

${s} .gm-list { background: ${layer}; border-right: 1px solid var(--line); padding: var(--space-4) var(--space-3); overflow: auto; }
${s} .gm-list > div { padding: var(--space-2) var(--space-3); border-radius: var(--radius); color: var(--fg); }
${s} .gm-list > div:hover { background: ${hover}; color: var(--fg); }
${s} .gm-list > div.on { background: ${picked}; color: var(--pick); font-weight: var(--bold); }
${s} .gm-main { padding: var(--space-4) var(--space-5) var(--space-5); }

${s} .gm-main h2 { font-size: var(--text-l); font-weight: var(--bold); line-height: 1.25; margin: 0 0 var(--space-2); }
${s} .gm-main h2:hover { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }
${s} .gm-main > .gm-dim:first-of-type { margin-bottom: var(--space-4); }
${s} .gm-note { max-width: 72ch; }

${s} .gm-mx { margin: var(--space-4) 0 var(--space-3); }
${s} .gm-mx th, ${s} .gm-mx td { padding: var(--space-3) var(--space-4); border-color: var(--line); }
${s} .gm-mx th { background: ${layer}; color: var(--dim); font-weight: normal; }
${s} .gm-mx th.p { color: var(--fg); font-weight: var(--bold); }
${s} .gm-mx td.ne { outline: 2px solid var(--pick); outline-offset: -3px; background: ${picked}; }
${s} .gm-mx .br { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
${s} .gm-mx .dom { color: var(--dim); }
${s} .gm-key { margin-bottom: var(--space-4); }

${s} .gm-sum { max-width: 72ch; margin: 0 0 var(--space-4); padding-left: 1.1em; line-height: 1.5; }
${s} .gm-sum li { margin: var(--space-1) 0; }
${s} .gm-bar { gap: var(--space-3); align-items: center; margin: var(--space-3) 0; }

${s} .gm-btn, ${s} .gm-in, ${s} .gm-sel {
  height: ${control}; box-sizing: border-box; font: inherit; color: var(--control-fg);
  background: var(--control); border: 1px solid var(--control-line); border-radius: var(--radius);
  transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
}
${s} .gm-btn { padding: 0 var(--space-4); font-weight: var(--bold); cursor: pointer; }
${s} .gm-btn:hover { border-color: var(--dim); background: ${hover}; }
${s} .gm-btn:active { background: ${press}; }
${s} .gm-btn.on { border-color: var(--pick); color: var(--pick); background: ${picked}; }
${s} .gm-btn[disabled], ${s} .gm-in[disabled] { opacity: .5; cursor: not-allowed; }
${s} .gm-in, ${s} .gm-sel { padding: 0 var(--space-3); }
${s} .gm-in::placeholder { color: var(--dim); opacity: 1; }
${s} .gm-btn:focus-visible, ${s} .gm-in:focus-visible, ${s} .gm-sel:focus-visible, ${s} .gm-list > div:focus-visible {
  outline: 2px solid var(--pick); outline-offset: 2px;
}
${s} .gm-new { margin-bottom: var(--space-3); }

${s} .gm-edit { border-bottom: 0; text-decoration: underline dotted var(--dim); text-underline-offset: 3px; }
${s} .gm-edit:hover { text-decoration-color: var(--pick); }
${s} .gm-chip { background: ${layer}; padding: 0 var(--space-2); }
${s} .gm-err { color: var(--failed); }

${s} .gm-plain { margin-top: var(--space-5); padding-top: var(--space-4); }
${s} .gm-h { text-transform: none; letter-spacing: 0; font-size: var(--text-m); font-weight: var(--bold); color: var(--fg); margin-bottom: var(--space-3); }
${s} .gm-pt { font-size: var(--text-m); }
${s} .gm-plain p { max-width: 72ch; line-height: 1.55; margin: var(--space-2) 0 var(--space-3); }

@media (max-width: 40rem) {
  ${s} .gm-list { border-right: 0; border-bottom: 1px solid var(--line); }
  ${s} .gm-main { padding: var(--space-4) var(--space-3); }
}
@media (prefers-reduced-motion: reduce) {
  ${s} .gm-btn, ${s} .gm-in, ${s} .gm-sel { transition: none; }
}
`;
}

const operate: Plugin<OperateConfig> = {
  id: "operate",
  about: "The look of a tool people work in (after Impeccable's Operate mode), on the Games page first.",
  apply(ctx: Context, config: OperateConfig = {}) {
    const css = operateSheet(config.scope);
    ctx.effect(() => {
      const style = document.createElement("style");
      style.dataset.plugin = "operate";
      style.textContent = css;
      document.head.append(style);
      return () => style.remove();
    });
  },
};

export default operate;
