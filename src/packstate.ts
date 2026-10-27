// Packs in time (Rule 8 of the target model, docs/log.md section 8): a pack's presence in a workspace is a fact on its
// log, kept forever: ["+", "pack:<id>", "pack", { version, manifest, text? }] when it is added (the manifest is the SHA-256
// of its pack.json as read, and its text the first time the log meets that hash), and only the owner adds one; ["-", "pack:<id>", "pack"] when it is taken out. Which packs are off is read from those facts,
// and everything a pack registers is derived from the set (src/packs.ts), so taking one out unwinds it at once: its
// types turn dormant in the type table, its tools leave the tool list, its process stops, and connected agents are
// told the list changed. What it made stays, as dormant items a person can still edit. Adding it back brings it all
// back. It is the owner's: a pack carries rules and code.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { newId } from './db.ts';
import { env } from './env.ts';
import { append, type Fact } from './log.ts';
import { decideAct, listActs, setPackSecret } from './outside.ts';
import { KERNEL_PACKS } from './packorder.ts';
import { LOCAL_PACK } from './packs.ts';
import { hostFor } from './packtools.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import type { Tool } from './tools.ts';
import { syncTypes } from './typetable.ts';

/** The setting that held the packs turned off in a workspace before they were facts: read until the first pack fact. */
export const PACKS_OFF = 'packs_off';

/** The id a pack's presence is kept under on the log. */
export const packFact = (pack: string) => `pack:${pack}`;

type Said = { id: string; op: '+' | '-'; value: { version?: string; manifest?: string; text?: string } | null };

/** The last fact said of each pack here. */
async function packFacts(l: Archipelago): Promise<Map<string, Said>> {
  const { rows } = await l.db.query<Said>(`select distinct on (id) id, op, value from log_fact where stream = 'facts' and field = 'pack' and id like 'pack:%' order by id, pos desc, n desc -- index log_fact_kept`);
  return new Map(rows.map((r) => [r.id.slice('pack:'.length), r]));
}

/** Told when a workspace's tools change, so the server can tell the agents connected to it. */
let toolsChanged: (workspace: string) => void = () => {};
export const onToolsChanged = (fn: (workspace: string) => void) => (toolsChanged = fn);

/**
 * The packs off in a workspace: those whose last fact retracts them, and those this server has that its log never
 * added (a pack is the owner's to add, decided 27 Oct 2026); before any pack fact, the old setting.
 */
export async function packsOff(l: Archipelago): Promise<string[]> {
  const said = await packFacts(l);
  if (said.size) return l.registry.found.map((p) => p.id).filter((id) => id !== LOCAL_PACK && !KERNEL_PACKS.includes(id) && said.get(id)?.op !== '+');
  const { rows } = await l.db.query<{ value: unknown }>(`select value from setting where key = $1`, [PACKS_OFF]);
  return Array.isArray(rows[0]?.value) ? (rows[0].value as string[]) : [];
}

/** Append a change set of pack facts, as who made it. */
const appendPacks = (l: Archipelago, by: string, action: string, reason: string, facts: Fact[]) =>
  l.db.transaction((tx) => append(tx, l.workspace, 'facts', { id: newId('c'), actor: { id: by }, authority: by === 'system' ? null : { of: 'human', who: by }, rule: { outcome: 'apply', spared: [] }, reason, source: null, action, undoes: null, keys: [] }, facts));

/** The packs a new workspace starts with beside the kernel's: none, unless the server says (PELAGO_START_PACKS, a list or "all"). */
const startPacks = (): string[] | 'all' => {
  const said = env('START_PACKS')?.trim();
  return said === 'all' ? 'all' : (said?.split(',').map((p) => p.trim()).filter(Boolean) ?? []);
};

/** The manifests whose text this log keeps, by hash. */
async function keptManifests(l: Archipelago): Promise<Set<string>> {
  const { rows } = await l.db.query<{ manifest: string }>(`select distinct value->>'manifest' as manifest from log_fact where stream = 'facts' and field = 'pack' and id like 'pack:%' and value->>'text' is not null -- index log_fact_kept`);
  return new Set(rows.map((r) => r.manifest));
}

/** A pack's presence as a fact: its version and manifest hash, and the manifest's text the first time this log meets that hash. */
function present(l: Archipelago, pack: { id: string; version: string }, kept: Set<string>): Fact {
  const manifest = l.registry.hashes.get(pack.id);
  const file = join(l.registry.dir, pack.id, 'pack.json');
  const text = manifest && !kept.has(manifest) && existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  const same = text !== undefined && createHash('sha256').update(text).digest('hex') === manifest;
  if (same) kept.add(manifest!);
  return ['+', packFact(pack.id), 'pack', { version: pack.version, manifest, ...(same && { text }) }];
}

/**
 * Bring the log in line with the packs this server has, when a workspace opens. The kernel's packs are asserted, and a
 * pack the log has added is asserted again when its version or manifest changed. A pack the log never added is not
 * added: that is the owner's. A new workspace starts with the kernel's packs (and those the server starts with); one
 * made before packs were facts is said to have what it had (and one the old setting turned off is retracted once). A
 * pack the server does not enable is not said either way. One system change set.
 */
export async function syncPacks(l: Archipelago): Promise<Fact[]> {
  const said = await packFacts(l);
  const off = new Set(await packsOff(l));
  const kept = await keptManifests(l);
  const start = startPacks();
  const first = !said.size && !(await l.db.query(`select 1 from entity limit 1`)).rows.length;
  const facts: Fact[] = [];
  for (const p of l.registry.found) {
    if (p.id === LOCAL_PACK || (l.registry.only && !l.registry.only.includes(p.id))) continue;
    const was = said.get(p.id);
    const kernel = KERNEL_PACKS.includes(p.id);
    const changed = !was || was.op === '-' || was.value?.version !== p.version || was.value?.manifest !== l.registry.hashes.get(p.id);
    if (kernel || was?.op === '+') {
      if (changed) facts.push(present(l, p, kept));
    } else if (!said.size && first) {
      if (start === 'all' || start.includes(p.id)) facts.push(present(l, p, kept));
    } else if (!said.size) {
      facts.push(off.has(p.id) ? ['-', packFact(p.id), 'pack'] : present(l, p, kept));
    }
  }
  if (facts.length) await appendPacks(l, 'system', 'pack.sync', 'The packs as this server has them', facts);
  return facts;
}

/** Every pack on this server, with its state in this workspace and why. */
export function packStates(l: Archipelago) {
  return l.registry.found.map((p) => ({ id: p.id, title: p.title, version: p.version, ...l.registry.states.get(p.id)! }));
}

/** Turn a pack off or on in this workspace. */
export async function setPack(l: Archipelago, actor: Actor, input: { pack: string; on: boolean }) {
  if (actor.kind !== 'human') throw new Error('Turning a pack on or off is the owner’s.');
  if (!l.registry.states.has(input.pack)) throw new Error(`No pack "${input.pack}" on this server. Packs: ${[...l.registry.states.keys()].join(', ')}`);
  if (!input.on && KERNEL_PACKS.includes(input.pack)) throw new Error(`The ${input.pack} pack is the kernel's own: it is never taken out.`);
  const needing = input.on ? [] : l.registry.packs.filter((p) => (p.requires ?? []).includes(input.pack)).map((p) => p.id);
  if (needing.length) throw new Error(`${needing.join(', ')} require${needing.length === 1 ? 's' : ''} the ${input.pack} pack: take ${needing.length === 1 ? 'it' : 'them'} out first.`);
  await syncPacks(l); // the log says what is present before it says what changed
  const off = new Set(await packsOff(l));
  if (input.on) off.delete(input.pack);
  else off.add(input.pack);
  const list = [...off].sort();
  const pack = l.registry.found.find((p) => p.id === input.pack)!;
  const fact: Fact = input.on ? present(l, pack, await keptManifests(l)) : ['-', packFact(input.pack), 'pack'];
  await appendPacks(l, actorId(actor), input.on ? 'pack.on' : 'pack.off', `${input.on ? 'Added' : 'Took out'} the ${input.pack} pack`, [fact]);
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
    description: 'Give a pack a secret its host needs (an API key), kept sealed. The pack never sees it: the kernel adds it to the requests it makes. With make instead of a value, the kernel makes one (for a webhook: what its sender signs with) and shows it once.',
    input: { pack: z.string(), name: z.string(), value: z.string().optional(), make: z.boolean().optional() },
    humanOnly: true,
    run: async (l, _actor, input) => setPackSecret(l, input),
  },
};
