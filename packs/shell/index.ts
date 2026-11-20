/**
 * The shell pack, minimal: fills `root` with a page that has one header
 * line and one slot, `shell.main`, where views go side by side. Its styles
 * (the page's colours, light and dark) are its effect and go with it.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";

// htm ships CommonJS types; in the page its module export is the function itself.
const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = `
:root { --bg:#fbfbfa; --fg:#1d1d1b; --dim:#77756f; --line:#e4e2dc; --lit:#fff3c4; --pick:#2f6fdf; --held:#1f8a4c; --failed:#c8322d; --quiet:#9a978f; --panel:#fff; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --fg:#e8e6e1; --dim:#8d8a83; --line:#2c2b29; --lit:#4a3f12; --pick:#6c9cf2; --held:#4cc27e; --failed:#ef6b63; --quiet:#77746d; --panel:#1c1c1a; } }
html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:13px/1.45 ui-sans-serif, system-ui, sans-serif; }
#app { height:100%; }
.shell { display:flex; flex-direction:column; height:100%; }
.shell-head { padding:6px 12px; border-bottom:1px solid var(--line); color:var(--dim); white-space:nowrap; }
.shell-head b { color:var(--fg); font-weight:600; }
.shell-main { flex:1; min-height:0; display:flex; }
.shell-main > * { flex:1; min-width:0; }
`;

const shell: Pack = {
  id: "shell",
  inject: ["slot.declare", "slot.fill", "slot.read"],
  apply(ctx: Context) {
    const read = ctx.get<SlotRead>("slot.read");

    const Slot = ({ name }: { name: string }) => {
      const [, tick] = useState(0);
      useEffect(() => {
        const stop = read.watch(name, () => tick((x) => x + 1));
        tick((x) => x + 1); // a fill that came before this effect ran
        return stop as () => void;
      }, [name]);
      return html`${read.fills(name).map((f) => html`<${f.view} key=${`${f.pack}/${f.name}`} />`)}`;
    };

    const Shell = () => html`
      <div class="shell">
        <div class="shell-head"><b>archipelago</b> next</div>
        <div class="shell-main"><${Slot} name="shell.main" /></div>
      </div>
    `;

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
