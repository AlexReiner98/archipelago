// A run and the chat that keeps it: found by the id its surface gave it, and taken up again while the chat goes on.
// One chat is one session under one name; its agent saying it is done does not end it, the chat ending does.

import { actorId, type Actor, type Entity, type Archipelago } from './pelago.ts';
import { awakeSessions, roomForSession } from './plan.ts'; import { wholeMap } from './outbox.ts';

/** How many sessions are at work in the workspace, whoever's they are (src/plan.ts). */
export const sessionsAwake = async (l: Archipelago) => awakeSessions((await wholeMap(l)).db, l.registry.family('run'));

/** Find a run by its entity id or by the session id its surface gave it. */
export async function resolveRun(l: Archipelago, key: string, openOnly = false): Promise<Entity | undefined> {
  const byId = await l.entity(key);
  if (byId && l.registry.isA(byId.type, 'run')) return byId;
  const { rows } = await l.db.query<Entity>(
    `select * from entity where type = any($1::text[]) and props->>'session_id' = $2 and archived_at is null
       and ($3::boolean is false or is_open) order by is_open desc, created_at desc limit 1`,
    [l.registry.family('run'), key, openOnly],
  );
  return rows[0];
}

/** A run that is a chat's: a surface named it and keeps it, where a run this server launched (src/launcher.ts) is the server's to end. */
export const isChat = (run: Entity) => Boolean(run.props.session_id && run.props.surface) && run.props.surface !== 'claude-headless';

export async function takeUp(l: Archipelago, actor: Actor, run: Entity): Promise<void> {
  if (!run.is_open) await roomForSession(l.workspace, () => sessionsAwake(l));
  await l.apply(actorId(actor), { ops: [{ op: 'update', id: run.id, status: 'running' }], reason: 'Session taken up again' });
}

/** The chat goes on: a prompt to a session that was ended, or that had said where its work stands, takes it up under its name. */
export async function sessionPrompted(l: Archipelago, sessionId: string | undefined): Promise<void> {
  const run = sessionId ? await resolveRun(l, sessionId) : undefined;
  if (run && isChat(run) && (!run.is_open || run.status === 'waiting')) await takeUp(l, { kind: 'agent', name: 'claude-code' }, run);
}
