// What a guest map's key may do (the owner, 13 Nov 2026, e_hz2ggfg8 and e_68gs8b7p): everything its owner could on
// their own map, and nothing that has this server act outward for an anonymous person. Three things wait for sign-in,
// each refused with sign-in named as the way through: a pack's reach (hosts, secrets, webhooks, connections), handlers
// that run on a schedule, and publishing (and what else puts the map in front of others: a public view, an invitation
// by mail, an agent session the server starts). The line is drawn here alone, so it moves in one place.
//
// The owner acts a guest's agent may call (turning a pack on, the map's settings) run as the guest map's owner: on a
// guest map there is nobody else to ask, since its changes never wait (holds off, ./guest-route.ts).

import { GUEST_OWNER } from '../../identity/kernel/guests.ts';
import { standingOf } from '../../identity/kernel/standing.ts';
import { bundlesHere } from '../../loader/kernel/packstate.ts';
import { packsNamed } from '../../loader/kernel/bundles.ts';
import { parts } from '../../loader/kernel/manifest.ts';
import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';

/** What waits for sign-in, by the action that would do it. */
const WAITS: Record<string, string> = {
  publish: 'publish a document',
  publish_all: 'publish documents',
  share_create: 'make a view public',
  pack_secret_set: 'give a pack a secret',
  connections: 'connect a pack to an outside account',
  member_add: 'invite someone by mail',
  launch: 'start an agent session on the server',
  act_decide: 'allow what a pack asked to do outside the map',
  import_backup: 'bring in a whole backup',
};

/** The settings a guest's map keeps as they are: they would take a wall down, or let its agent publish. */
const KEPT_SETTINGS: Record<string, string> = { drawings_open: 'run drawings without their sandbox', agent_publish: 'let agents publish' };

/** The owner acts a guest's agent calls as the guest. */
const OWNS = new Set(['pack_set', 'workspace_set']);

const signIn = (what: string) => new Error(`A guest map cannot ${what}: sign in to keep this map, and then it can.`);

/** What a pack does outside the map that waits for sign-in: its reach, or a handler on a schedule. Nothing, none. */
function outward(l: Archipelago, pack: string): string | undefined {
  const file = l.registry.found.find((p) => p.id === pack);
  if (!file) return undefined;
  const p = parts(file);
  if (p.hosts.length || p.secrets.length || p.webhooks.length || p.via.length || p.server) return `turn on ${pack}, which reaches outside the map`;
  if (p.schedules.length) return `turn on ${pack}, which runs on a schedule`;
  return undefined;
}

/**
 * Check a call on a guest map and answer the actor it runs as: refused with sign-in named for what waits for it, run
 * as the map's owner for an owner act its agent calls, else as it came. On any other map, as it came.
 */
export async function guestGate(l: Archipelago, actor: Actor, name: string, input: unknown): Promise<Actor> {
  if (!(await standingOf(l.workspace))?.guest) return actor;
  if (WAITS[name]) throw signIn(WAITS[name]);
  const given = (input ?? {}) as Record<string, unknown>;
  if (name === 'pack_set' && given.on === true && typeof given.pack === 'string') {
    for (const pack of packsNamed(bundlesHere(l), given.pack).packs) {
      const why = outward(l, pack);
      if (why) throw signIn(why);
    }
  }
  if (name === 'workspace_set') for (const key of Object.keys(KEPT_SETTINGS)) if (given[key] !== undefined) throw signIn(KEPT_SETTINGS[key]);
  if (actor.kind === 'agent' && OWNS.has(name)) return { kind: 'human', name: `${actor.name} (${GUEST_OWNER})`, admin: true, ...((await l.setting<string>('me')) && { person: await l.setting<string>('me') }) };
  return actor;
}
