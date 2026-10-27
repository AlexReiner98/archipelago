// The Workspace screen's packs: each pack on this server a plate, open, holding everything it offers that the owner
// controls: its styles, its screens, the checks it adds; its state here and its switch at its head; the types, links
// and actions it brings counted at its foot. What a pack offers is controlled on its plate, nowhere else.

import { api, ask, h, state, tell } from './base.js';
import { screenRows } from './nav.js';
import { styleRows } from './styles-card.js';
import { isTheme } from './themes-card.js';
import { checkRow } from './agents-card.js';
import { line } from './workspace-cards.js';
import { plate } from './plates.js';
import { menu } from './words.js';

/** The kernel's packs, which are never off. */
const KERNEL = ['core'];

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** info: workspace_info (its reply rules); then: draw the page again; goTo: open another section of it. */
export function packsCard({ info, then, goTo }) {
  const schema = state.schema ?? {};
  const body = h('div', { class: 'plates' });
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
  const packTile = (p) => {
    const o = offers(p.id);
    // Counted by the words a person reads for them; the whole of each in the tooltip.
    const named = [['Types', o.types], ['Links', o.links], ['Actions', o.actions]].filter(([, names]) => names.length);
    return plate({
      name: p.title,
      title: `${p.title} ${p.version}${p.why ? `: ${p.why}` : ''}`,
      off: p.state === 'off',
      marks: [h('span', { class: 'muted small' }, p.version), p.state !== 'active' && h('span', { class: `pill${p.state === 'waiting' ? ' warn' : ' closed'}`, title: p.why ?? '' }, p.state)],
      // Turning a pack off is rare, and in its menu; one that is off is turned on in sight.
      action: KERNEL.includes(p.id) ? null : p.state === 'off' ? h('button', { title: p.why ?? '', onclick: () => turn(p, true) }, 'Turn on') : menu('⋯', [['Turn off', () => turn(p, false), 'danger']]),
      says: list(schema.packs).find((d) => d.id === p.id)?.description,
      rows: [
        styleRows(o.styles, then),
        o.themes.length > 0 && line(h('span', { class: 'grow' }, h('strong', {}, plural(o.themes.length, 'theme')), ' ', h('span', { class: 'muted small' }, 'one for the whole map')), h('button', { onclick: () => goTo('map') }, 'Choose')),
        screenRows(o.screens, then),
        o.checks.map(checkRow),
      ],
      foot: named.length > 0 && { text: named.map(([what, names]) => `${names.length} ${(names.length === 1 ? what.slice(0, -1) : what).toLowerCase()}`).join(' · '), title: named.map(([what, names]) => `${what}: ${names.join(', ')}`).join('\n') },
    });
  };
  api('packs').then(
    (packs) => body.replaceChildren(...packs.map(packTile)),
    (err) => body.replaceChildren(h('div', { class: 'error' }, err.message)),
  );
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Each way of working is a pack, and what it offers is set on its plate. Turned off, its items stay, dormant, and its tools leave the list.' }, 'Packs')), body);
}
