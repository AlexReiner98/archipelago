// The Workspace screen: setting the workspace up, in five sections shown one at a time. People: who is in it. Agents:
// what they act with, what they may do, and the model they run on. Map: its theme, whether new things start private,
// its backup. Packs: what it is made of, each pack's card holding everything that pack offers. Connections: what is tied
// to it from outside. Which is open is kept in the address (#/workspace?at=map); a step of Start here (ui/start.js)
// names a card, and lands on its section with that card in view.

import { api, ask, authHeaders, h, part, state } from './base.js';
import { screenRows } from './nav.js';
import { themesCard } from './themes-card.js';
import { packsCard } from './packs.js';
import { membersCard } from './members-card.js';
import { planCard } from './plan-card.js';
import { modelCard } from './model-card.js';
import { connectionsCard } from './connections-card.js';
import { agentsMayCard, tokenRow, tokensCard } from './agents-card.js';
import { connectCard } from './connect-agent.js';
import { backupCard, card, githubRow, notificationsRow, ownerRow, serverPacksCard, visibilityRow } from './workspace-cards.js';

const SECTIONS = [
  ['people', 'People', 'Who is in this workspace'],
  ['agents', 'Agents', 'What agents act with, what they may do, and the model they run on'],
  ['map', 'Map', 'Its theme, whether new things start private, and its backup'],
  ['packs', 'Packs', 'The ways of working it is made of, and what each offers'],
  ['connections', 'Connections', 'What is tied to it from outside'],
];
/** The section each card a step of Start here names is in. */
const CARD_IN = { team: 'people', agent: 'agents', model: 'agents', backup: 'map', connections: 'connections', github: 'connections' };
/** Sections by the names they had before (27 Oct 2026), for an address kept from then. */
const WAS = { look: 'map', outside: 'connections' };

/** The section open, and the card asked for, if any. */
let open = 'people';
function asked() {
  const at = new URLSearchParams(location.hash.split('?')[1] ?? '').get('at');
  if (at && SECTIONS.some(([key]) => key === at)) open = at;
  else if (at && (CARD_IN[at] || WAS[at])) open = CARD_IN[at] ?? WAS[at];
  history.replaceState(null, '', `#/workspace?at=${open}`);
  return at && CARD_IN[at] ? at : null;
}

/** A card a step of Start here leads to, as #/workspace?at=<step>. */
const at = (step, el) => (el && (el.dataset.at = step), el);

export async function workspace() {
  const main = part('workspace');
  const step = asked();
  const me = await (await fetch('/whoami', { headers: authHeaders() })).json();
  const tokensOn = me.auth === 'tokens';
  const admin = !tokensOn || me.actor.admin;
  const [info, tokens, people, members] = await Promise.all([
    api('workspace_info'),
    tokensOn ? api('token_list') : [],
    tokensOn ? api('search', { type: 'person', limit: 200 }) : [],
    tokensOn && me.actor.admin ? api('member_list') : [],
  ]);
  const notice = h('div');
  const fail = (err) => notice.replaceChildren(h('div', { class: 'error gist', title: err.message }, err.message));
  // A word at the top of the page once it is drawn again, brought into view from wherever the button was.
  // Said as (class, words), or as a box drawn whole (a new token's secret).
  const say = (what, text) => {
    const box = main.querySelector('.ws-notice');
    box?.replaceChildren(text === undefined ? what : h('div', { class: `${what} gist`, title: text }, text));
    box?.scrollIntoView({ block: 'center' });
  };
  const live = tokens.filter((t) => !t.revoked_at);
  const row = (t) => tokenRow(t, { me, personName: (id) => people.find((p) => p.id === id)?.title, then: workspace, fail });
  const rename = async (e) => {
    e.preventDefault();
    const name = await ask({ title: 'Rename this workspace', input: { placeholder: me.workspace.name }, action: 'Rename' });
    if (name?.trim()) api('workspace_set', { name: name.trim() }).then(() => location.reload(), (err) => fail(err.message));
  };
  const go = (key) => {
    open = key;
    history.replaceState(null, '', `#/workspace?at=${key}`);
    workspace();
  };
  // The owner's own screens, which no pack offers, are controlled under the packs.
  const own = (state.schema?.screens ?? []).filter((s) => !s.pack);

  // Each section drawn only when it is open: some of its cards read the server.
  const sections = {
    people: () => [
      (admin || !info.owner) && card('Owner', null, h('ul', { class: 'rows' }, ownerRow(info.owner, workspace))),
      tokensOn && me.actor.admin && planCard(info.member_limit, info.use, info.ended),
      // A workspace for one person (its limit is one, and it has no more) has no members to manage.
      tokensOn && me.actor.admin && !(info.member_limit?.members === 1 && members.length <= 1) && at('team', membersCard({ me, members, others: live.filter((t) => t.kind === 'human' && !members.some((m) => m.person_id === t.entity_id)), tokenRow: row, then: workspace, fail, say })),
    ],
    agents: () => [tokensOn && at('agent', connectCard({ tokens: live.filter((t) => t.kind === 'agent'), then: workspace })), tokensOn && tokensCard({ tokens: live.filter((t) => t.kind === 'agent'), row, then: workspace, fail, say }), admin && agentsMayCard(info, workspace, fail), admin && at('model', modelCard())],
    map: () => [themesCard(workspace), at('backup', backupCard(workspace, visibilityRow(info, workspace, fail)))],
    packs: () => [packsCard({ info, then: workspace, goTo: go }), own.length > 0 && card('Your screens', 'Screens you made, which no pack offers', h('ul', { class: 'rows' }, screenRows(own, workspace))), me.workspace.id === 'default' && serverPacksCard()],
    connections: () => [at('connections', connectionsCard(...githubRow(), notificationsRow(info, workspace, fail)))],
  };
  // What a person who is not an admin may change is only their own agent tokens.
  const shown = SECTIONS.filter(([key]) => admin || (key === 'agents' && tokensOn) || (key === 'people' && !info.owner));
  if (!shown.some(([key]) => key === open)) open = shown[0]?.[0] ?? 'agents';
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Workspace'), h('p', { class: 'muted' }, me.workspace.name, ' ', me.actor.admin && me.workspace.id !== 'default' && h('a', { href: '#/workspace', title: 'Give this workspace another name', onclick: rename }, 'Rename'))),
    shown.length > 1 && h('div', { class: 'switch ws-sections', role: 'tablist' }, shown.map(([key, label, tip]) => h('button', { class: key === open ? 'on' : '', role: 'tab', title: tip, onclick: () => go(key) }, label))),
    h('div', { class: 'ws-notice' }, notice),
    h('div', { class: 'grid' }, sections[open]()),
  );
  if (step) setTimeout(() => main.querySelector(`[data-at="${CSS.escape(step)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 400);
}
