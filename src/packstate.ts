// Turning a pack off and on in a running workspace. What the pack registered (types and relations, rules, actions
// and views, trees) unwinds at once: its types turn dormant in the type table, its tools leave the tool list, its
// process stops, and connected agents are told the list changed. What it made stays, as dormant items a person can
// still edit. Turning it on again brings it all back. It is the owner's: a pack carries rules and code.

import { z } from 'zod';
import { decideAct, listActs, setPackSecret } from './outside.ts';
import { hostFor } from './packtools.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import type { Tool } from './tools.ts';
import { syncTypes } from './typetable.ts';

/** The setting that holds the packs turned off in a workspace. */
export const PACKS_OFF = 'packs_off';

/** Told when a workspace's tools change, so the server can tell the agents connected to it. */
let toolsChanged: (workspace: string) => void = () => {};
export const onToolsChanged = (fn: (workspace: string) => void) => (toolsChanged = fn);

/** The packs turned off in a workspace, as it keeps them. */
export async function packsOff(l: Archipelago): Promise<string[]> {
  const { rows } = await l.db.query<{ value: unknown }>(`select value from setting where key = $1`, [PACKS_OFF]);
  return Array.isArray(rows[0]?.value) ? (rows[0].value as string[]) : [];
}

/** Every pack on this server, with its state in this workspace and why. */
export function packStates(l: Archipelago) {
  return l.registry.found.map((p) => ({ id: p.id, title: p.title, version: p.version, ...l.registry.states.get(p.id)! }));
}

/** Turn a pack off or on in this workspace. */
export async function setPack(l: Archipelago, actor: Actor, input: { pack: string; on: boolean }) {
  if (actor.kind !== 'human') throw new Error('Turning a pack on or off is the owner’s.');
  if (!l.registry.states.has(input.pack)) throw new Error(`No pack "${input.pack}" on this server. Packs: ${[...l.registry.states.keys()].join(', ')}`);
  const off = new Set(await packsOff(l));
  if (input.on) off.delete(input.pack);
  else off.add(input.pack);
  const list = [...off].sort();
  await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb`, [PACKS_OFF, JSON.stringify(list)]);
  l.registry.turnOff(list);
  if (!input.on) hostFor(l.registry).stop();
  const synced = await syncTypes(l);
  await l.log(l.db, { actor: actorId(actor), action: input.on ? 'pack.on' : 'pack.off', reason: `${input.on ? 'Turned on' : 'Turned off'} the ${input.pack} pack`, detail: { pack: input.pack, ...synced } });
  toolsChanged(l.workspace);
  return { packs: packStates(l), dormant: synced.dormant, activated: synced.activated };
}

/**
 * Catch up with a pack turned off or on by another server on the same database: its types in the type table are
 * already synced there, so here the registry loads again, its process stops, and the agents connected here are told.
 */
export async function followPacks(l: Archipelago): Promise<boolean> {
  const newly = l.registry.turnOff(await packsOff(l));
  if (!newly) return false;
  if (newly.length) hostFor(l.registry).stop();
  toolsChanged(l.workspace);
  return true;
}

/** The owner’s tools for packs: their states and switch, their secrets, and the acts they ask for. */
export const PACK_STATE_TOOLS: Record<string, Tool> = {
  packs: {
    description: 'The packs on this server and the state of each here: active, waiting (with what it needs) or off.',
    input: {},
    run: async (l) => packStates(l),
  },
  pack_set: {
    description: 'Turn a pack off or on in this workspace. Its items stay; while it is off they are dormant and its tools are gone.',
    input: { pack: z.string(), on: z.boolean() },
    humanOnly: true,
    run: async (l, actor, input) => setPack(l, actor, input),
  },
  acts: {
    description: 'What packs asked to have done outside the map: those held for a person first, then the latest made or declined.',
    input: {},
    run: async (l) => listActs(l),
  },
  act_decide: {
    description: 'Allow an act a pack asked for that was held (it moves money or cannot be taken back): it is made at once and never undone. Or decline it.',
    input: { act: z.string(), allow: z.boolean() },
    humanOnly: true,
    run: async (l, actor, input) => decideAct(hostFor(l.registry), l, actor, input),
  },
  pack_secret_set: {
    description: 'Give a pack a secret its host needs (an API key), kept sealed. The pack never sees it: the kernel adds it to the requests it makes.',
    input: { pack: z.string(), name: z.string(), value: z.string() },
    humanOnly: true,
    run: async (l, _actor, input) => setPackSecret(l, input),
  },
};
