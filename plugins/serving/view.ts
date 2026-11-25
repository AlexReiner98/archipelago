/**
 * The serving plugin, page side: one quiet line in the header, `map ·
 * commit · checkout`, so two servers never look the same (index.ts). The
 * checkout is its folder's name; the whole path and the port are in the
 * title. A server without a map name shows its port in the map's place.
 * Nothing while the server's plugin is not loaded.
 *
 * Asks `serving.about` once. Injects action.invoke and slot.fill. Writes nothing.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { About } from "./index.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const ABOUT = "serving.about";

/** The header's words and title, or nothing to show. */
export function lineOf(a: About | undefined): { text: string; title: string } | undefined {
  if (!a || (!a.map && !a.commit && !a.checkout && !a.port)) return undefined;
  const folder = a.checkout?.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const map = a.map ?? (a.port ? `:${a.port}` : undefined);
  const text = [map, a.commit, folder].filter(Boolean).join(" · ");
  const title = [
    a.map ? `Map ${a.map}` : "A map with no name",
    a.port ? `on port ${a.port}` : "",
    a.commit ? `\nCommit ${a.commit.replace(/\+$/, "")}${a.commit.endsWith("+") ? ", with changes not committed" : ""}` : "",
    a.checkout ? `\nCode from ${a.checkout}` : "",
  ].join(" ").replace(/ \n/g, "\n").trim();
  return { text, title };
}

const STYLE = sheet(`
.sv-line { color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:28em; }
`);

const servingView: Plugin = {
  id: "serving",
  about: "Shows which map, commit and checkout the page is talking to.",
  inject: ["action.invoke", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    let asked: Promise<About | undefined> | undefined;
    const ask = () =>
      (asked ??= invoke
        .invoke({ action: ABOUT, input: {}, authority: { of: "human", basis: "the header says which server this is" }, reason: "show which server" })
        .then((out) => (out.ok ? (out.output as About) : undefined))
        .catch(() => undefined));

    const Line = () => {
      const [about, setAbout] = useState<About | undefined>();
      useEffect(() => {
        let live = true;
        void ask().then((a) => live && setAbout(a));
        return () => {
          live = false;
        };
      }, []);
      const l = lineOf(about);
      return l ? html`<span class="sv-line" title=${l.title}>${l.text}</span>` : null;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "top", name: "serving", view: Line });
  },
};

export default servingView;
