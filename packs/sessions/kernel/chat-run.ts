// A run and the chat that keeps it: found by the id its surface gave it, and taken up again while the chat goes on.
// One chat is one session under one name; its agent saying it is done does not end it, the chat ending does.

import { bookkeep } from './bookkeeping.ts';
import { actorId, type Actor, type Entity, type Archipelago } from '../../../src/pelago.ts';
import { roomForSession } from '../../../src/standing.ts'; import { awakeSessions } from '../../../src/workspace-use.ts'; import { bypassingRls } from '../../../src/outbox.ts';

/** How many sessions are at work in the workspace, whoever's they are (src/workspace-use.ts). */
export const sessionsAwake = async (l: Archipelago) => awakeSessions((await bypassingRls(l)).db, l.registry.family('run'));

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

/**
 * A run that is a chat's: a surface named it and keeps it, where a run this server launched (src/launcher.ts) is the
 * server's to end: its surface is pack:<the launcher's pack>, or <client>-headless as launches were named before that.
 */
export const isChat = (run: Entity) => Boolean(run.props.session_id && run.props.surface) && !/-headless$/.test(String(run.props.surface)) && !String(run.props.surface).startsWith('pack:');

/** The actor a session's hooks act as, whatever surface it is in: named claude-code since before there were surfaces, as the log keeps it. */
export const HOOK_ACTOR: Actor = { kind: 'agent', name: 'claude-code' };

export async function takeUp(l: Archipelago, actor: Actor, run: Entity): Promise<void> {
  if (!run.is_open) await roomForSession(l.workspace, () => sessionsAwake(l));
  await bookkeep(l, actorId(actor), { ops: [{ op: 'update', id: run.id, status: 'running' }], reason: 'Session taken up again' });
}

/** The chat goes on: a prompt to a session that was ended, or that had said where its work stands, takes it up under its name. */
export async function sessionPrompted(l: Archipelago, sessionId: string | undefined): Promise<void> {
  const run = sessionId ? await resolveRun(l, sessionId) : undefined;
  if (run && isChat(run) && (!run.is_open || run.status === 'waiting')) await takeUp(l, HOOK_ACTOR, run);
}

/** How long after its hook registered a chat a call to register it again is taken to be the same chat. */
const JOIN_MS = 60 * 60_000;
const folder = (p: string) => p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase();

/**
 * The run a chat's hook made for the session that now asks to register without its session id (told to in a
 * brief): an open chat's run in the same folder, begun within the hour, on the branch it names if it has said one,
 * and, of several, the one mid-turn, as the asking session is. None when that leaves more than one.
 */
export async function hookRunHere(l: Archipelago, input: { cwd?: string; branch?: string }): Promise<Entity | undefined> {
  if (!input.cwd) return undefined;
  const { rows } = await l.db.query<Entity>(
    `select * from entity where type = any($1::text[]) and is_open and archived_at is null and props ? 'session_id' and created_at > $2 order by created_at desc limit 50 -- index entity_type`,
    [l.registry.family('run'), new Date(Date.now() - JOIN_MS).toISOString()],
  );
  const branchOf = (run: Entity) => (run.props.branch ?? (run.props.stands as { branch?: string } | undefined)?.branch) as string | undefined;
  const here = rows.filter((run) => isChat(run) && typeof run.props.cwd === 'string' && folder(run.props.cwd) === folder(input.cwd!) && (!input.branch || !branchOf(run) || branchOf(run) === input.branch));
  const busy = here.filter((run) => run.props.busy === true);
  return here.length === 1 ? here[0] : busy.length === 1 ? busy[0] : undefined;
}
