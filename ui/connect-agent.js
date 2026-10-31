// Connecting an agent, step by step: the person says which client they use and is shown that client's own steps, a row
// each, with the address to copy and the place to go. No client takes a link that fills the address in except where
// a step says so. The page then watches for the connection and says when it lands, with a first thing to ask.

import { api, h } from './base.js';
import { card, line } from './workspace-cards.js';

const address = () => `${location.origin}/mcp`;
/** A client run by its maker, not on this machine, cannot reach a server on this machine. */
const onThisMachine = () => /^(localhost|127\.|\[::1\])/.test(location.hostname);
const FIRST_ASK = 'Put this project in Archipelago, with the three things I am working on as tasks, and tell me what you would do first.';

const cursorInstall = () => `cursor://anysphere.cursor-deeplink/mcp/install?name=archipelago&config=${encodeURIComponent(btoa(JSON.stringify({ type: 'http', url: address() })))}`;

// Each client's steps: its words, then what the row offers (copy, or open a place) and the rest of it in a tooltip.
const CLIENTS = [
  {
    id: 'claude',
    name: 'Claude',
    label: 'Claude (web or desktop app)',
    hosted: true,
    steps: () => [
      ['Copy this address', { copy: address() }],
      ['Open Claude’s connectors', { open: 'https://claude.ai/customize/connectors', label: 'Open' }, 'Customize → Connectors, the same for the web and the desktop app'],
      ['Choose Add, then Custom, then Web'],
      ['Name it Archipelago and paste the address', null, 'Then Continue. Leave the rest as Claude sets it, and choose Add.'],
      ['Sign in here when asked, then Allow'],
    ],
  },
  {
    id: 'claude-team',
    name: 'Claude',
    label: 'Claude for a Team or Enterprise plan',
    hosted: true,
    steps: () => [
      ['Copy this address', { copy: address() }],
      ['An Owner opens the organization’s connectors', { open: 'https://claude.ai/admin-settings/connectors', label: 'Open' }, 'Organization settings → Connectors. Only an Owner can add one.'],
      ['Choose Add, then Custom, paste it, and Add', null, 'Choose Web if it asks for the type.'],
      ['Each person opens their connectors', { open: 'https://claude.ai/customize/connectors', label: 'Open' }],
      ['Choose Connect, sign in here, then Allow'],
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    label: 'Claude Code',
    steps: () => [
      ['Run this in a terminal', { copy: `claude mcp add --transport http --scope user archipelago ${address()}`, show: true }],
      ['In Claude Code, type /mcp', null, 'Choose archipelago from the list.'],
      ['Sign in here when asked, then Allow'],
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    label: 'Cursor',
    steps: () => [
      ['Add it to Cursor', { open: cursorInstall(), label: 'Add', same: true }, 'Opens Cursor, which asks you to confirm. If nothing happens, update Cursor.'],
      ['In Cursor’s MCP list, choose Connect'],
      ['Sign in here when asked, then Allow'],
    ],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    label: 'VS Code',
    steps: () => [
      ['Copy this address', { copy: address() }],
      ['In the Command Palette, run MCP: Add Server', { copy: 'MCP: Add Server', label: 'Copy name' }, 'Ctrl+Shift+P, or Cmd+Shift+P on a Mac'],
      ['Choose HTTP and paste the address', null, 'Name it archipelago, and choose Global to have it in every project.'],
      ['Sign in here when asked, then Allow'],
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    label: 'ChatGPT',
    hosted: true,
    steps: () => [
      ['Copy this address', { copy: address() }],
      ['Add a custom MCP server in ChatGPT', { open: 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt', label: 'Steps' }, 'ChatGPT adds these under Plugins, and what each plan may do is set by OpenAI: its page has the current steps.'],
      ['Sign in here when asked, then Allow'],
    ],
  },
  {
    id: 'other',
    name: 'Your agent',
    label: 'Another client',
    steps: () => [
      ['Copy this address', { copy: address() }],
      ['Add it as a remote MCP server', null, 'Look for MCP or connectors in its settings. Choose HTTP, or streamable HTTP, if it asks.'],
      ['Sign in here when asked, then Allow', null, 'A client that cannot sign in takes a token instead: With a token, below.'],
    ],
  },
];

/** What the card remembers while the page is drawn again: the client chosen, and the name of one that has just landed. */
const chosen = { client: 'claude', landed: null };

const copyButton = (text, label = 'Copy') => h('button', { class: 'primary', onclick: (e) => navigator.clipboard.writeText(text).then(() => (e.target.textContent = 'Copied')) }, label);
const openButton = ({ open, label, same }) => h('a', { class: 'button', href: open, ...(!same && { target: '_blank', rel: 'noopener' }) }, label);

function stepRow(n, [words, action, tip]) {
  const text = h('span', { class: 'grow gist', style: 'min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis', title: tip ?? words }, h('span', { class: 'muted' }, `${n}  `), words);
  const row = line(text, action?.copy && copyButton(action.copy, action.label), action?.open && openButton(action));
  return action?.copy && (action.show || action.copy === address()) ? [row, line(h('code', { class: 'muted small gist', style: 'min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis', title: action.copy }, action.copy))] : [row];
}

/** Ask every few seconds whether a new connection has landed, for as long as this card is on the page. */
function watchFor(status, client, known, landed) {
  let asked = 0;
  const tick = async () => {
    if (!status.isConnected) return;
    const tokens = await api('token_list').catch(() => null);
    const fresh = tokens?.find((t) => t.client && !t.revoked_at && !known.has(t.id));
    if (fresh) return landed(fresh);
    if (++asked === 60) status.replaceChildren(h('span', { class: 'muted gist', title: `If ${client.name} says it cannot connect, check the address ends in /mcp, remove the connector and add it again.` }, `Nothing from ${client.name} yet. Check the address ends in /mcp.`));
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

function connectedRows(name) {
  return [
    line(h('strong', { class: 'grow gist' }, `✓ ${name} is connected`)),
    line(h('span', { class: 'grow gist', title: FIRST_ASK }, 'Ask it something to try it'), copyButton(FIRST_ASK, 'Copy a first ask')),
  ];
}

/** The card: which client, its steps, and whether it has landed yet. */
export function connectCard({ tokens, then }) {
  const known = new Set(tokens.map((t) => t.id));
  const client = CLIENTS.find((c) => c.id === chosen.client) ?? CLIENTS[0];
  const status = h('span', { class: 'grow' }, h('span', { class: 'muted gist' }, `Waiting for ${client.name}…`));
  const pick = h('select', { title: 'The app your agent runs in', onchange: (e) => ((chosen.client = e.target.value), (chosen.landed = null), then()) }, CLIENTS.map((c) => h('option', { value: c.id, selected: c.id === client.id }, c.label)));
  if (!chosen.landed)
    watchFor(status, client, known, (fresh) => {
      chosen.landed = fresh.name;
      then();
    });
  return card(
    'Connect an agent',
    null,
    h(
      'ul',
      { class: 'rows' },
      line(h('span', { class: 'grow' }, 'Your agent'), pick),
      client.hosted && onThisMachine() && line(h('span', { class: 'error grow gist', style: 'padding: 0', title: `${client.name} runs on its maker’s servers, which cannot reach a server on this machine.` }, `${client.name} cannot reach this machine`)),
      client.steps().flatMap((step, i) => stepRow(i + 1, step)),
      chosen.landed ? connectedRows(chosen.landed) : line(status),
    ),
  );
}
