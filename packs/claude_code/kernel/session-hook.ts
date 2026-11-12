// The actor Claude Code's hooks act as. What a session is told as it begins and how its end hook ends it are the
// sessions pack's (packs/sessions/kernel/session-hook.ts, on its context), which acts as the same agent (HOOK_AGENT);
// this pack keeps the name, from its adapter.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Who acts: an agent, by its name. */
interface Actor { kind: 'agent'; name: string }

/**
 * The actor a session's hooks act as, whatever surface it is in: the name this pack's adapter says hooks acted under
 * before there were surfaces (reach.server.adapter.before.actor), as the log keeps it.
 */
export const HOOK_ACTOR: Actor = { kind: 'agent', name: (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'pack.json'), 'utf8')) as { reach: { server: { adapter: { before: { actor: string } } } } }).reach.server.adapter.before.actor };
