// A run and the chat that keeps it: found by the id its surface gave it, and taken up again while the chat goes on.
// One chat is one session under one name; its agent saying it is done does not end it, the chat ending does.

import type { KernelContext } from '#pelago/kernel';
import { bookkeep } from './bookkeeping.ts';
import { actorId, type Actor, type Item } from './types.ts';

/** How many sessions are at work in the workspace, whoever's they are: counted as the whole workspace (root.sessions). */
export const sessionsAwake = async (ctx: KernelContext): Promise<number> => (await ctx.call('root.sessions', { awake: true })) as number;

/** Find a run by its entity id or by the session id its surface gave it. */
export async function resolveRun(ctx: KernelContext, key: string, openOnly = false): Promise<Item | undefined> {
  return ((await ctx.reads({ run_of: { key, open: openOnly } })) as Item | null) ?? undefined;
}

/**
 * A run that is a chat's: a surface named it and keeps it, where a run this server launched (packs/surface/kernel/launcher.ts) is the
 * server's to end: its surface is pack:<the launcher's pack>, or <client>-headless as launches were named before that.
 */
export const isChat = (run: Pick<Item, 'props'>) => Boolean(run.props.session_id && run.props.surface) && !/-headless$/.test(String(run.props.surface)) && !String(run.props.surface).startsWith('pack:');

export async function takeUp(ctx: KernelContext, actor: Actor, run: Item): Promise<void> {
  // A run that had ended counts against the workspace's sessions again: refused, saying the limit, when there is no room.
  if (!run.is_open) await ctx.call('root.sessions', { room: true });
  await bookkeep(ctx, actorId(actor), { ops: [{ op: 'update', id: run.id, status: 'running' }], reason: 'Session taken up again' });
}

/** The chat goes on: a prompt to a session that was ended, or that had said where its work stands, takes it up under its name, as the actor its hooks act as. */
export async function sessionPrompted(ctx: KernelContext, sessionId: string | undefined, actor: Actor): Promise<void> {
  const run = sessionId ? await resolveRun(ctx, sessionId) : undefined;
  if (run && isChat(run) && (!run.is_open || run.status === 'waiting')) await takeUp(ctx, actor, run);
}

/** How long after its hook registered a chat a call to register it again is taken to be the same chat. */
const JOIN_MS = 60 * 60_000;
const folder = (p: string) => p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase();

/**
 * The run a chat's hook made for the session that now asks to register without its session id (told to in a
 * brief): an open chat's run in the same folder, begun within the hour, on the branch it names if it has said one,
 * and, of several, the one mid-turn, as the asking session is. None when that leaves more than one.
 */
export async function hookRunHere(ctx: KernelContext, input: { cwd?: string; branch?: string }): Promise<Item | undefined> {
  if (!input.cwd) return undefined;
  const rows = (await ctx.reads({ chat_runs_since: new Date(ctx.now().getTime() - JOIN_MS).toISOString() })) as Item[];
  const branchOf = (run: Item) => (run.props.branch ?? (run.props.stands as { branch?: string } | undefined)?.branch) as string | undefined;
  const here = rows.filter((run) => isChat(run) && typeof run.props.cwd === 'string' && folder(run.props.cwd) === folder(input.cwd!) && (!input.branch || !branchOf(run) || branchOf(run) === input.branch));
  const busy = here.filter((run) => run.props.busy === true);
  return here.length === 1 ? here[0] : busy.length === 1 ? busy[0] : undefined;
}
