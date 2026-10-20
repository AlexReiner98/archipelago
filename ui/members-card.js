// The Workspace screen's Members card: the people who sign in, each by an email address. An admin adds someone by
// their address and they are sent an invitation; a sign-in made some other way (the owner's first token) is listed
// under them, as a token.

import { api, ask, h } from './base.js';
import { ago, menu } from './words.js';

/** members: from member_list. others: the live human tokens of nobody listed. then: draw the page again; say: put a word at its top. */
export function membersCard({ me, members, others, tokenRow, then, fail, say }) {
  const email = h('input', { type: 'text', inputmode: 'email', placeholder: 'Email', style: 'flex: 2; min-width: var(--input-least)', autocomplete: 'off' });
  const name = h('input', { type: 'text', placeholder: 'Name (optional)', style: 'flex: 1; min-width: var(--input-least)' });
  const admin = h('input', { type: 'checkbox' });
  const add = async () => {
    try {
      const made = await api('member_add', { email: email.value.trim(), name: name.value.trim() || undefined, admin: admin.checked });
      await then();
      made.invited ? say('muted', `Invitation sent to ${made.email}.`) : say('error', `${made.email} is a member, but the invitation was not sent: ${made.error}`);
    } catch (err) {
      fail(err);
    }
  };
  const set = (m, change) => api('member_set', { email: m.email, ...change }).then(then, fail);
  const row = (m) => {
    const you = m.person_id === me.actor.person;
    return h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top' },
        h('span', { class: 'grow' }, h('strong', {}, m.name ?? m.email), m.admin && [' ', h('span', { class: 'pill' }, 'admin')], you && [' ', h('span', { class: 'pill ok' }, 'you')]),
        !you &&
          menu('⋯', [
            [m.admin ? 'Not an admin' : 'Make admin', () => set(m, { admin: !m.admin })],
            ['Remove', async () => (await ask({ title: `Remove ${m.name ?? m.email}?`, message: 'They are signed out at once, everywhere.', action: 'Remove', danger: true })) && set(m, { remove: true }), 'danger'],
          ]),
      ),
      h('div', { class: 'row-sub', title: m.email }, m.name !== m.email && [m.email, ' · '], m.last_used ? ['signed in ', ago(m.last_used)] : 'not signed in yet'),
    );
  };
  email.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', { class: 'hinted', title: 'People who sign in to this workspace, each by their email address.' }, 'Members')),
    h('ul', { class: 'rows' }, members.map(row), others.map(tokenRow)),
    h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8)' }, email, name, h('label', {}, admin, ' Admin'), h('button', { class: 'primary', title: 'They are sent an invitation by email', onclick: add }, 'Add member')),
  );
}
