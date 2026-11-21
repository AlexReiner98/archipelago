/**
 * The views pack, page side: the view picker, in place of tabs. It lists
 * the views (pick.ts) from the fills in center and the `view` items in the
 * page's copy of the map, shows one (apply.ts), and draws:
 *
 * - in `top`: the page's name and one picker, the view shown, which opens
 *   the list. No tabs: the bar stays the same however many views there are;
 * - in `over`: the list, sections by part_of, typed to filter; Enter picks
 *   the first, Esc closes.
 *
 * Ctrl+K is the command line's (the command pack): the views are offered
 * there through `find.offer`, so one key goes to a view or an item.
 *
 * The URL's hash names the view shown, so a link opens it. Home opens when
 * the hash names none. When something else sets `here.view` (an agent, a
 * link in a panel), the view of that kind shows.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { Id } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotArrange, SlotFill, SlotRead } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { FindIndex, FindOffer } from "../find/index.ts";
import { SHOWN, shower } from "./apply.ts";
import { byHash, search, sections, TYPE, views, type Config, type View } from "./pick.ts";

// htm ships CommonJS types; in the page its module export is the function itself.
const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = sheet(`
.vw-name { padding-bottom:var(--space-3); color:var(--dim); }
.vw-name b { color:var(--fg); font-weight:var(--bold); }
.vw-pick { display:flex; align-items:baseline; gap:var(--space-2); padding:0 0 var(--space-3); background:none; border:0; font:inherit; color:var(--fg); cursor:pointer; }
.vw-pick .c { color:var(--dim); }
.vw-pick:hover .c { color:var(--fg); }
.vw-pick kbd { font:var(--text-xs)/1 var(--mono); color:var(--dim); border:1px solid var(--line); border-radius:var(--radius); padding:1px 3px; margin-left:var(--space-2); }
.vw-veil { position:fixed; inset:0; display:flex; justify-content:center; align-items:flex-start; padding-top:12vh; background:color-mix(in srgb, var(--bg) 40%, transparent); }
.vw-list { width:min(420px, calc(100vw - 32px)); max-height:60vh; display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); box-shadow:0 8px 28px rgba(0,0,0,.25); }
.vw-list input { font:inherit; background:var(--control); color:var(--fg); border:0; border-bottom:1px solid var(--line); padding:var(--space-3) var(--space-4); outline:none; border-radius:var(--radius) var(--radius) 0 0; }
.vw-rows { overflow:auto; padding:var(--space-2) 0; }
.vw-sec { padding:var(--space-3) var(--space-4) var(--space-1); color:var(--dim); font-size:var(--text-s); }
.vw-row { display:flex; gap:var(--space-3); align-items:baseline; padding:var(--space-2) var(--space-4); cursor:pointer; }
.vw-row:hover, .vw-row.at { background:color-mix(in srgb, var(--pick) 14%, transparent); }
.vw-row .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vw-row .k { color:var(--dim); font-size:var(--text-s); }
.vw-row.on .t { color:var(--pick); }
.vw-none { padding:var(--space-3) var(--space-4); color:var(--dim); }
`);

const views_: Pack<Config> = {
  id: "views",
  about: "Views: pick one, and the whole page changes to it. Home opens first.",
  inject: ["slot.fill", "slot.read", "slot.arrange", "here.declare", "here.read", "here.set", "find.index", "find.offer"],
  apply(ctx: Context, config: Config = {}) {
    const read = ctx.get<SlotRead>("slot.read");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const index = ctx.get<FindIndex>("find.index");
    ctx.get<HereDeclare>("here.declare").declare({ key: SHOWN, scope: "page", doc: "The view shown: a view item's id, or a kind's (map, field)." });
    const show = shower(here, set, ctx.get<SlotArrange>("slot.arrange"), (err) => ctx.runtime.report(ctx.fiber, err));
    ctx.effect(() => () => show.stop());

    const parent = (id: Id) => {
      const up = index.linksOf(id).find((l) => l.type === "part_of" && l.from === id);
      const row = up && index.item(up.to);
      return row ? { id: row.id, title: String(row.fields.title ?? row.id) } : undefined;
    };
    const list = (): View[] => views(read.fills("center"), index.ready() ? index.run(`type:${TYPE}`, 200).items : [], parent, config);

    // Listeners: a list that changes, and the list's open state.
    const heard = new Set<() => void>();
    const tell = () => heard.forEach((on) => on());
    let open = false;
    const setOpen = (v: boolean) => {
      open = v;
      tell();
    };

    /** Whether the view the page opened with has been settled: until then, here.view from the frame is not a pick. */
    let settled = false;
    /** Home was shown because nothing was picked: while so, home follows the list as packs and items arrive. */
    let auto = false;
    const pick = (v: View, chosen = true) => {
      auto = !chosen;
      show.show(v);
      if (location.hash.slice(1) !== v.id) history.replaceState(null, "", `#${v.id}`);
      tell();
    };
    /** Looks again at what there is: the view the hash names, the one shown, else home. */
    const follow = () => {
      const all = list();
      if (!all.length) return;
      const hashed = byHash(all, location.hash);
      if (!settled) {
        // The hash may name an item the map hasn't loaded yet: wait for it, but not past the first read.
        if (hashed) settled = true;
        else if (location.hash.length < 2 || index.ready()) settled = true;
        else return;
        if (hashed) pick(hashed);
        else pick(all.find((v) => v.home)!, false);
        return;
      }
      const now = show.shown();
      const fresh = now && all.find((v) => v.id === now.id);
      const home = all.find((v) => v.home)!;
      if (!fresh || (auto && home.id !== now?.id)) pick(home, false);
      else if (JSON.stringify(fresh) !== JSON.stringify(now)) pick(fresh, !auto); // an agent changed it
      else tell();
    };
    const fromHash = () => {
      const v = byHash(list(), location.hash);
      if (v && v.id !== show.shown()?.id) pick(v);
    };
    ctx.effect(() => read.watch("center", follow) as () => void);
    ctx.effect(() => index.watch(follow) as () => void);
    // Something else set here.view: show its kind, unless it is the shown view's own center.
    ctx.effect(
      () =>
        here.watch(KEYS.view, (c) => {
          if (!settled || typeof c.value !== "string" || c.value === show.shown()?.center) return;
          const kind = list().find((v) => v.kind && v.center === c.value);
          if (kind) pick(kind);
        }) as () => void,
    );

    const useList = () => {
      const [, tick] = useState(0);
      useEffect(() => {
        const on = () => tick((x) => x + 1);
        heard.add(on);
        return () => void heard.delete(on);
      }, []);
      return list();
    };

    const Name = () => html`<span class="vw-name"><b>archipelago</b> next</span>`;

    /** The one control in the bar: the view shown, opening the list. */
    const Picker = () => {
      useList();
      const now = show.shown();
      return html`<button class="vw-pick" onClick=${() => setOpen(!open)} title="Every view, by section">
        <span>${now?.title ?? "Views"}</span><span class="c">▾</span>
      </button>`;
    };

    const List = () => {
      const all = useList();
      const [q, setQ] = useState("");
      const [at, setAt] = useState(0);
      const input = useRef<HTMLInputElement>(null);
      useEffect(() => {
        if (open) {
          setQ("");
          setAt(0);
          setTimeout(() => input.current?.focus());
        }
      }, [open]);
      if (!open) return null;
      const found = search(all, q);
      const now = show.shown();
      const choose = (v: View | undefined) => {
        if (v) pick(v);
        setOpen(false);
      };
      const key = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
        else if (e.key === "Enter") choose(found[at]);
        else if (e.key === "ArrowDown") (e.preventDefault(), setAt(Math.min(at + 1, found.length - 1)));
        else if (e.key === "ArrowUp") (e.preventDefault(), setAt(Math.max(at - 1, 0)));
      };
      let n = 0;
      return html`<div class="vw-veil" onClick=${(e: Event) => e.target === e.currentTarget && setOpen(false)}>
        <div class="vw-list" role="dialog" aria-label="Views">
          <input ref=${input} value=${q} placeholder="find a view" onInput=${(e: Event) => (setQ((e.target as HTMLInputElement).value), setAt(0))} onKeyDown=${key} />
          <div class="vw-rows">
            ${found.length === 0 && html`<div class="vw-none">No view holds those words.</div>`}
            ${sections(found).map(
              (s) => html`<div key=${s.title || "-"}>
                ${s.title && html`<div class="vw-sec">${s.title}</div>`}
                ${s.views.map((v) => {
                  const i = n++;
                  return html`<div key=${v.id} class=${`vw-row${i === at ? " at" : ""}${v.id === now?.id ? " on" : ""}`} onMouseEnter=${() => setAt(i)} onClick=${() => choose(v)}>
                    <span class="t">${v.title}</span><span class="k">${v.home ? "home" : v.pinned ? "pinned" : ""}</span>
                  </div>`;
                })}
              </div>`,
            )}
          </div>
        </div>
      </div>`;
    };

    // Ctrl+K is the command line's: the views are offered there, beside the items.
    ctx.get<FindOffer>("find.offer").offer({
      of: "view",
      list: (words, limit) =>
        (words.length ? search(list(), words.join(" ")) : list()).slice(0, limit).map((v) => ({
          key: `view:${v.id}`,
          title: v.title,
          hint: v.home ? "home" : v.section?.title,
          run: () => pick(v),
        })),
    });
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
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "top", name: "name", view: Name });
    fill.fill({ slot: "top", name: "picker", view: Picker });
    fill.fill({ slot: "over", name: "list", view: List });
    follow();
  },
};

export default views_;
