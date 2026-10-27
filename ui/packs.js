// The Workspace screen's packs: each pack on this server, one line folded (its state here, what it offers, its
// switch), and opened, everything it offers that the owner controls: its styles, its screens, the checks it adds, and
// in a line each, the types, links and actions it brings. What a pack offers is controlled on its card, nowhere else.

import { api, ask, h, state, tell } from './base.js';
import { screenRows } from './nav.js';
import { styleRows } from './styles-card.js';
import { isTheme } from './themes-card.js';
import { checkRow } from './agents-card.js';
import { line } from './workspace-cards.js';
import { menu } from './words.js';

/** The kernel's packs, which are never off. */
const KERNEL = ['core'];
/** The packs opened on this page, kept while it is drawn again. */
const opened = new Set();

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** info: workspace_info (its reply rules); then: draw the page again; goTo: open another section of it. */
export function packsCard({ info, then, goTo }) {
  const schema = state.schema ?? {};
  const body = h('ul', { class: 'rows' });
  const turn = async (p, on) => {
    const sure = await ask({
      title: `${on ? 'Turn on' : 'Turn off'} ${p.title}?`,
      message: on ? 'Its tools come back and its items are active again.' : 'Its items stay, dormant: a person can still edit them. Its tools are gone until it is on again.',
      action: on ? 'Turn on' : 'Turn off',
      danger: !on,
    });
    if (sure) api('pack_set', { pack: p.id, on }).then(then, (err) => tell('That was not done', err.message));
  };
  // What one pack offers, from the schema: the parts the owner controls, and the rest named.
  const offers = (id) => {
    const of = (things) => list(things).filter((t) => t.pack === id);
    const styles = of(schema.styles);
    return {
      styles: styles.filter((s) => !isTheme(s)),
      themes: styles.filter(isTheme),
      screens: of(schema.screens),
      checks: (info.reply_rules ?? []).filter((r) => r.rule.startsWith(`${id}.`)),
      types: of(schema.types).map((t) => t.title),
      links: of(schema.relations).map((r) => r.title),
      actions: of(schema.pack_tools).map((t) => t.title || t.action).filter(Boolean),
    };
  };
  const named = (label, names) => names.length > 0 && line(h('span', { class: 'grow muted small', title: names.join('\n') }, `${label}: ${names.join(', ')}`));
  const row = (p) => {
    const o = offers(p.id);
    const open = opened.has(p.id);
    const counts = [o.screens.length && plural(o.screens.length, 'screen'), o.styles.length && plural(o.styles.length, 'style'), o.themes.length && plural(o.themes.length, 'theme'), o.checks.length && plural(o.checks.length, 'check'), o.types.length && plural(o.types.length, 'type')].filter(Boolean).join(' · ');
    const description = list(schema.packs).find((d) => d.id === p.id)?.description ?? '';
    const head = line(
      h(
        'button',
        { class: 'grow pack-open', title: `${p.title} ${p.version}${p.why ? `: ${p.why}` : ''}\n${description}`, 'aria-expanded': String(open), onclick: () => (open ? opened.delete(p.id) : opened.add(p.id), draw()) },
        h('span', { class: 'fold-mark' }, open ? '▾' : '▸'),
        ' ',
        h('strong', {}, p.title),
        ' ',
        h('span', { class: 'muted small' }, counts || p.version),
      ),
      p.state !== 'active' && h('span', { class: `pill${p.state === 'waiting' ? ' warn' : ' closed'}`, title: p.why ?? '' }, p.state),
      // Turning a pack off is rare, and in its menu; one that is off is turned on in sight.
      KERNEL.includes(p.id) ? h('span', { class: 'menu-room' }) : p.state === 'off' ? h('button', { title: p.why ?? '', onclick: () => turn(p, true) }, 'Turn on') : menu('⋯', [['Turn off', () => turn(p, false), 'danger']]),
    );
    if (!open) return head;
    return [
      head,
      h(
        'li',
        { class: 'pack-body' },
        h(
          'ul',
          { class: 'rows' },
          description && line(h('span', { class: 'grow muted small', title: description }, description)),
          styleRows(o.styles, then),
          o.themes.length > 0 && line(h('span', { class: 'grow' }, h('strong', {}, plural(o.themes.length, 'theme')), ' ', h('span', { class: 'muted small' }, 'one is chosen for the whole workspace')), h('button', { onclick: () => goTo('map') }, 'Choose')),
          screenRows(o.screens, then),
          o.checks.map(checkRow),
          named('Types', o.types),
          named('Links', o.links),
          named('Actions', o.actions),
        ),
      ),
    ];
  };
  let packs = [];
  const draw = () => body.replaceChildren(...packs.flatMap(row).filter(Boolean));
  api('packs').then(
    (all) => ((packs = all), draw()),
    (err) => body.replaceChildren(h('li', { class: 'muted' }, err.message)),
  );
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Each way of working is a pack. Open one to control what it offers. Turned off, its items stay, dormant, and its tools leave the list.' }, 'Packs')), body);
}
