/**
 * The docs pack, page side: the Packs view, one card per loaded pack, read
 * only. The server's packs come through `docs.read` (the bridge), the
 * page's own are read from the page's runtime the same way (read.ts).
 *
 * A card is composable: its title line is the slot `docs.card.head` and its
 * body the slot `docs.card`, both `many`, each fill given `{ pack }` (a
 * PackDoc). This pack fills the body with what the reference says:
 * contracts, actions and their inputs, places, slots, config. Another pack
 * adds to a card by filling either slot (an on/off switch goes in the head).
 *
 * It invokes no action. Its styles go when it unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import htm from "htm";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { contractsOf, fieldsOf, matches, tally } from "./cards.ts";
import { KEY, type DocsRead } from "./index.ts";
import { digest, reference, type PackDoc } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const HEAD = "docs.card.head";
export const BODY = "docs.card";

const SHEET = `
.dk { height:100%; overflow:auto; padding:12px 16px 40px; box-sizing:border-box; }
.dk-bar { display:flex; gap:10px; align-items:center; margin-bottom:12px; color:var(--dim); flex-wrap:wrap; }
.dk-bar input { font:inherit; padding:4px 8px; border:1px solid var(--line); border-radius:4px; background:var(--panel); color:var(--fg); min-width:240px; }
.dk-bar button { font:inherit; border:1px solid var(--line); background:var(--panel); color:var(--dim); border-radius:4px; padding:3px 9px; cursor:pointer; }
.dk-bar button.on { color:var(--fg); border-color:var(--pick); }
.dk-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:12px; align-items:start; }
.dk-card { border:1px solid var(--line); border-radius:6px; background:var(--panel); padding:10px 12px; min-width:0; overflow:hidden; }
.dk-head { display:flex; align-items:baseline; gap:8px; }
.dk-head b { font-size:14px; }
.dk-head .dk-sp { flex:1; }
.dk-dot { width:8px; height:8px; border-radius:50%; display:inline-block; background:var(--quiet); align-self:center; }
.dk-dot.active { background:var(--held); }
.dk-dot.failed { background:var(--failed); }
.dk-side { color:var(--dim); font-size:11px; border:1px solid var(--line); border-radius:3px; padding:0 4px; }
.dk-tally { color:var(--dim); font-size:12px; margin:2px 0 6px; }
.dk-warn { color:var(--failed); font-size:12px; margin:4px 0; }
.dk-sec { margin-top:8px; }
.dk-sec > h4 { margin:0 0 3px; font-size:11px; font-weight:600; color:var(--dim); text-transform:uppercase; letter-spacing:.04em; }
.dk-keys { display:flex; flex-wrap:wrap; gap:4px; }
.dk-key { font:12px ui-monospace, monospace; border:1px solid var(--line); border-radius:3px; padding:0 5px; }
.dk-key.spec { border-color:var(--pick); }
.dk-key.dim { color:var(--dim); }
.dk-key i { font-style:normal; color:var(--dim); margin-left:4px; }
.dk-act { margin:3px 0; }
.dk-act summary { cursor:pointer; list-style:none; }
.dk-act summary::-webkit-details-marker { display:none; }
.dk-act code, .dk-place code { font:12px ui-monospace, monospace; }
.dk-act .t { color:var(--dim); margin-left:6px; }
.dk-act .doc { color:var(--dim); margin:2px 0 2px 12px; }
.dk-fields { margin:2px 0 4px 12px; font-size:12px; }
.dk-fields div { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dk-fields .ty { color:var(--dim); }
.dk-place { display:flex; flex-wrap:wrap; gap:2px 6px; font-size:12px; }
.dk-place code { word-break:break-all; }
.dk-place span { color:var(--dim); }
.dk-more { color:var(--dim); font-size:12px; cursor:pointer; }
.dk pre { margin:0; font:11px/1.4 ui-monospace, monospace; white-space:pre-wrap; word-break:break-all; color:var(--dim); max-height:220px; overflow:auto; }
`;

const PLACES_SHOWN = 6;

/** Keys: spec ones with their contract and edition, a pack's own plain. */
const Keys = ({ keys, dim }: { keys: PackDoc["provides"]; dim?: boolean }) => html`
  <div class="dk-keys">
    ${keys.map(
      (k) => html`<span key=${k.key} class=${`dk-key${k.contract ? " spec" : ""}${dim ? " dim" : ""}`} title=${k.doc ?? "a pack's own key"}
        >${k.key}${k.contract && html`<i>${k.contract} e${k.since}</i>`}</span
      >`,
    )}
  </div>
`;

const Contracts = ({ pack }: { pack: PackDoc }) => html`
  ${pack.provides.length > 0 &&
  html`<div class="dk-sec">
    <h4>Provides${contractsOf(pack).length ? ` · implements ${contractsOf(pack).map((c) => c.contract).join(", ")}` : ""}</h4>
    <${Keys} keys=${pack.provides} />
  </div>`}
  ${pack.inject.length > 0 && html`<div class="dk-sec"><h4>Injects</h4><${Keys} keys=${pack.inject} dim /></div>`}
`;

const Actions = ({ pack }: { pack: PackDoc }) =>
  pack.actions.length > 0 &&
  html`<div class="dk-sec">
    <h4>Actions</h4>
    ${pack.actions.map((a) => {
      const fields = fieldsOf(a.input);
      return html`<details key=${a.name} class="dk-act">
        <summary><code>${a.name}</code><span class="t">${a.title}</span></summary>
        ${a.doc && html`<div class="doc">${a.doc}</div>`}
        <div class="dk-fields">
          ${fields.length
            ? fields.map(
                (f) => html`<div key=${f.name} title=${f.doc ?? ""}>
                  <code>${f.name}${f.required ? "" : "?"}</code> <span class="ty">${f.type}${f.doc ? ` · ${f.doc}` : ""}</span>
                </div>`,
              )
            : html`<div class="ty">no input</div>`}
        </div>
      </details>`;
    })}
  </div>`;

const Places = ({ pack }: { pack: PackDoc }) => {
  const [all, setAll] = useState(false);
  if (!pack.places.length) return null;
  const shown = all ? pack.places : pack.places.slice(0, PLACES_SHOWN);
  return html`<div class="dk-sec">
    <h4>Speaks at</h4>
    ${shown.map((p) => html`<div key=${p.place} class="dk-place"><code>${p.place}</code><span>${p.nodes} node${p.nodes === 1 ? "" : "s"}</span></div>`)}
    ${pack.places.length > PLACES_SHOWN &&
    html`<div class="dk-more" onClick=${() => setAll(!all)}>${all ? "fewer" : `+${pack.places.length - PLACES_SHOWN} more`}</div>`}
  </div>`;
};

const Slots = ({ pack }: { pack: PackDoc }) =>
  pack.slots &&
  html`<div class="dk-sec">
    <h4>UI</h4>
    ${pack.slots.declares.length > 0 &&
    html`<div class="dk-place"><span>declares</span>${pack.slots.declares.map((s) => html`<code key=${s.name} title=${s.doc ?? ""}>${s.name}</code>`)}</div>`}
    ${pack.slots.fills.length > 0 &&
    html`<div class="dk-place"><span>fills</span>${pack.slots.fills.map((f) => html`<code key=${`${f.slot}/${f.name}`}>${f.slot}${f.title ? ` (${f.title})` : ""}</code>`)}</div>`}
  </div>`;

const Config = ({ pack }: { pack: PackDoc }) =>
  pack.config !== undefined &&
  html`<details class="dk-sec"><summary class="dk-more">config</summary><pre>${JSON.stringify(pack.config, null, 1)}</pre></details>`;

const view: Pack = {
  id: "docs",
  inject: [KEY, "slot.declare", "slot.fill", "slot.read"],
  apply(ctx: Context) {
    const server = ctx.get<DocsRead>(KEY);
    const slots = ctx.get<SlotRead>("slot.read");
    const declare = ctx.get<SlotDeclare>("slot.declare");
    const fill = ctx.get<SlotFill>("slot.fill");
    declare.declare({ name: HEAD, merge: "many", doc: "A pack's card, its title line: each fill gets { pack }." });
    declare.declare({ name: BODY, merge: "many", doc: "A pack's card, its body: each fill gets { pack }." });
    for (const [name, v] of [["contracts", Contracts], ["actions", Actions], ["places", Places], ["slots", Slots], ["config", Config]] as const) {
      fill.fill({ slot: BODY, name, view: v as any });
    }

    const Fills = ({ name, pack }: { name: string; pack: PackDoc }) => {
      const [, tick] = useState(0);
      useEffect(() => slots.watch(name, () => tick((x) => x + 1)) as () => void, [name]);
      return html`${slots.fills(name).map((f) => html`<${f.view} key=${`${f.pack}/${f.name}`} pack=${pack} />`)}`;
    };

    /** One pack: its title line, then whatever fills the card. */
    const Card = ({ pack }: { pack: PackDoc }) => html`
      <div class="dk-card" data-pack=${pack.id}>
        <div class="dk-head">
          <span class=${`dk-dot ${pack.state}`} title=${pack.state}></span>
          <b>${pack.id}</b><span class="dk-side">${pack.side}</span>
          <span class="dk-sp"></span>
          <${Fills} name=${HEAD} pack=${pack} />
        </div>
        <div class="dk-tally">${pack.state}${tally(pack) ? ` · ${tally(pack)}` : ""}</div>
        ${pack.missing && html`<div class="dk-warn">waits for ${pack.missing.join(", ")}</div>`}
        ${pack.error && html`<div class="dk-warn">${pack.error}</div>`}
        <${Fills} name=${BODY} pack=${pack} />
      </div>
    `;

    const usePacks = () => {
      const [docs, setDocs] = useState<PackDoc[]>([]);
      useEffect(() => {
        let live = true;
        const read = async () => {
          const remote = await server.packs().catch(() => [] as PackDoc[]);
          if (live) setDocs([...remote, ...reference(ctx.runtime, { side: "page", slots })]);
        };
        void read();
        const stop = server.watch(() => void read());
        let last = digest(ctx.runtime);
        const timer = setInterval(() => {
          const now = digest(ctx.runtime);
          if (now !== last) (last = now), void read();
        }, 1000);
        return () => {
          live = false;
          clearInterval(timer);
          void stop();
        };
      }, []);
      return docs;
    };

    const View = () => {
      const docs = usePacks();
      const [q, setQ] = useState("");
      const [side, setSide] = useState<string | undefined>(undefined);
      const shown = useMemo(() => docs.filter((d) => (!side || d.side === side) && matches(d, q)), [docs, q, side]);
      const sides = [...new Set(docs.map((d) => d.side))];
      return html`
        <div class="dk">
          <div class="dk-bar">
            <input placeholder="filter: a pack, key, action, place" value=${q} onInput=${(e: any) => setQ(e.currentTarget.value)} />
            <button class=${side ? "" : "on"} onClick=${() => setSide(undefined)}>all</button>
            ${sides.map((s) => html`<button key=${s} class=${side === s ? "on" : ""} onClick=${() => setSide(s)}>${s}</button>`)}
            <span>${shown.length} of ${docs.length} packs, read from the running packs</span>
          </div>
          <div class="dk-grid">${shown.map((d) => html`<${Card} key=${`${d.side}/${d.id}`} pack=${d} />`)}</div>
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = SHEET;
      document.head.append(style);
      return () => style.remove();
    });
    fill.fill({ slot: "shell.main", name: "view", title: "Packs", view: View });
  },
};

export default view;
