// root.sessions, for the sessions pack (docs/kernel-packs.md, "Root services"): what it needs of the whole workspace.
// How many sessions are at work, whoever's they are, and whether there is room for one more: every session counts
// against the workspace's limit, not only those its asker may see. And the owner's settings of the reply rules (which
// are off here, and what each that counts counts to), which no member's view reads. Each is read as the whole
// workspace, as the sessions pack read it before it moved (src/chat-run.ts's sessionsAwake, src/replies.ts's
// liftedHere, handed the whole database by its hook).

import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { bypassingRls } from '../../identity/kernel/outbox.ts';
import { roomForSession } from '../../identity/kernel/standing.ts';
import { awakeSessions } from './workspace-use.ts';
import { setupBehind } from './server-files.ts';
import { describeChanges, humanChanges, latestSeq } from './tool-reads.ts';
import { offeredActions } from './tools.ts';

/**
 * awake: the sessions at work now; room: refused, saying the limit, when one more would be over it; settings: the reply
 * rules' settings of these names. What a session's hooks are told of the server and of what people did (wave 6b,
 * e_rr96yyj3), as its map reads them: behind, whether a project's setup is behind what this server hands out (by the
 * version its hook says); offered, the actions the tools offer here; heard, the newest event's seq; changes, what
 * people did after a seq, with the newest few of them described as a hook says them.
 */
export type SessionsAsk = { awake: true } | { room: true } | { settings: string[] } | { behind: string | null } | { offered: true } | { heard: true } | { changes: { after: number; newest: number } };

/** A reply rule's setting: reply_<name>, or with _at the number it counts to (packs/sessions/kernel/reply-rules.ts). */
const REPLY_SETTING = /^reply_[a-z0-9_]+$/;

export async function sessionRoom(call: RootCall, ask: SessionsAsk): Promise<unknown> {
  const map = call.map;
  if (!map) throw new Error('root.sessions counts a workspace\'s: call it from its map');
  const whole = async () => (await bypassingRls(map)).db;
  const awake = async () => awakeSessions(await whole(), map.registry.family('run'));
  if (ask && 'awake' in ask) return awake();
  if (ask && 'room' in ask) return (await roomForSession(map.workspace, awake), null);
  if (ask && 'settings' in ask) {
    const keys = ask.settings;
    if (!Array.isArray(keys) || keys.length > 200 || !keys.every((k) => typeof k === 'string' && REPLY_SETTING.test(k))) throw new Error('root.sessions reads only the reply rules\' settings, reply_<name>');
    if (!keys.length) return [];
    const { rows } = await (await whole()).query<{ key: string; value: unknown }>(`select key, value from setting where key = any($1::text[])`, [keys]);
    return rows;
  }
  if (ask && 'behind' in ask) return setupBehind(typeof ask.behind === 'string' ? ask.behind : undefined);
  if (ask && 'offered' in ask) return offeredActions(map.registry);
  if (ask && 'heard' in ask) return latestSeq(map);
  if (ask && 'changes' in ask) {
    const changes = await humanChanges(map, Number(ask.changes.after));
    const newest = changes.slice(Math.max(0, changes.length - (Math.floor(Number(ask.changes.newest)) || 0)));
    return { changes: changes.map(({ seq, action }) => ({ seq, action })), described: describeChanges(newest) };
  }
  throw new Error('root.sessions counts the sessions awake, says whether there is room for one more, or reads the reply rules\' settings');
}
