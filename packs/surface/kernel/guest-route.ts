// A guest map from one click, and the link its agent writes to (the owner, 13 Nov 2026, e_4bsagguk):
//   POST /guest        makes a guest map (packs/identity/kernel/guests.ts) with no account, and answers with the link
//                      for the visitor's agent, the sentence to paste into it, and a token the page reads the map with
//   GET  /g/<key>      what the agent reads first: a few plain lines on what to write, and how (./guest-words.ts)
// The key is an agent token of that map alone, so the agent writes as any agent does, POST /agent/change with the key
// as its bearer: there is no second write path. Its changes apply at once, as on every new map, which begins applying
// agents' changes (packs/rules/kernel/open.ts) and has nobody to hold them for: a guest approves nothing, since the
// agent's own permission prompts already ask (the owner, 13 Nov 2026, e_qn8a9pcs).
// Both answer before the server's own routes (./surface-slots.ts), counted against the address's open limit.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createToken, verifyToken, workspaceOf } from '../../identity/kernel/auth.ts';
import { GUEST_DAYS, GUEST_GRACE_DAYS, guestOf, guestStanding, isGuestId, markGuest, newGuestId } from '../../identity/kernel/guests.ts';
import type { Workspaces } from '../../identity/kernel/workspaces.ts';
import { json, PRIVATE, UNLISTED } from './reply.ts';
import type { RouteFilling } from './surface-slots.ts';
import { guestPrompt, guestWords } from './guest-words.ts';

/** Where the request reached this server: what the link and the instructions name. */
const originOf = (req: IncomingMessage) => {
  const host = String(req.headers.host ?? '127.0.0.1');
  const local = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
};

/** Make a guest map, noted as one from the start: one made ahead and never taken ends as any guest map does. */
async function makeGuest(workspaces: Workspaces): Promise<string> {
  const id = newGuestId();
  await workspaces.create(id, 'Guest map');
  await markGuest(await workspaces.control(), id);
  return id;
}

/** One guest map made ahead on each server, from its first click on: making one takes seconds the visitor would wait. */
const ahead = new WeakMap<Workspaces, Promise<string | undefined>>();
const makeAhead = (workspaces: Workspaces) => void ahead.set(workspaces, makeGuest(workspaces).catch((err: Error) => (console.error(`guest map made ahead: ${err.message}`), undefined)));

const text = (res: ServerResponse, status: number, body: string) => res.writeHead(status, { ...UNLISTED, 'content-type': 'text/plain; charset=utf-8' }).end(body);

export const guestMake: RouteFilling = {
  method: 'POST',
  path: /^\/guest$/,
  serve: async (req, res, _match, { workspaces, tooOften }) => {
    if (tooOften('open')) return;
    // A page of another site cannot send this without asking first, and is not answered when it asks.
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'Send it as application/json.' }, PRIVATE);
    // The map made ahead is taken before anything is awaited, so two clicks never get the same one.
    const spare = ahead.get(workspaces);
    makeAhead(workspaces);
    const id = (await spare) ?? (await makeGuest(workspaces)), control = await workspaces.control();
    const ws = await workspaces.get(id);
    const done = workspaces.hold(id);
    try {
      const guest = await markGuest(control, id); // its days count from the click, not from when it was made
      const days = GUEST_DAYS + GUEST_GRACE_DAYS;
      const agent = await createToken(ws.pelago.db, id, { kind: 'agent', name: 'guest agent', expires_days: days });
      const page = await createToken(ws.pelago.db, id, { kind: 'agent', name: 'guest page', expires_days: days, may: 'read' });
      const link = `${originOf(req)}/g/${agent.token}`;
      return json(res, 200, { result: { workspace: { id, name: ws.name }, link, prompt: guestPrompt(link), page_token: page.token, expires_at: guest.expires_at } }, PRIVATE);
    } finally {
      done();
    }
  },
};

export const guestLink: RouteFilling = {
  method: 'GET',
  path: /^\/g\/([^/]+)$/,
  serve: async (req, res, [, key], { workspaces, tooOften }) => {
    if (tooOften('open')) return;
    const id = workspaceOf(key);
    // The same answer for a key that is wrong, unknown, run out or of a map that is not a guest's: nothing to probe.
    const gone = () => text(res, 404, 'This guest link is not good, or has run out. Ask your user for a new one.\n');
    if (!id || !isGuestId(id) || !(await workspaces.has(id))) return gone();
    res.once('close', workspaces.hold(id));
    const ws = await workspaces.get(id), who = await verifyToken(ws.pelago.db, key);
    if (!who || who.actor.kind !== 'agent' || who.actor.may === 'read') return gone();
    const ended = guestStanding(await guestOf(await workspaces.control(), id))?.ended;
    if (ended) return text(res, 410, `This guest map ended on ${ended.since.slice(0, 10)} and takes no more writes. Tell your user: signing in keeps a map; this one is deleted on ${ended.delete_at.slice(0, 10)}.\n`);
    return text(res, 200, guestWords(originOf(req), key, id));
  },
};
