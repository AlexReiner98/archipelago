/**
 * The shell pack, minimal: fills `root` with a page that has one header
 * line and one slot, `shell.main`, where views go. One view shows at a
 * time; the header has a tab for each, and the URL's hash (the filling
 * pack's id) says which. It keeps no colours: its sheet refers to the
 * style tokens (spec/style.md), and goes with it.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";

// htm ships CommonJS types; in the page its module export is the function itself.
const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = sheet(`
html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:var(--text)/var(--leading) var(--font); }
#app { height:100%; }
.shell { display:flex; flex-direction:column; height:100%; }
.shell-head { display:flex; align-items:baseline; gap:var(--space-5); padding:var(--space-3) var(--space-4) 0; border-bottom:1px solid var(--line); color:var(--dim); white-space:nowrap; }
.shell-head .name { padding-bottom:var(--space-3); }
.shell-head b { color:var(--fg); font-weight:var(--bold); }
.shell-tab { color:var(--dim); text-decoration:none; padding-bottom:var(--space-2); border-bottom:2px solid transparent; }
.shell-tab:hover { color:var(--fg); }
.shell-tab.on { color:var(--fg); border-bottom-color:var(--pick); }
.shell-main { flex:1; min-height:0; display:flex; }
.shell-main > * { flex:1; min-width:0; }
`);

const shell: Pack = {
  id: "shell",
  about: "The page's frame: its header and the tabs between views.",
  inject: ["slot.declare", "slot.fill", "slot.read"],
  apply(ctx: Context) {
    const read = ctx.get<SlotRead>("slot.read");

    /** The views in `shell.main`, one shown at a time, picked by a tab; the pick is the URL's hash. */
    const Shell = () => {
      const [, tick] = useState(0);
      const [hash, setHash] = useState(location.hash.slice(1));
      useEffect(() => {
        const stop = read.watch("shell.main", () => tick((x) => x + 1));
        const onHash = () => setHash(location.hash.slice(1));
        addEventListener("hashchange", onHash);
        tick((x) => x + 1);
        return () => {
          void stop();
          removeEventListener("hashchange", onHash);
        };
      }, []);
      const views = read.fills("shell.main");
      const keyOf = (f: (typeof views)[number]) => f.pack;
      const shown = views.find((f) => keyOf(f) === hash) ?? views[0];
      return html`
        <div class="shell">
          <div class="shell-head">
            <span class="name"><b>archipelago</b> next</span>
            ${views.length > 1 &&
            views.map(
              (f) => html`<a key=${keyOf(f)} class=${`shell-tab${f === shown ? " on" : ""}`} href=${`#${keyOf(f)}`}>${f.title ?? f.pack}</a>`,
            )}
          </div>
          <div class="shell-main">${shown && html`<${shown.view} key=${`${shown.pack}/${shown.name}`} />`}</div>
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotDeclare>("slot.declare").declare({ name: "shell.main", merge: "many", doc: "The page's body: views side by side." });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "root", name: "shell", view: Shell });
  },
};

export default shell;
