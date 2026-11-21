/**
 * The command line, page side: Ctrl+K (⌘K) opens the find line in the
 * region `over`, from any view. Type a name and Enter jumps to the item;
 * a term goes into the line, and Enter with no item sets the query.
 * Escape, a click outside or Ctrl+K again closes it.
 *
 * - Declares `command.open` (page scope): whether it is open. The keys set
 *   it; so may anything else, an agent included.
 * - Draws `find.line` in its command form: the suggestions and the jump are
 *   find's.
 */
import { h } from "preact";
import htm from "htm";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { FindLine } from "../find/index.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const OPEN = "command.open";

/** Whether a key press opens or closes the command line: Ctrl+K, or ⌘K. */
export const isToggle = (e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }) =>
  e.key.toLowerCase() === "k" && (!!e.ctrlKey || !!e.metaKey) && !e.altKey && !e.shiftKey;

const STYLE = sheet(`
.cm { position:absolute; inset:0; background:color-mix(in srgb, var(--bg) 55%, transparent); display:flex; justify-content:center; align-items:flex-start; padding-top:14vh; }
.cm-box { width:min(640px, 92vw); background:var(--panel); border:1px solid var(--control-line); border-radius:var(--radius); padding:var(--space-4); box-shadow:0 10px 40px color-mix(in srgb, var(--fg) 22%, transparent); }
`);

const command: Pack = {
  id: "command",
  about: "Ctrl+K: the find line over the page, to jump to an item by name.",
  inject: ["find.line", "here.declare", "here.read", "here.set", "slot.fill"],
  apply(ctx: Context) {
    const line = ctx.get<FindLine>("find.line");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.get<HereDeclare>("here.declare").declare({ key: OPEN, scope: "page", value: { type: "boolean" }, doc: "Whether the command line is open." });

    const close = () => set.set(OPEN, undefined);
    ctx.effect(() => {
      const keys = (e: KeyboardEvent) => {
        if (!isToggle(e)) return;
        e.preventDefault();
        set.set(OPEN, here.get(OPEN) ? undefined : true);
      };
      addEventListener("keydown", keys);
      return () => removeEventListener("keydown", keys);
    });
    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });

    const Over = () => html`
      <div class="cm" onMouseDown=${(e: MouseEvent) => e.target === e.currentTarget && close()}>
        <div class="cm-box" title="↑↓ to move · Enter to jump · Esc to close">
          <${line.Line} command=${true} done=${close} />
        </div>
      </div>
    `;
    ctx.get<SlotFill>("slot.fill").fill({ slot: "over", name: "line", title: "Command line", when: { [OPEN]: true }, view: Over });
  },
};

export default command;
