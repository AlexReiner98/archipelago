// The Workspace screen's Agents section: the tokens agents act with, what the owner lets them do, and the checks that
// ask an agent at its reply's end. Each token, permission and check is one row; what is done rarely is in a menu.

import { api, ask, h } from './base.js';
import { ago, menu, when } from './words.js';
import { scopePills } from './token-piece.js';
import { allowance, card, connectBox, line, secretBox } from './workspace-cards.js';

/** A token as one row: its name and marks, when it was last used, and Revoke in its menu. */
export function tokenRow(t, { me, personName, then, fail }) {
  const mine = t.id === me.actor.token;
  const tip = [
    t.entity_id && (personName(t.entity_id) ?? t.entity_id),
    t.hint,
    t.last_used ? `Last used ${when(t.last_used)}` : 'Never used',
    t.seen?.length && `from ${t.seen.join(', ')}`,
    t.expires_at ? `Expires ${when(t.expires_at)}` : t.kind === 'agent' && 'Never expires',
  ];
  const revoke = async () => (await ask({ title: `Revoke the token "${t.name}"?`, message: 'Whoever uses it is signed out at once.', action: 'Revoke', danger: true })) && api('token_revoke', { id: t.id }).then(then, fail);
  return line(
    h('span', { class: 'grow', title: tip.filter(Boolean).join('\n') }, h('strong', {}, t.name), ' ', h('span', { class: 'muted small' }, t.last_used ? ['used ', ago(t.last_used)] : 'never used')),
    t.admin && h('span', { class: 'pill' }, 'admin'),
    mine && h('span', { class: 'pill ok' }, 'this session'),
    scopePills(t),
    mine ? h('span', { class: 'menu-room' }) : menu('⋯', [['Revoke', revoke, 'danger']]),
  );
}

/** The agent tokens, and connecting another: a name, how long it lasts, Connect; the bare token in the menu. */
export function tokensCard({ tokens, row, then, fail, say }) {
  const name = h('input', { type: 'text', placeholder: 'Name (claude-code)', style: 'flex: 1; min-width: 0' });
  // A new agent token ends by itself unless it is said not to. One within an item is made on that item's page.
  const life = h('select', { title: 'When the token stops working by itself' }, [[90, '90 days'], [30, '30 days'], [365, 'A year'], [0, 'Never expires']].map(([days, label]) => h('option', { value: days }, label)));
  const token = (fallback) => ({ kind: 'agent', name: name.value.trim() || fallback, ...(Number(life.value) > 0 && { expires_days: Number(life.value) }) });
  const make = (fallback, show) => api('token_create', token(fallback)).then((made) => then().then(() => say(show(made))), fail);
  return card(
    'Agent tokens',
    'An agent with one of these acts for you: it sees what you see and proposes to you.',
    h('ul', { class: 'rows' }, tokens.map(row)),
    h(
      'div',
      { class: 'toolbar', style: 'padding: var(--space-6) 0; flex-wrap: nowrap' },
      name,
      life,
      h('button', { class: 'primary', style: 'white-space: nowrap', onclick: () => make('claude-code', connectBox) }, 'Connect an agent'),
      menu('⋯', [['Token only', () => make('agent', (made) => secretBox(`Token for ${made.name}`, made.token))]]),
    ),
  );
}

/** What the owner lets agents do: whether their changes wait, and the three things each asked for in turn. */
export function agentsMayCard(info, then, fail) {
  return card(
    'What agents may do',
    'Every change is in the log with who made it and why, and can be undone.',
    h(
      'ul',
      { class: 'rows' },
      line(
        h('span', { class: 'grow', title: 'Held, the answer to a decision or a hypothesis waits for you too. Taking effect, an agent can settle one: it has to say what was chosen and why, and you are notified on Home.' }, 'Their changes'),
        h('select', { onchange: (e) => api('workspace_set', { agent_changes: e.target.value }).then(then, fail) }, [['hold', 'Wait for you'], ['apply', 'Take effect']].map(([v, label]) => h('option', { value: v, selected: v === info.agent_changes }, label))),
      ),
      allowance(info, 'agent_publish', 'Publish documents', 'Lets an agent call publish and publish_all. Unpublishing stays a human’s.', { title: 'Let agents publish?', message: 'An agent could then make a document public, for anyone to read, without asking you. Each publish is logged; taking one down stays yours.' }),
      allowance(info, 'agent_code', 'Change drawings', 'Lets an agent’s change to a style’s modules or code take effect without your approval.', { title: 'Let agents change drawings?', message: 'An agent could then change the code a view is drawn by, and it takes effect at once for whoever looks. It runs in the sandbox, reaching nothing of the page or the network; each change is logged and can be undone.' }),
      allowance(info, 'agent_backups', 'Download backups', 'Lets an agent call backup_download. A backup holds private items too.', { title: 'Let agents download backups?', message: 'A backup holds the whole map, private items included. An agent with your token could then read all of it.' }),
    ),
  );
}

/** A rule that asks an agent at its reply's end (on its pack's card): how often it asked this week, and its switch. */
export function checkRow(r) {
  const on = h('input', { type: 'checkbox', checked: !r.off, title: 'On: it asks an agent whose reply did what it names' });
  const name = h('span', { class: 'grow', title: `A check: once a turn, it asks an agent whose reply did what it names.\n${r.say}` }, h('strong', {}, r.rule.split('.').pop().replaceAll('_', ' ')), ' ', h('span', { class: 'muted small' }, 'a check on replies'));
  on.onchange = () => api('workspace_set', { lifted: { [r.lifted]: !on.checked } }).catch((err) => ((on.checked = !on.checked), (name.title = err.message)));
  return line(name, h('span', { class: 'pill', title: `Asked ${r.asked} time${r.asked === 1 ? '' : 's'} in the last week` }, String(r.asked)), on);
}
