/**
 * Tabs: fills the region `top` with the page's name and a tab for each fill
 * in `center`, by its title. A tab sets `here.view`, and the URL's hash
 * follows it (`#map`, or `#pack/name` when a pack has two), so a link opens
 * a view.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { FillInfo, SlotFill, SlotRead } from "../../spec/slot.ts";
import { fillKey } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";

// htm ships CommonJS types; in the page its module export is the function itself.
const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = sheet(`
.tb-name { padding-bottom:var(--space-3); color:var(--dim); }
.tb-name b { color:var(--fg); font-weight:var(--bold); }
.tb-tabs { display:flex; gap:var(--space-5); }
.tb-tab { color:var(--dim); text-decoration:none; padding-bottom:var(--space-2); border-bottom:2px solid transparent; }
.tb-tab:hover { color:var(--fg); }
.tb-tab.on { color:var(--fg); border-bottom-color:var(--pick); }
`);

const tabs: Pack = {
  id: "tabs",
  about: "The page's name and the tabs between views.",
  inject: ["slot.fill", "slot.read", "here.read", "here.set"],
  apply(ctx: Context) {
    const read = ctx.get<SlotRead>("slot.read");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");

    /** A view's hash: its pack alone when that pack has one view in center. */
    const hashOf = (f: FillInfo & { name: string }) => (read.fills("center").filter((g) => g.pack === f.pack).length > 1 ? fillKey(f) : f.pack);
    /** Whether the view the page opened with is found yet; until then the hash is left alone. */
    let found = location.hash.length < 2;
    /** Shows the view the hash names, if it is in center. */
    const fromHash = () => {
      const want = decodeURIComponent(location.hash.slice(1));
      const f = want ? read.fills("center").find((g) => fillKey(g) === want || g.pack === want) : undefined;
      if (f) set.set(KEYS.view, fillKey(f));
      return !!f;
    };

    const Name = () => html`<span class="tb-name"><b>archipelago</b> next</span>`;
    const Tabs = () => {
      const [, tick] = useState(0);
      const [view, setView] = useState(here.get<string>(KEYS.view));
      useEffect(() => {
        const stop = read.watch("center", () => tick((x) => x + 1));
        const unhear = here.watch(KEYS.view, (c) => setView(c.value as string | undefined));
        return () => void (stop(), unhear());
      }, []);
      const views = read.fills("center");
      useEffect(() => {
        const f = views.find((g) => fillKey(g) === view);
        if (found && f && location.hash.slice(1) !== hashOf(f)) history.replaceState(null, "", `#${hashOf(f)}`);
      }, [view, views.length]);
      if (views.length < 2) return null;
      return html`<span class="tb-tabs">${views.map(
        (f) => html`<a key=${fillKey(f)} class=${`tb-tab${fillKey(f) === view ? " on" : ""}`} href=${`#${hashOf(f)}`}>${f.title ?? f.pack}</a>`,
      )}</span>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      addEventListener("hashchange", fromHash);
      return () => {
        style.remove();
        removeEventListener("hashchange", fromHash);
      };
    });
    // The view a link names may fill center after this pack loads: look again as center fills, until it is found.
    ctx.effect(() =>
      read.watch("center", () => {
        if (!found) found = fromHash();
      }),
    );
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "top", name: "name", view: Name });
    fill.fill({ slot: "top", name: "tabs", view: Tabs });
  },
};

export default tabs;
