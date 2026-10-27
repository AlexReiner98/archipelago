// The Workspace screen's packs: each pack on this server a plate, kept to what matters at a glance: its name, its
// switch, and what it touches, as the server groups its manifest's keys (packTouches in src/packstate.ts): types,
// links, views, styles, instructions, rules, actions, runs, reach, each with how many. A group opens in the plate on a
// click, so the owner sees exactly what the pack brings: each thing one line, by name and what it is, and where the
// owner changes it here (its styles, the screens among its views, the checks among its rules), its controls.

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

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
/** What each group is, for its tooltip. */
const MEANS = {
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
    const sure = await ask({
      title: `${on ? 'Turn on' : 'Turn off'} ${p.title}?`,
      message: on ? 'Its tools come back and its items are active again.' : 'Its items stay, dormant: a person can still edit them. Its tools are gone until it is on again.',
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
    if (key === 'rules') return { covers: ['check'], rows: (info.reply_rules ?? []).filter((r) => r.rule.startsWith(`${p.id}.`)).map(checkRow) };
    return { covers: [], rows: [] };
  };
  // Everything in a group, one line each: the controls where the owner changes it here, the rest by name and what it is.
  const group = (p, t) => {
    const c = p.state !== 'off' ? controls(p, t.key) : { covers: [], rows: [] };
    const shown = c.rows.length ? t.items.filter((x) => !c.covers.includes(x.sort)) : t.items;
    return [...c.rows, ...shown.map((x) => line(h('span', { class: 'grow', title: [x.name, x.about].filter(Boolean).join(': ') }, h('strong', {}, x.name), ' ', h('span', { class: 'muted small' }, x.about)))), ...(c.after ?? [])];
  };
  const packPlate = (p) => {
    const on = p.state !== 'off';
    const touched = (p.touches ?? []).filter((t) => t.n > 0);
    const open = touched.find((t) => t.key === opened.get(p.id));
    const cell = (t) => {
      const can = on && (controls(p, t.key).rows.length > 0 || (controls(p, t.key).after ?? []).length > 0);
      return h(
        'button',
        { class: `touch${t === open ? ' on' : ''}${can ? ' can' : ''}`, title: `${t.n} ${t.key}: ${MEANS[t.key] ?? ''}${can ? '. Some are changed here' : ''}`, 'aria-expanded': String(t === open), onclick: () => (opened.set(p.id, t === open ? null : t.key), draw()) },
        h('strong', {}, String(t.n)),
        h('span', {}, t.key),
      );
    };
    const box = h('input', { type: 'checkbox', role: 'switch', class: 'switch-toggle', checked: on, title: on ? 'On here: turn it off' : 'Off here: turn it on' });
    box.onchange = () => turn(p, box.checked, box);
    return plate({
      name: p.title,
      title: `${p.title} ${p.version}${p.why ? `: ${p.why}` : ''}${p.description ? `\n${p.description}` : ''}${p.requires?.length ? `\nNeeds: ${p.requires.join(', ')}` : ''}`,
      off: !on,
      marks: p.state === 'waiting' && h('span', { class: 'pill warn', title: p.why ?? '' }, 'waiting'),
      // The switch is on the plate's face; the kernel's pack has none, since it is never off.
      action: KERNEL.includes(p.id) ? h('span', { class: 'muted small', title: 'The kernel’s own: never off' }, 'always on') : box,
      rows: [h('li', { class: 'touches' }, touched.map(cell)), open ? group(p, open) : []],
    });
  };
  let packs = [];
  const draw = () => body.replaceChildren(...packs.map(packPlate));
  api('packs').then(
    (all) => ((packs = all), draw()),
    (err) => body.replaceChildren(h('div', { class: 'error' }, err.message)),
  );
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Each way of working is a pack. Its plate shows what it touches; click a group to change it here. Turned off, its items stay, dormant, and its tools leave the list.' }, 'Packs')), body);
}
