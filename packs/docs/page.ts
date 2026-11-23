/**
 * A pack's own page in the Packs view: everything its card counts, in
 * full, and what it stands on. Each section is a fill of the slot
 * `docs.page` (each gets `{ pack, all }`), so another pack can add one.
 * The wiring (its keys, with the spec contract of each, and its config)
 * is last, folded: there for whoever wants it, out of the way otherwise.
 */
import { h } from "preact";
import htm from "htm";
import { addsOf, fieldsOf, stateWords, troubled, usedBy, uses, type Named } from "./cards.ts";
import type { PackDoc } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

type Props = { pack: PackDoc; all: PackDoc[] };
type LinkView = (p: { to: Named }) => unknown;

/** The sections of a pack's page, given how a name becomes a link. */
export function sections(Link: LinkView): [string, (p: Props) => unknown][] {
  const links = (xs: Named[]) => xs.map((x, i) => html`${i ? ", " : ""}<${Link} key=${i} to=${x} />`);
  const Sec = ({ title, children }: { title: string; children: unknown }) => html`<section class="dk-sec"><h4>${title}</h4>${children}</section>`;

  const About = ({ pack }: Props) => html`
    <p class=${`dk-lead${pack.about ? "" : " none"}`}>${pack.about ?? "It doesn't say what it is for."}</p>
    ${stateWords(pack) && html`<p class=${troubled(pack) ? "dk-warn" : "dk-dim"}>${stateWords(pack)}${pack.missing ? ` It needs: ${pack.missing.join(", ")}.` : ""}</p>`}
    ${pack.builtIn === false && html`<p class="dk-dim">Added from outside this repository.</p>`}
  `;

  const Adds = ({ pack, all }: Props) => {
    const a = addsOf(pack, all);
    if (!a.views.length && !a.parts.length && !a.kinds.length && !a.links.length) return null;
    return html`<${Sec} title="What it adds">
      ${a.views.length > 0 && html`<p><b>Views</b> ${links(a.views)}</p>`}
      ${a.parts.length > 0 && html`<p><b>Parts of views</b> ${links(a.parts)}</p>`}
      ${a.kinds.length > 0 &&
      html`<table class="dk-table">
        ${a.kinds.map(
          (t) => html`<tr key=${t.name}>
            <td><${Link} to=${{ title: t.name, query: `type:${t.name}` }} /></td>
            <td class="num">${t.count !== undefined ? `${t.count}${t.more ? "+" : ""}` : ""}</td>
            <td class="dk-dim">${t.base ? `a kind of ${t.base}. ` : ""}${t.doc ?? ""}</td>
          </tr>`,
        )}
      </table>`}
      ${a.links.length > 0 && html`<p><b>Kinds of link</b> ${a.links.map((t) => t.name).join(", ")}</p>`}
    <//>`;
  };

  const Actions = ({ pack }: Props) =>
    pack.actions.length > 0 &&
    html`<${Sec} title="What agents and packs can do with it">
      ${pack.actions.map((x) => {
        const fields = fieldsOf(x.input);
        return html`<div key=${x.name} class="dk-act">
          <div><b>${x.title}</b></div>
          ${x.doc && html`<div class="dk-dim">${x.doc}</div>`}
          <div class="dk-dim">
            ${fields.length ? `Takes ${fields.map((f) => `${f.name} (${f.type}${f.required ? "" : ", optional"})`).join(", ")}.` : "Takes nothing."}
          </div>
        </div>`;
      })}
    <//>`;

  const Nodes = ({ pack }: Props) =>
    pack.places.length > 0 &&
    html`<${Sec} title="Where its nodes speak to agents">
      <table class="dk-table">
        ${pack.places.map((p) => html`<tr key=${p.place}><td><code>${p.place}</code></td><td class="num">${p.nodes}</td></tr>`)}
      </table>
      <p><${Link} to=${{ title: "See them in the context interface", view: "harness" }} /></p>
    <//>`;

  const Run = ({ pack }: Props) =>
    pack.activity &&
    html`<${Sec} title="In the newest run">
      <p>Said ${pack.activity.said}, refused ${pack.activity.refused}, acted ${pack.activity.acted}. <${Link} to=${{ title: "Open the run", view: "harness", run: pack.activity.run }} /></p>
    <//>`;

  const Ties = ({ pack, all }: Props) => {
    const on = uses(pack, all).map((id) => ({ title: id, pack: id }));
    const by = usedBy(pack, all).map((id) => ({ title: id, pack: id }));
    if (!on.length && !by.length) return null;
    return html`<${Sec} title="Packs it works with">
      ${on.length > 0 && html`<p><b>Stands on</b> ${links(on)}</p>`}
      ${by.length > 0 && html`<p><b>Used by</b> ${links(by)}</p>`}
    <//>`;
  };

  const Wiring = ({ pack }: Props) => html`
    <details class="dk-sec">
      <summary><h4>Wiring</h4></summary>
      ${pack.parts && html`<p><b>Packs in it</b> ${pack.parts.join(", ")}</p>`}
      ${pack.provides.length > 0 &&
      html`<p><b>Provides</b> ${pack.provides.map((k) => html`<code key=${k.key} title=${k.doc ?? ""}>${k.key}${k.contract ? ` (spec: ${k.contract}, edition ${k.since})` : ""}</code> `)}</p>`}
      ${pack.inject.length > 0 && html`<p><b>Injects</b> ${pack.inject.map((k) => html`<code key=${k.key}>${k.key}</code> `)}</p>`}
      ${pack.config !== undefined && html`<pre>${JSON.stringify(pack.config, null, 1)}</pre>`}
    </details>
  `;

  return [
    ["about", About],
    ["adds", Adds],
    ["actions", Actions],
    ["nodes", Nodes],
    ["run", Run],
    ["ties", Ties],
    ["wiring", Wiring],
  ];
}
