// The Workspace screen's packs: each pack on this server a plate, kept to what matters at a glance: its name, its
// switch, and what it touches, as the server groups its manifest's keys (packTouches in src/packstate.ts): types,
// links, views, styles, instructions, rules, actions, runs, reach, each with how many. A group opens in the plate on a
// click, so the owner sees exactly what the pack brings: each thing one line, by name and what it is, with how much it
// was used on this map in the last 30 days (src/pack-use.ts), a mark where it was not used at all; a click opens its
// whole definition as the manifest has it. Where the owner changes a thing here (its styles, the screens among its
// views, the checks among its rules), its controls come first. Packs that go together (a bundle, src/bundles.ts) are
// one plate with one switch: each pack a band in it, its name on a line and what it touches under it.

import { api, ask, h, state, tell } from './base.js';
import { screenRows } from './nav.js';
import { styleRows } from './styles-card.js';
import { isTheme } from './themes-card.js';
import { checkRow } from './agents-card.js';
import { line } from './workspace-cards.js';
import { plate } from './plates.js';

/** The kernel's packs, which are never off. */
const KERNEL = ['core'];
/** The group open on each pack's plate, kept while the page is drawn again. */
const opened = new Map();
/** The declarations whose whole definition is open, by pack, group and place. */
const shownDefs = new Set();
/** A count in a few characters: 1234 as 1.2k. */
const compact = (n) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`);

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
/** What each group is, for its tooltip. */
const MEANS = {
  shared: 'the types it shares as words every island may use',
  types: 'what it adds to the map',
  links: 'how its items are tied',
  views: 'what it shows: reads, trees and screens',
  styles: 'how things look: drawings and style presets',
  instructions: 'what agents are told',
  rules: 'what decides a write, or asks an agent at its reply’s end',
  actions: 'what people and agents can do through it',
  runs: 'what runs by itself: on an event, a schedule or a webhook',
  reach: 'what it reaches beyond the map',
};

/** info: workspace_info (its reply rules); then: draw the page again; goTo: open another section of it. */
export function packsCard({ info, then, goTo }) {
  const schema = state.schema ?? {};
  const body = h('div', { class: 'plates' });
  const turn = async (p, on, box) => {
    // What relies on it waits while it is out: named before it happens.
    const named = (ids) => ids.map((id) => packs.find((q) => q.id === id)?.title ?? id).join(', ');
    const waits = !on && p.dependents?.length ? ` ${named(p.dependents)} will wait until it is back.` : '';
    const all = p.packs ? ` All ${p.packs.length} of its packs go ${on ? 'on' : 'off'} together.` : '';
    const sure = await ask({
      title: `${on ? 'Turn on' : 'Turn off'} ${p.title}?`,
      message: (on ? 'Its tools come back and its items are active again.' : `Its items stay, dormant: a person can still edit them. Its tools are gone until it is on again.${waits}`) + all,
      action: on ? 'Turn on' : 'Turn off',
      danger: !on,
    });
    if (!sure) return void (box.checked = !on);
    api('pack_set', { pack: p.id, on }).then(then, (err) => ((box.checked = !on), tell('That was not done', err.message)));
  };
  // The rows the owner controls in a group, where the pack has any here, and the sorts of thing they cover.
  const controls = (p, key) => {
    const of = (things) => list(things).filter((t) => t.pack === p.id);
    if (key === 'styles') {
      const styles = of(schema.styles);
      const themes = styles.filter(isTheme);
      // Its themes are each listed by name; one is chosen for the whole map, on the Map section.
      const choose = themes.length > 0 && line(h('span', { class: 'grow muted small' }, 'One theme is chosen for the whole map'), h('button', { onclick: () => goTo('map') }, 'Choose'));
      return { covers: ['preset'], rows: styleRows(styles.filter((s) => !isTheme(s)), then), after: choose ? [choose] : [] };
    }
    if (key === 'views') return { covers: ['screen'], rows: screenRows(of(schema.screens), then).filter(Boolean) };
    if (key === 'rules') return { covers: ['asks'], rows: (info.reply_rules ?? []).filter((r) => r.rule.startsWith(`${p.id}.`)).map(checkRow) };
    return { covers: [], rows: [] };
  };
  // Everything in a group, one line each: the controls where the owner changes it here, the rest by name and what it is.
  const group = (p, t) => {
    const c = p.state !== 'off' ? controls(p, t.key) : { covers: [], rows: [] };
    const shown = c.rows.length ? t.items.filter((x) => !c.covers.includes(x.sort)) : t.items;
    return [...c.rows, ...shown.flatMap((x, i) => decl(p, t, x, i)), ...(c.after ?? [])];
  };
  // One declaration: its name and what it is on one line, its sort and its use as marks; a click shows its definition.
  const decl = (p, t, x, i) => {
    const at = `${p.id} ${t.key} ${i}`, open = shownDefs.has(at);
    const use = x.used === undefined ? null : x.used === 0 ? h('span', { class: 'mark warn', title: `Unused: ${x.said ?? ''}` }, 'unused') : h('span', { class: 'mark', title: x.said ?? '' }, compact(x.used));
    const row = h(
      'li',
      { class: `one decl${open ? ' on' : ''}`, title: [x.name, x.hint || x.about].filter(Boolean).join(': '), 'aria-expanded': String(open), onclick: () => (open ? shownDefs.delete(at) : shownDefs.add(at), draw()) },
      h('span', { class: 'grow' }, h('strong', {}, x.name), ' ', h('span', { class: 'muted small' }, x.about)),
      x.sort && h('span', { class: 'mark' }, x.sort),
      use,
    );
    return open ? [row, h('li', { class: 'decl-def' }, h('pre', { class: 'page-json' }, JSON.stringify(x.def, null, 1)))] : [row];
  };
  // What a pack touches, a cell a group, and the group open under it.
  const touchRows = (p) => {
    const on = p.state !== 'off';
    const touched = (p.touches ?? []).filter((t) => t.n > 0);
    const open = touched.find((t) => t.key === opened.get(p.id));
    const cell = (t) => {
      const can = on && (controls(p, t.key).rows.length > 0 || (controls(p, t.key).after ?? []).length > 0);
      return h(
        'button',
        { class: `touch${t === open ? ' on' : ''}${can ? ' can' : ''}`, title: `${t.n} ${t.key}: ${MEANS[t.key] ?? ''}${t.unused ? `. ${t.unused} unused in the last ${p.use_days} days` : ''}${can ? '. Some are changed here' : ''}`, 'aria-expanded': String(t === open), onclick: () => (opened.set(p.id, t === open ? null : t.key), draw()) },
        h('strong', {}, String(t.n)),
        h('span', {}, t.key),
        t.unused > 0 && h('span', { class: 'mark warn' }, `${t.unused} unused`),
      );
    };
    return { open, rows: [h('li', { class: 'touches' }, touched.map(cell)), open ? group(p, open) : []] };
  };
  const toggle = (p, on) => {
    const box = h('input', { type: 'checkbox', role: 'switch', class: 'switch-toggle', checked: on, title: on ? 'On here: turn it off' : 'Off here: turn it on' });
    box.onchange = () => turn(p, box.checked, box);
    return box;
  };
  const marksOf = (p) => [p.version && h('span', { class: 'mark', title: p.manifest ? `Manifest ${p.manifest}` : 'Version' }, String(p.version)), p.made && h('a', { class: 'mark', href: `#/e/${p.made}`, title: 'Kept as an item on this map: open it' }, 'item'), p.state === 'waiting' && h('span', { class: 'mark warn', title: p.why ?? '' }, 'waiting'), p.state === 'off' && p.bundle && h('span', { class: 'mark', title: p.why ?? '' }, 'off')].filter(Boolean);
  const packPlate = (p) => {
    const on = p.state !== 'off';
    const { open, rows } = touchRows(p);
    return plate({
      wide: Boolean(open),
      name: p.title,
      title: `${p.title} ${p.version}${p.why ? `: ${p.why}` : ''}${p.description ? `\n${p.description}` : ''}${p.requires?.length ? `\nNeeds: ${p.requires.join(', ')}` : ''}`,
      off: !on,
      marks: marksOf(p),
      // The switch is on the plate's face; the kernel's pack and the server's required packs have none, since they are never off.
      action: KERNEL.includes(p.id) || p.required ? h('span', { class: 'muted small', title: p.required ? 'The server’s own, required: never off' : 'The kernel’s own: never off' }, 'always on') : toggle(p, on),
      rows,
    });
  };
  // A bundle: one plate, one switch for all its packs, on when every one is; each pack a band of its own under it.
  const bundlePlate = (b, parts) => {
    const on = parts.every((p) => p.state !== 'off');
    const bands = parts.map((p) => {
      const { open, rows } = touchRows(p);
      return { open, rows: [h('li', { class: 'one part', title: `${p.title} ${p.version}${p.why ? `: ${p.why}` : ''}${p.description ? `
${p.description}` : ''}` }, h('span', { class: 'grow' }, h('strong', {}, p.title), ' ', h('span', { class: 'muted small' }, p.description ?? '')), ...marksOf(p)), ...rows] };
    });
    return plate({
      wide: bands.some((x) => x.open),
      name: b.title,
      title: `${b.title}: ${parts.map((p) => p.title).join(' and ')}, on and off together${b.description ? `
${b.description}` : ''}`,
      off: !on,
      marks: [h('span', { class: 'mark', title: `A bundle of ${parts.length} packs` }, `${parts.length} packs`), parts.some((p) => p.state === 'waiting') && h('span', { class: 'mark warn' }, 'waiting')].filter(Boolean),
      action: toggle({ id: b.id, title: b.title, packs: b.packs, dependents: [...new Set(parts.flatMap((p) => p.dependents ?? []))] }, on),
      rows: bands.map((x) => x.rows),
    });
  };
  // Each pack its plate, except a bundle's, drawn once where its first pack stands.
  const plates = () => packs.flatMap((p) => {
    if (!p.bundle) return [packPlate(p)];
    if (p.bundle.packs.find((id) => packs.some((q) => q.id === id)) !== p.id) return [];
    return [bundlePlate(p.bundle, p.bundle.packs.map((id) => packs.find((q) => q.id === id)).filter(Boolean))];
  });
  let packs = [];
  const draw = () => body.replaceChildren(...plates());
  api('packs').then(
    (all) => ((packs = all), draw()),
    (err) => body.replaceChildren(h('div', { class: 'error' }, err.message)),
  );
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Each way of working is a pack. Its plate shows what it touches; click a group to change it here. Turned off, its items stay, dormant, and its tools leave the list.' }, 'Packs')), body);
}
