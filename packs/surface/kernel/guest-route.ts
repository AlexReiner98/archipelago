// A guest map from one click, and the link its agent writes to (the owner, 13 Nov 2026, e_4bsagguk):
//   POST /guest        makes a guest map (packs/identity/kernel/guests.ts) with no account, empty or, given `from`, a
//                      copy of a shared map (./guest-copy.ts), and answers with the link for the visitor's agent, the
//                      sentence to paste into it, and the token the page acts as the map's owner with
//   GET  /g/<key>      what the agent reads first: a few plain lines on what to write, and how (./guest-words.ts)
//   GET  /guest/counts  for the operator: how many guest maps reached a first item, and how fast (e_neesnubg)
// The key is an agent token of that map alone, so the agent writes as any agent does, POST /agent/change with the key
// as its bearer: there is no second write path. Its changes apply at once, whatever they are: a guest map has holds off
// from the start, so nothing waits for a person, since the agent's own permission prompts already ask (the owner,
// 13 Nov 2026, e_qn8a9pcs). Its guest is its owner, a person called You; what waits for sign-in is ./guest-gate.ts.
// Both answer before the server's own routes (./surface-slots.ts), counted against the address's open limit.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { bearer, createToken, verifyToken, workspaceOf } from '../../identity/kernel/auth.ts';
import { GUEST_DAYS, GUEST_GRACE_DAYS, GUEST_ITEMS, guestCounts, guestOf, guestStanding, isGuestId, markGuest, newGuestId } from '../../identity/kernel/guests.ts';
import { HOLDS_OFF } from '../../rules/kernel/rules.ts';
import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { copyShared, sharedAt } from './guest-copy.ts';
import type { Workspaces } from '../../identity/kernel/workspaces.ts';
import { json, PRIVATE, UNLISTED } from './reply.ts';
import type { RouteFilling } from './surface-slots.ts';
import { guestPrompt, guestWords, INSTALL_TITLE, installNote } from './guest-words.ts';

/** Where the request reached this server: what the link and the instructions name. */
const originOf = (req: IncomingMessage) => {
  const host = String(req.headers.host ?? '127.0.0.1');
  const local = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
};

/** Make a guest map, noted as one from the start: one made ahead and never taken ends as any guest map does. */
async function makeGuest(workspaces: Workspaces): Promise<string> {
  const id = newGuestId();
  const ws = await workspaces.create(id, 'Guest map');
  await markGuest(await workspaces.control(), id);
  // Its guest is its owner, and nothing on it waits for a person.
  await ws.pelago.init(MAKER, { name: 'You' });
  await ws.pelago.db.query(`insert into setting (key, value) values ($1, 'true'::jsonb) on conflict (key) do update set value = excluded.value`, [HOLDS_OFF]);
  await ws.pelago.record('settings', 'pelago', [['+', 'setting', HOLDS_OFF, true]], 'A guest map: nothing waits for a person');
  return id;
}

/** The setting that keeps the id of the install note a guest map starts with: its agent is told it is there. */
const INSTALL = 'guest_install';

/**
 * The one item a guest map starts with: the install note, the sentence to paste and what happens next, opened in the
 * visitor's tab as the map opens (the owner, 14 Nov 2026: "it should already be seeded with the install document").
 * A document where the map's packs have the type, else a record, core's. Answers its id.
 */
async function seedInstall(l: Archipelago, actor: Actor, prompt: string, origin: string): Promise<string> {
  const type = l.registry.type('document') ? 'document' : 'record';
  // On the island of the pack its type is of, named: a copy of a shared map has several.
  const pack = l.registry.type(type)?.pack ?? 'core';
  const island = (await l.db.query<{ id: string }>(`select id from entity where type = 'island' and props->>'pack' = $1 and archived_at is null limit 1`, [pack])).rows[0]?.id;
  // Its page opens on its words, its head, fields, source and history each folded a click away: a style about it, as any item's page is shaped (the
  // owner, 14 Nov 2026: "Yes, hide them").
  const done = (await l.change(actor, {
    reason: 'The install note a guest map starts with',
    ops: [
      { op: 'create', ref: 'n', type, title: INSTALL_TITLE, body: installNote(prompt, origin), ...(island && { props: { island } }) },
      { op: 'create', ref: 's', type: 'style', title: 'The install note opens on its words', status: 'current', props: { page: { head: 'folded', fields: 'folded', source: 'folded', history: 'folded' } } },
      { op: 'link', type: 'about', from: 's', to: 'n' },
    ],
  } as never)) as { status: string; created?: Record<string, string> };
  const id = done.created?.n;
  if (done.status !== 'applied' || !id) throw new Error(`The install note was not made (${done.status}).`);
  await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [INSTALL, JSON.stringify(id)]);
  await l.record('settings', 'pelago', [['+', 'setting', INSTALL, id]], 'The install note a guest map starts with');
  return id;
}

/** Who makes a guest map: the server, for the visitor. */
const MAKER: Actor = { kind: 'human', name: 'guest map', admin: true };
/** The most a request to make one carries: where to copy from. */
const BODY_MOST = 4096;

/** The body of a request to make a guest map: { from } at most. */
async function asked(req: IncomingMessage): Promise<{ from?: unknown }> {
  let text = '';
  for await (const chunk of req) if ((text += chunk).length > BODY_MOST) throw new Error('Too large.');
  try { return text.trim() ? (JSON.parse(text) as { from?: unknown }) : {}; } catch { throw new Error('The body is not JSON.'); }
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
    let body: { from?: unknown };
    try { body = await asked(req); } catch (err) { return json(res, 400, { error: (err as Error).message }, PRIVATE); }
    const from = body.from === undefined ? undefined : sharedAt(body.from);
    if (body.from !== undefined && (!from || !(await workspaces.has(from.workspace)))) return json(res, 404, { error: 'Nothing is shared at that address.' }, PRIVATE);
    // The map made ahead is taken before anything is awaited again, so two clicks never get the same one.
    const spare = ahead.get(workspaces);
    makeAhead(workspaces);
    const id = (await spare) ?? (await makeGuest(workspaces)), control = await workspaces.control();
    const ws = await workspaces.get(id);
    const done = workspaces.hold(id);
    try {
      const guest = await markGuest(control, id, new Date(), true); // its days count from the click, not from when it was made
      const me = await ws.pelago.setting<string>('me');
      let copied: number | undefined;
      try {
        copied = from ? await copyShared((await workspaces.get(from.workspace)).pelago, from.id, ws.pelago, { ...MAKER, ...(me && { person: me }) }, GUEST_ITEMS - 20) : undefined;
      } catch (err) {
        return json(res, 404, { error: (err as Error).message }, PRIVATE); // the map taken ends unused, as any guest map does
      }
      const days = GUEST_DAYS + GUEST_GRACE_DAYS;
      const agent = await createToken(ws.pelago.db, id, { kind: 'agent', name: 'guest agent', expires_days: days });
      const page = await createToken(ws.pelago.db, id, { kind: 'human', name: 'guest', entity: me, admin: true, expires_days: days });
      const link = `${originOf(req)}/g/${agent.token}`, prompt = guestPrompt(link);
      const install = await seedInstall(ws.pelago, { ...MAKER, ...(me && { person: me }) }, prompt, originOf(req));
      return json(res, 200, { result: { workspace: { id, name: ws.name }, link, prompt, install, page_token: page.token, expires_at: guest.expires_at, ...(copied !== undefined && { copied }) } }, PRIVATE);
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
    return text(res, 200, guestWords(originOf(req), key, id, (await ws.pelago.setting<string>('me')) ?? '', await ws.pelago.setting<string>(INSTALL)));
  },
};

/** GET /guest/counts: how many guest maps a click took, how many reached a first item, and how fast (guestCounts). The operator's. */
export const guestCountsRoute: RouteFilling = {
  method: 'GET',
  path: /^\/guest\/counts$/,
  serve: async (req, res, _match, { workspaces, tooOften }) => {
    if (tooOften('open')) return;
    if (!(await workspaces.isOperator(bearer(req.headers.authorization)))) return json(res, 401, { error: 'The operator secret is required.' }, PRIVATE);
    return json(res, 200, { result: await guestCounts(await workspaces.control()) }, PRIVATE);
  },
};
