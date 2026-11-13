// The Workspace screen: setting the workspace up, in five sections shown one at a time. People: who is in it. Agents:
// what is connected, how to connect another, and what they may do. Map: its theme, whether new things start private,
// its backup. Packs: what it is made of, each pack's card holding everything that pack offers, and above them what this
// server can connect it to (the GitHub App, say). Which is open is kept in the address (#/workspace?at=map); a step of Start here (ui/start.js)
// names a card, and lands on its section with that card in view.

import { api, ask, drawSlots, h, may, part, state, whoami } from './base.js';
import { screenRows } from './nav.js';
import { themesCard } from './themes-card.js';
import { packsCard } from './packs.js';
import { membersCard } from './members-card.js';
import { limitsCard } from './limits-card.js';
import { connectionsCard } from './connections-card.js';
import { agentsMayCard, drawingsOpenRow, tokenRow, tokensCard } from './agents-card.js';
import { connectCard, connecting, isConnecting } from './connect-agent.js';
import { workspacesCard } from './workspaces-card.js';
import { backupCard, card, islandsRow, ownerRow, serverPacksCard, visibilityRow } from './workspace-cards.js';

const SECTIONS = [
  ['people', 'People', 'Who is in this workspace'],
  ['agents', 'Agents', 'The agents connected, how to connect one, and what they may do'],
  ['map', 'Map', 'Its theme, whether new things start private, and its backup'],
  ['packs', 'Packs', 'The ways of working it is made of, what each offers, and what this server can connect'],
];
/** The section each card a step of Start here names is in. */
const CARD_IN = { team: 'people', agent: 'agents', backup: 'map', connections: 'packs', github: 'packs' };
/** Sections by the names they had before (27 Oct 2026), for an address kept from then; Connections went into Packs on 10 Nov 2026. */
const WAS = { look: 'map', outside: 'packs' };

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
  // Settings change the workspace: a session that may only read has none to show.
  if (!may('write')) return main.replaceChildren(h('div', { class: 'empty' }, 'Read only'));
  const me = await whoami();
  const tokensOn = me?.auth === 'tokens';
  const admin = may('admin');
  const [info, tokens, people, members] = await Promise.all([
    api('workspace_info'),
    tokensOn ? api('token_list') : [],
    tokensOn ? api('search', { type: 'person', limit: 200 }) : [],
    tokensOn && admin ? api('member_list') : [],
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
  const agents = live.filter((t) => t.kind === 'agent');
  if (step === 'agent') connecting(true);
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
      // With sign-in, the owner is whoever the workspace was made for, by their address (marked under Members); with
      // none, the person at this machine says who they are here.
      !tokensOn && card('Owner', null, h('ul', { class: 'rows' }, ownerRow(info.owner, workspace))),
      tokensOn && admin && limitsCard(info.member_limit, info.use, info.ended),
      // A workspace for one person (its limit is one, and it has no more) has no members to manage.
      tokensOn && admin && !(info.member_limit?.members === 1 && members.length <= 1) && at('team', membersCard({ me, owner: info.owner?.id, members, others: live.filter((t) => t.kind === 'human' && !members.some((m) => m.person_id === t.entity_id)), tokenRow: row, then: workspace, fail, say })),
    ],
    // What is connected first; the steps to connect another only once asked for (or a step of Start here leads to them).
    agents: () => [
      tokensOn && tokensCard({ tokens: agents, row, then: workspace, fail, say, workspace: me.workspace, connect: !isConnecting() && (() => (connecting(true), workspace())) }),
      tokensOn && isConnecting() && at('agent', connectCard({ tokens: agents, then: workspace, workspace: me.workspace.id })),
      admin && agentsMayCard(info, workspace, fail),
    ],
    map: () => [themesCard(workspace), at('backup', backupCard(workspace, visibilityRow(info, workspace, fail), islandsRow(info, workspace, fail), admin && drawingsOpenRow(info)))],
    packs: () => [at('connections', connectionsCard()), packsCard({ info, then: workspace, goTo: go }), own.length > 0 && card('Your screens', 'Screens you made, which no pack offers', h('ul', { class: 'rows' }, screenRows(own, workspace))), me.workspace.id === 'default' && serverPacksCard(), me.workspace.id === 'default' && tokensOn && admin && workspacesCard(me.workspace.id)],
  };
  // What a person who is not an admin may change is only their own agent tokens.
  const shown = SECTIONS.filter(([key]) => admin || (key === 'agents' && tokensOn) || (key === 'people' && !tokensOn && !info.owner));
  if (!shown.some(([key]) => key === open)) open = shown[0]?.[0] ?? 'agents';
  const grid = h('div', { class: 'grid' }, sections[open]());
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Settings'), h('p', { class: 'muted' }, me.workspace.name, ' ', admin && me.workspace.id !== 'default' && h('a', { href: '#/workspace', title: 'Give this workspace another name', onclick: rename }, 'Rename'))),
    // A member who is no admin has one section: no switch, and nothing in its place (replaceChildren would write "false").
    ...(shown.length > 1 ? [h('div', { class: 'switch ws-sections', role: 'tablist' }, shown.map(([key, label, tip]) => h('button', { class: key === open ? 'on' : '', role: 'tab', title: tip, onclick: () => go(key) }, label)))] : []),
    h('div', { class: 'ws-notice' }, notice),
    grid,
  );
  // What other packs say on this workspace, each a part of its own under the cards this screen draws (slot
  // workspace.card). None fills it until its pack's cluster lands, and then nothing is added here.
  void drawSlots(grid, { slot: 'workspace.card', piece: { workspace: me.workspace.id }, redraw: workspace });
  // Brought into view only as far as it must be, so the page's head and its sections stay in sight above it.
  if (step) setTimeout(() => main.querySelector(`[data-at="${CSS.escape(step)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 400);
}
