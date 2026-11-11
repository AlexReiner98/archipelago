// The Workspace screen's Members card: the people who sign in, each by an email address. An admin adds someone by
// their address and they are sent an invitation; a sign-in made some other way (the owner's first token) is listed
// under them, as a token.

import { api, ask, h } from './base.js';
import { ago, menu } from './words.js';

/** members: from member_list. owner: the person the workspace was made for. others: the live human tokens of nobody listed. then: draw the page again; say: put a word at its top. */
export function membersCard({ me, owner, members, others, tokenRow, then, fail, say }) {
  const email = h('input', { type: 'text', inputmode: 'email', placeholder: 'Email', style: 'flex: 2; min-width: var(--input-least)', autocomplete: 'off' });
  const name = h('input', { type: 'text', placeholder: 'Name (optional)', style: 'flex: 1; min-width: var(--input-least)' });
  const admin = h('input', { type: 'checkbox' });
  const reads = h('input', { type: 'checkbox' });
  // An admin never only reads: ticking one unticks the other.
  admin.addEventListener('change', () => admin.checked && (reads.checked = false));
  reads.addEventListener('change', () => reads.checked && (admin.checked = false));
  const add = async () => {
    try {
      const made = await api('member_add', { email: email.value.trim(), name: name.value.trim() || undefined, admin: admin.checked, read_only: reads.checked });
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
      { class: 'one' },
      h('span', { class: 'grow', title: m.email }, h('strong', {}, m.name ?? m.email), ' ', h('span', { class: 'muted small' }, m.last_used ? ['signed in ', ago(m.last_used)] : 'not signed in yet')),
      m.person_id === owner
        ? h('span', { class: 'muted small', title: 'The workspace was made for them' }, 'owner')
        : m.admin
          ? h('span', { class: 'muted small' }, 'admin')
          : m.read_only && h('span', { class: 'muted small', title: 'They see what any member sees and change nothing' }, 'reads only'),
      you && h('span', { class: 'muted small' }, 'you'),
      you
        ? h('span', { class: 'menu-room' })
        : menu('⋯', [
            [m.admin ? 'Not an admin' : 'Make admin', () => set(m, { admin: !m.admin })],
            [m.read_only ? 'Let them change the map' : 'Only reads', () => set(m, { read_only: !m.read_only })],
            ['Remove', async () => (await ask({ title: `Remove ${m.name ?? m.email}?`, message: 'They are signed out at once, everywhere.', action: 'Remove', danger: true })) && set(m, { remove: true }), 'danger'],
          ]),
    );
  };
  email.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', { class: 'hinted', title: 'People who sign in to this workspace, each by their email address.' }, 'Members')),
    h('ul', { class: 'rows' }, members.map(row), others.map(tokenRow)),
    h('div', { class: 'toolbar', style: 'padding: var(--space-6) 0' }, email, name, h('label', {}, admin, ' Admin'), h('label', { title: 'They see what any member sees and change nothing' }, reads, ' Reads only'), h('button', { class: 'primary', title: 'They are sent an invitation by email', onclick: add }, 'Add member')),
  );
}
