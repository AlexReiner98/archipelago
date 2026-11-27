/**
 * The serving plugin, page side: one quiet line in the header, `map ·
 * commit · checkout`, so two servers never look the same (index.ts). The
 * checkout is its folder's name; the whole path and the port are in the
 * title. A server without a map name shows its port in the map's place.
 * Nothing while the server's plugin is not loaded.
 *
 * In the Plugins view (a fill of `docs.list`): "Plugin folders", each
 * folder the server loaded from outside this repository with its path,
 * where the list came from (--plugins, ARCHIPELAGO_PLUGINS, or remembered
 * by the map), and each named folder that didn't load, with why.
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

const FROM: Record<string, string> = {
  flag: "from --plugins, for this start",
  env: "from ARCHIPELAGO_PLUGINS, for this start",
  map: "remembered by the map (npm run map -- plugins)",
};

/** The Plugins view's section: its heading's words and its rows, or nothing when no folder is named. */
export function foldersOf(a: About | undefined): { said: string; rows: { name?: string; dir: string; why?: string }[] } | undefined {
  const f = a?.folders;
  if (!f || (!f.loaded.length && !f.missing.length)) return undefined;
  const n = f.loaded.length;
  const said = [`${n} loaded${f.from ? `, ${FROM[f.from] ?? f.from}` : ""}`, f.missing.length ? `${f.missing.length} not loaded` : ""].filter(Boolean).join("; ");
  return { said, rows: [...f.loaded.map((l) => ({ name: l.name, dir: l.dir })), ...f.missing.map((m) => ({ dir: m.dir, why: m.why }))] };
}

const STYLE = sheet(`
.sv-folders .sv-row { display:flex; gap:var(--space-2); align-items:baseline; padding:var(--space-1) 0; flex-wrap:wrap; }
.sv-folders .sv-name { font-weight:var(--bold); min-width:8em; }
.sv-folders .sv-dir { color:var(--dim); font-family:var(--mono, monospace); font-size:var(--text-s); overflow-wrap:anywhere; }
.sv-folders .sv-why { color:var(--failed); }
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
      const l = lineOf(useAbout());
      return l ? html`<span class="sv-line" title=${l.title}>${l.text}</span>` : null;
    };

    const useAbout = () => {
      const [about, setAbout] = useState<About | undefined>();
      useEffect(() => {
        let live = true;
        void ask().then((a) => live && setAbout(a));
        return () => {
          live = false;
        };
      }, []);
      return about;
    };
    const Folders = () => {
      const f = foldersOf(useAbout());
      if (!f) return null;
      return html`<section class="dk-list sv-folders">
        <h3>Plugin folders<span>${f.said}</span></h3>
        ${f.rows.map(
          (r) => html`<div class="sv-row" key=${r.dir} data-folder=${r.name ?? ""}>
            <span class=${r.why ? "sv-name sv-why" : "sv-name"}>${r.name ?? "not loaded"}</span>
            <span class="sv-dir">${r.dir}</span>
            ${r.why && html`<span class="sv-why">${r.why}</span>`}
          </div>`,
        )}
      </section>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "top", name: "serving", view: Line });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "docs.list", name: "plugin-folders", view: Folders });
  },
};

export default servingView;
