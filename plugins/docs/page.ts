/**
 * A plugin's own page in the Plugins view: everything its card counts, in
 * full, and what it stands on. Each section is a fill of the slot
 * `docs.page` (each gets `{ plugin, all }`), so another plugin can add one.
 * The wiring (its keys, with the spec contract of each, and its config)
 * is last, folded: there for whoever wants it, out of the way otherwise.
 */
import { h } from "preact";
import htm from "htm";
import { addsOf, ago, failureOf, fieldsOf, originWords, stateWords, troubled, usedBy, uses, type Named } from "./cards.ts";
import type { PluginDoc } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

type Props = { plugin: PluginDoc; all: PluginDoc[] };
type LinkView = (p: { to: Named }) => unknown;

/** The sections of a plugin's page, given how a name becomes a link. */
export function sections(Link: LinkView): [string, (p: Props) => unknown][] {
  const links = (xs: Named[]) => xs.map((x, i) => html`${i ? ", " : ""}<${Link} key=${i} to=${x} />`);
  const Sec = ({ title, children }: { title: string; children: unknown }) => html`<section class="dk-sec"><h4>${title}</h4>${children}</section>`;

  const About = ({ plugin }: Props) => html`
    <p class=${`dk-lead${plugin.about ? "" : " none"}`}>${plugin.about ?? "It doesn't say what it is for."}</p>
    ${stateWords(plugin) && !failureOf(plugin) && html`<p class=${troubled(plugin) ? "dk-warn" : "dk-dim"}>${stateWords(plugin)}${plugin.missing ? ` It needs: ${plugin.missing.join(", ")}.` : ""}</p>`}
    ${plugin.builtIn === false && html`<p class="dk-dim">Added from outside this repository.</p>`}
  `;

  /** What went wrong: its error in full, when it was seen, where to look, and its stack, folded. */
  const Failure = ({ plugin }: Props) => {
    const f = failureOf(plugin);
    if (!f) return null;
    const w = plugin.where ?? {};
    return html`<${Sec} title="What went wrong">
      <p class="dk-warn">${f.error}</p>
      ${f.when && html`<p class="dk-dim" title=${plugin.failedAt}>${f.when}.</p>`}
      <table class="dk-table">
        ${w.file && html`<tr><td>Where it threw</td><td><code>${w.file}</code></td></tr>`}
        ${w.module && html`<tr><td>Its module</td><td><code>${w.module}</code></td></tr>`}
        ${w.log && html`<tr><td>The log</td><td>${w.log.startsWith("the ") ? w.log : html`<code>${w.log}</code>`}</td></tr>`}
      </table>
      ${plugin.stack && html`<details><summary>The stack</summary><pre>${plugin.stack.join("\n")}</pre></details>`}
    <//>`;
  };

  /** Where it came from, at what commit or version, and when it last changed. */
  const Origin = ({ plugin }: Props) => {
    const o = plugin.origin;
    if (!o) return null;
    return html`<${Sec} title="Where it came from">
      <p>${originWords(plugin)}.</p>
      <table class="dk-table">
        ${o.path && html`<tr><td>Folder</td><td><code>${o.path}</code></td></tr>`}
        ${o.version && html`<tr><td>Version</td><td>${o.version}</td></tr>`}
        ${o.commit && html`<tr><td>Last commit</td><td><code>${o.commit}</code></td></tr>`}
        ${o.changed && html`<tr><td>Last changed</td><td title=${o.changed}>${new Date(o.changed).toLocaleString()} (${ago(o.changed)})${o.edited ? ", edits not committed" : ""}</td></tr>`}
      </table>
    <//>`;
  };

  const Adds = ({ plugin, all }: Props) => {
    const a = addsOf(plugin, all);
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

  const Actions = ({ plugin }: Props) =>
    plugin.actions.length > 0 &&
    html`<${Sec} title="What agents and plugins can do with it">
      ${plugin.actions.map((x) => {
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

  const Nodes = ({ plugin }: Props) =>
    plugin.places.length > 0 &&
    html`<${Sec} title="Where its nodes speak to agents">
      <table class="dk-table">
        ${plugin.places.map((p) => html`<tr key=${p.place}><td><code>${p.place}</code></td><td class="num">${p.nodes}</td></tr>`)}
      </table>
      <p><${Link} to=${{ title: "See them in the context interface", view: "harness" }} /></p>
    <//>`;

  const Run = ({ plugin }: Props) =>
    plugin.activity &&
    html`<${Sec} title="In the newest run">
      <p>Said ${plugin.activity.said}, refused ${plugin.activity.refused}, acted ${plugin.activity.acted}. <${Link} to=${{ title: "Open the run", view: "harness", run: plugin.activity.run }} /></p>
    <//>`;

  const Ties = ({ plugin, all }: Props) => {
    const on = uses(plugin, all).map((id) => ({ title: id, plugin: id }));
    const by = usedBy(plugin, all).map((id) => ({ title: id, plugin: id }));
    if (!on.length && !by.length) return null;
    return html`<${Sec} title="Plugins it works with">
      ${on.length > 0 && html`<p><b>Stands on</b> ${links(on)}</p>`}
      ${by.length > 0 && html`<p><b>Used by</b> ${links(by)}</p>`}
    <//>`;
  };

  const Wiring = ({ plugin }: Props) => html`
    <details class="dk-sec">
      <summary><h4>Wiring</h4></summary>
      ${plugin.parts && html`<p><b>Plugins in it</b> ${plugin.parts.join(", ")}</p>`}
      ${plugin.provides.length > 0 &&
      html`<p><b>Provides</b> ${plugin.provides.map((k) => html`<code key=${k.key} title=${k.doc ?? ""}>${k.key}${k.contract ? ` (spec: ${k.contract}, edition ${k.since})` : ""}</code> `)}</p>`}
      ${plugin.inject.length > 0 && html`<p><b>Injects</b> ${plugin.inject.map((k) => html`<code key=${k.key}>${k.key}</code> `)}</p>`}
      ${plugin.config !== undefined && html`<pre>${JSON.stringify(plugin.config, null, 1)}</pre>`}
    </details>
  `;

  return [
    ["about", About],
    ["failure", Failure],
    ["adds", Adds],
    ["actions", Actions],
    ["nodes", Nodes],
    ["run", Run],
    ["ties", Ties],
    ["origin", Origin],
    ["wiring", Wiring],
  ];
}
