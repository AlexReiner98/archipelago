// What this server offers to connect a workspace to: each a server pack (the GitHub App, say). One row each: whether
// it is connected here, and to which account outside; the one action that comes next (set it up for the server,
// connect, or choose again what it is given); disconnecting, rarely, in a menu.
//
// The host's, not a part's (task e_dqh5yz7t): connections is a tool only a person calls, its acts an admin's, and
// Connect leaves for an address outside. Kept in the identity root as host code (task e_u2phc9rq, 13 Nov 2026): a part
// sending an admin action is an open question for the owner.

import { api, ask, h } from './base.js';
import { menu } from './words.js';

/** A card of the Packs section, above the packs; hidden while this server offers nothing to connect. */
export function connectionsCard() {
  const card = h('section', { class: 'card wide', hidden: true }, h('header', {}, h('h2', { class: 'hinted', title: 'What this server can connect to this map, each chosen outside and heard from here.' }, 'Connections')));
  const body = h('ul', { class: 'rows' });
  const fail = (err) => ((card.hidden = false), body.replaceChildren(h('li', { class: 'error' }, err.message)));
  const go = (pack, what) => () =>
    api('connections', { pack, [what]: true })
      .then((to) => (location.href = to.url))
      .catch(fail);
  const draw = async (answer) => {
    const { packs } = answer ?? (await api('connections'));
    card.hidden = !packs.length;
    if (!packs.length) return body.replaceChildren();
    const end = (p) => async () => {
      if (!(await ask({ title: `Disconnect ${p.title}?`, message: `What ${p.title} hears no longer reaches this map. It stays where it was chosen outside until it is removed there.`, action: 'Disconnect', danger: true }))) return;
      api('connections', { pack: p.pack, end: true }).then(draw).catch(fail);
    };
    body.replaceChildren(
      ...packs.map((p) =>
        h(
          'li',
          { class: 'one' },
          h('span', { class: `mark${p.connected ? ' ok' : ''}` }, p.connected ? 'connected' : p.ready ? 'not connected' : 'not set up'),
          h('span', { class: 'grow', title: p.name ?? p.title }, h('strong', {}, p.title), p.connected?.account ? h('span', { class: 'muted small' }, ` ${p.connected.account}`) : ''),
          p.connected
            ? [h('button', { title: `Choose again what ${p.title} is given`, onclick: go(p.pack, 'start') }, 'Choose'), menu('More', [['Disconnect', end(p), 'danger']])]
            : p.ready
              ? h('button', { class: 'primary', title: `Choose what ${p.title} is given; what it hears reaches this map from then on`, onclick: go(p.pack, 'start') }, 'Connect')
              : p.can_setup
                ? h('button', { class: 'primary', title: `Once for this server: ${p.title} is made, and every workspace can connect it`, onclick: go(p.pack, 'setup') }, 'Set up')
                : '',
        ),
      ),
    );
  };
  draw().catch(fail);
  card.append(body);
  return card;
}
