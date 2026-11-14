// What this server offers to connect a workspace to, as the connect pack's card on the Workspace page (slot
// workspace.card, in its Packs section; from packs/identity/page/connections-card.js, task e_s7mfcvp6). Each a server
// pack (the GitHub App, say), one row each: whether it is connected here and to which account outside, and the one
// action that comes next (set it up for the server, connect, or choose again what it is given); disconnecting, rarely,
// in a menu, asked again before it goes.
//
// Connecting and disconnecting are an admin's (connect.start, connect.end): the host sends them only on an admin's own
// press, and the server takes that press's grant once (decision e_ssrawn4v). The part is told whether the person may
// (`admin`) so it offers them only to an admin; whoever else it offered them to would be refused. Where to go to connect
// comes back as an address, drawn as a link that opens it apart: a part never moves the page off the map.

/** The Workspace page's section this card stands in. */
const SECTION = 'packs';

const cut = (s, n = 60) => String(s ?? '').slice(0, n);

/** One pack's row. `at` is what the card holds: the pack whose action is going out, the address to go on to, the one asked about. */
export function packRow(p, admin, at) {
  const title = cut(p.title || p.pack);
  const state = p.connected ? 'connected' : p.ready ? 'not connected' : 'not set up';
  const mark = ['text', { look: 'mark', ...(p.connected && { tone: 'ok' }) }, state];
  const name = ['box', { flow: 'row', gap: 3, grow: true },
    ['text', { look: 'body', bold: true, tip: cut(p.name ?? p.title, 200) }, title],
    ...(p.connected?.account ? [['text', { look: 'muted', size: 2 }, cut(p.connected.account)]] : []),
  ];
  const act = !admin ? [] : at.busy === p.pack
    ? [['text', { look: 'mark', tone: 'muted', tip: 'Going out' }, '…']]
    : at.go?.pack === p.pack
      ? [['text', { look: 'body', href: at.go.url, tip: `Opens ${title} apart: choose there what it is given` }, `Go on to ${title}`]]
      : at.ending === p.pack
        ? [['button', { key: `end:${p.pack}`, tone: 'bad', tip: `What ${title} hears no longer reaches this map. It stays where it was chosen outside until it is removed there.` }, 'Disconnect'],
          ['button', { key: 'keep', look: 'quiet', tip: 'Leave it connected' }, 'Keep']]
        : p.connected
          ? [['button', { key: `start:${p.pack}`, tip: `Choose again what ${title} is given` }, 'Choose'],
            ['menu', { label: 'More' }, ['button', { key: `ask-end:${p.pack}`, tone: 'bad', tip: `Disconnect ${title}` }, 'Disconnect']]]
          : p.ready
            ? [['button', { key: `start:${p.pack}`, look: 'main', tip: `Choose what ${title} is given; what it hears reaches this map from then on` }, 'Connect']]
            : p.can_setup
              ? [['button', { key: `setup:${p.pack}`, look: 'main', tip: `Once for this server: ${title} is made, and every workspace can connect it` }, 'Set up']]
              : [];
  return ['box', { key: `p:${p.pack}`, flow: 'row', gap: 4, align: 'center' }, mark, name, ...act];
}

/** The card's marks: nothing outside its section, or where this server offers nothing to connect. */
export function marks(input, packs, at) {
  const section = input?.piece?.section;
  if (section !== undefined && section !== SECTION) return ['box', {}];
  if (!packs.length && !at.failed) return ['box', {}];
  return ['box', { look: 'band', flow: 'column', gap: 4, pad: 6, key: 'connections' },
    ['text', { look: 'title', tip: 'What this server can connect to this map, each chosen outside and heard from here.' }, 'Connections'],
    ...(at.failed ? [['text', { tone: 'bad', tip: cut(at.failed, 300) }, cut(at.failed, 80)]] : []),
    ['list', { look: 'rows' }, ...packs.map((p) => packRow(p, Boolean(input?.admin), at))],
  ];
}

export default function connections(input, tools) {
  let now = input, packs = input?.views?.connections?.packs ?? [];
  const at = { busy: null, go: null, ending: null, failed: null };
  const draw = () => marks(now, packs, at);

  /** Send an admin's action for a pack, as this press's; the list it answers with is drawn. */
  async function send(action, pack, params) {
    Object.assign(at, { busy: pack, go: null, ending: null, failed: null });
    tools.marks(draw());
    const said = await tools.act(action, { pack, ...params });
    at.busy = null;
    if (said?.error) at.failed = String(said.error);
    else {
      if (Array.isArray(said?.answer?.packs)) packs = said.answer.packs;
      if (said?.answer?.url) at.go = { pack, url: String(said.answer.url) };
    }
    return draw();
  }

  return {
    marks: draw(),
    update(next) {
      now = next;
      packs = next?.views?.connections?.packs ?? packs;
      return draw();
    },
    async on(event) {
      if (event?.name !== 'press') return undefined;
      const [, what, pack] = /^(start|setup|end|ask-end):(.+)$/.exec(event.key ?? '') ?? [];
      if (event.key === 'keep') return ((at.ending = null), draw());
      if (!pack || !packs.some((p) => p.pack === pack)) return undefined;
      if (what === 'ask-end') return ((at.ending = pack), (at.go = null), draw());
      if (what === 'end') return send('connect.end', pack, {});
      return send('connect.start', pack, what === 'setup' ? { setup: true } : {});
    },
  };
}
