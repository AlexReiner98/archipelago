// The Workspace screen's Agents section: the tokens agents act with, what the owner lets them do, and the checks that
// ask an agent at its reply's end. Each token, permission and check is one row; what is done rarely is in a menu.

import { api, ask, h, may } from './base.js';
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
    t.client ? 'Connected by signing in, until you revoke it' : t.expires_at ? `Expires ${when(t.expires_at)}` : t.kind === 'agent' && 'Never expires',
  ];
  const revoke = async () => (await ask({ title: `Revoke the token "${t.name}"?`, message: 'Whoever uses it is signed out at once.', action: 'Revoke', danger: true })) && api('token_revoke', { id: t.id }).then(then, fail);
  return line(
    h('span', { class: 'grow', title: tip.filter(Boolean).join('\n') }, h('strong', {}, t.name), ' ', h('span', { class: 'muted small' }, t.last_used ? ['used ', ago(t.last_used)] : 'never used')),
    t.admin && h('span', { class: 'muted small' }, 'admin'),
    // A person token (src/person-tokens.ts): one for every workspace its person is a member of, by these addresses.
    t.everywhere && h('span', { class: 'muted small', title: `Acts as you in every workspace you are a member of, as ${t.emails.join(', ')}; at home in ${t.home}. Revoking it ends it in all of them.` }, 'all workspaces'),
    mine && h('span', { class: 'muted small', title: 'The token this browser is signed in with' }, 'this browser'),
    scopePills(t),
    mine || !may('write') ? h('span', { class: 'menu-room' }) : menu('⋯', [['Revoke', revoke, 'danger']]),
  );
}

/** What a token made for Claude Code's setup is named unless the person names it: the actor its hooks act as (the claude_code pack's adapter.before.actor). */
const SETUP_NAME = 'claude-code';

/**
 * What is connected, first: a row each, or a line saying none is. Connect an agent opens the steps under it
 * (ui/connect-agent.js). The older way in, folded: a token, for Claude Code's hooks or a client that cannot sign in.
 */
export function tokensCard({ tokens, row, then, fail, say, workspace, connect }) {
  // Named on the button and in the box that shows the token: one browser may be signed in to two workspaces.
  const name = h('input', { type: 'text', placeholder: `Name (${SETUP_NAME})`, style: 'flex: 1 1 0; min-width: 0' });
  // A new agent token ends by itself unless it is said not to. One within an item is made on that item's page.
  const life = h('select', { title: 'When the token stops working by itself' }, [[90, '90 days'], [30, '30 days'], [365, 'A year'], [0, 'Never expires']].map(([days, label]) => h('option', { value: days }, label)));
  const token = (fallback, everywhere) => ({ kind: 'agent', name: name.value.trim() || fallback, ...(Number(life.value) > 0 && { expires_days: Number(life.value) }), ...(everywhere && { everywhere: true }) });
  const make = (fallback, show, everywhere) => api('token_create', token(fallback, everywhere)).then((made) => then().then(() => say(show(made))), fail);
  const box = card(
    'Agents',
    'Each acts for you: it sees what you see and proposes to you.',
    h('ul', { class: 'rows' }, tokens.length ? tokens.map(row) : line(h('span', { class: 'muted grow' }, 'None connected yet'))),
    // Making a token is a write: drawn only where this session may.
    may('write') && h(
      'details',
      { class: 'fold-bar' },
      h('summary', { class: 'muted small', title: 'For Claude Code’s sessions and hooks, or a client that cannot sign in through the browser' }, 'With a token'),
      h(
        'div',
        { class: 'toolbar', style: 'padding: var(--space-6) 0; flex-wrap: nowrap' },
        name,
        life,
        h('button', { class: 'gist cut', style: 'flex: 0 1 auto', title: `Claude Code setup: a command that sets up Claude Code in a project, with sessions on the map of ${workspace.name} (${workspace.id})`, onclick: () => make(SETUP_NAME, (made) => connectBox(made, workspace)) }, `Set up in ${workspace.name}`),
        menu('⋯', [
          [`Token only, for ${workspace.name}`, () => make('agent', (made) => secretBox(`Token for ${made.name}, in ${workspace.name}`, made.token, workspace))],
          // One token for every workspace you are a member of: a call names its workspace, else it acts here.
          ['Set up for all my workspaces', () => make(SETUP_NAME, (made) => connectBox(made, null), true)],
        ]),
      ),
    ),
  );
  if (connect && may('write')) box.querySelector('header').append(h('span', { class: 'grow' }), h('button', { class: 'primary', title: 'Pick the app your agent runs in and follow its steps', onclick: connect }, 'Connect an agent'));
  return box;
}

/**
 * How far an agent's change goes unasked, one choice of three: it waits for you, it takes effect (the kernel's rules
 * still hold settling, code, what is public and forget), or nothing holds it (holds_off).
 */
const REACH = [
  ['hold', 'Wait for you', { agent_changes: 'hold', holds_off: false }],
  ['apply', 'Take effect', { agent_changes: 'apply', holds_off: false }],
  ['all', 'Take effect, all of them', { agent_changes: 'apply', holds_off: true }],
];
const REACH_TIP = 'Wait for you: each change is a proposal you approve. Take effect: it applies as made, but settling a question, code that runs, what is public and forget still wait. All of them: nothing waits, a forget included, which cannot be undone. Every change is in the log with who made it and why.';

/** What the owner lets agents do: how far their changes go unasked, and three things each allowed in turn. */
export function agentsMayCard(info, then, fail) {
  // What agents may do is the workspace's setting: an admin's to change.
  if (!may('admin')) return null;
  const now = info.holds_off ? 'all' : info.agent_changes;
  const reach = h('select', { title: REACH_TIP }, REACH.map(([v, label]) => h('option', { value: v, selected: v === now }, label)));
  reach.onchange = async () => {
    const [v, , set] = REACH.find(([key]) => key === reach.value);
    if (v === 'all' && !(await ask({ title: 'Let every change take effect?', message: 'No rule holds an agent’s change any more: settling, code, what is public and forget take effect at once, and a forget cannot be undone.', action: 'Allow', danger: true }))) return void (reach.value = now);
    api('workspace_set', set).then(then, fail);
  };
  return card(
    'What agents may do',
    null,
    h(
      'ul',
      { class: 'rows' },
      line(h('span', { class: 'grow', title: REACH_TIP }, 'Their changes'), reach),
      allowance(info, 'agent_code', 'Change drawings', 'Their changes to a style’s or a layout’s code take effect without you. The code runs in the sandbox unless drawings run unsandboxed (Map).', { title: 'Let agents change drawings?', message: 'An agent’s change to the code a view is drawn by then takes effect at once for whoever looks. Each is logged and can be undone.' }),
      allowance(info, 'agent_publish', 'Publish documents', 'They may make a document public. Taking one down stays yours.', { title: 'Let agents publish?', message: 'An agent could then make a document public, for anyone to read, without asking you. Each publish is logged.' }),
      allowance(info, 'agent_backups', 'Download backups', 'They may download the whole map as a file, private items included.', { title: 'Let agents download backups?', message: 'A backup holds the whole map, private items included. An agent with your token could then read all of it.' }),
    ),
  );
}

/** Whether a drawing's code runs outside the sandbox, for whoever looks: a row of the Map section. */
export const drawingsOpenRow = (info) =>
  allowance(info, 'drawings_open', 'Drawings unsandboxed', 'A style’s own code runs in this page, as whoever looks: it may fetch from anywhere, load web fonts, open links, take and give files, and read and change the map as that person. Off, it runs walled in, reaching nothing.', { title: 'Run drawings without the sandbox?', message: 'A style’s code then runs as whoever looks at it, with their sign-in: it can reach the network and do anything they can do here. Agents’ changes to that code still wait for you unless Change drawings is on.' });

/** A rule that asks an agent at its reply's end (on its pack's card): how often it asked this week, and its switch. */
export function checkRow(r) {
  const on = h('input', { type: 'checkbox', checked: !r.off, disabled: !may('admin'), title: 'On: it asks an agent whose reply did what it names' });
  const name = h('span', { class: 'grow', title: `A check: once a turn, it asks an agent whose reply did what it names.\n${r.say}` }, h('strong', {}, r.rule.split('.').pop().replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())), ' ', h('span', { class: 'muted small' }, 'a check on replies'));
  on.onchange = () => api('workspace_set', { lifted: { [r.lifted]: !on.checked } }).catch((err) => ((on.checked = !on.checked), (name.title = err.message)));
  // A check that counts: how many the reply must do before it asks, the owner's to set.
  const at = r.counts && h('input', { type: 'number', min: '1', step: '1', value: String(r.at), disabled: !may('admin'), style: 'width: var(--hours-field)', title: `Asks once a reply has done this many (${r.counts})` });
  if (at) at.onchange = () => api('workspace_set', { asks_at: { [r.lifted]: Number(at.value) } }).then(() => (r.at = Number(at.value))).catch((err) => ((at.value = String(r.at)), (at.title = err.message)));
  return line(name, ...(at ? [at] : []), h('span', { class: 'mark', title: `Asked ${r.asked} time${r.asked === 1 ? '' : 's'} in the last week` }, String(r.asked)), on);
}
