// Packs in time (Rule 8 of the target model, docs/log.md section 8): a pack's presence in a workspace is a fact on its
// log, kept forever: ["+", "pack:<id>", "pack", { version, manifest, text?, code?, files?, texts? }] when it is added (the manifest is the SHA-256
// of its pack.json as read, and its text the first time the log meets that hash; its code, src/pack-code.ts, the same way by file), and only the owner adds one; ["-", "pack:<id>", "pack"] when it is taken out. Which packs are off is read from those facts,
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
import { canSeal } from './secrets.ts';
import { ISLANDS } from './islands.ts';
import { islandBlockers, moveOntoIslands } from './island-start.ts';
import { KERNEL_PACKS } from './packorder.ts';
import { LOCAL_PACK, type PackFile } from './packs.ts';
import { hostFor } from './packtools.ts';
import { needHuman } from './actor-checks.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import type { Tool } from './tools.ts';
import { syncTypes } from './typetable.ts';
import { packTouches } from './pack-touches.ts';
import { withUse } from './pack-use.ts';
import { folderCode, keptHashes } from './pack-code.ts';

/** The setting that held the packs turned off in a workspace before they were facts: read until the first pack fact. */
export const PACKS_OFF = 'packs_off';

/** The id a pack's presence is kept under on the log. */
export const packFact = (pack: string) => `pack:${pack}`;

type Said = { id: string; op: '+' | '-'; value: { version?: string; manifest?: string; code?: string } | null };

/** The last fact said of each pack here. */
async function packFacts(l: Archipelago): Promise<Map<string, Said>> {
  const { rows } = await l.db.query<Said>(`select distinct on (id) id, op, value - 'text' - 'texts' - 'files' as value from log_fact where stream = 'facts' and field = 'pack' and id like 'pack:%' order by id, pos desc, n desc -- index log_fact_kept`);
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
  // a pack kept as an item is new here until the owner adds it, whatever the old setting said.
  return [...(Array.isArray(rows[0]?.value) ? (rows[0].value as string[]) : []), ...l.registry.made.keys()];
}

/** Whether this workspace holds its packs to the island rules (src/islands.ts): off unless the owner set it. */
export async function islandsOn(l: Archipelago): Promise<boolean> {
  const { rows } = await l.db.query<{ value: unknown }>(`select value from setting where key = $1`, [ISLANDS]);
  return rows[0]?.value === true;
}

/**
 * Hold this workspace's packs to the island rules, or let them go (`actor` 'system' for a new workspace, as the server
 * makes it). On a map with work it is turned on only if no pack in use would be switched off, and what is on no island
 * is moved onto islands (src/island-start.ts); if that move is refused, the setting is put back. Set on again while
 * it is on, what is on no island since is moved the same way.
 */
export async function setIslands(l: Archipelago, actor: Actor | 'system', on: boolean) {
  if (actor !== 'system') needHuman(actor, 'Holding the packs to the island rules is the owner’s.');
  // One way (the owner, 10 Nov 2026): a map on islands stays on them. Only the system makes a plain map, for a test.
  if (!on && actor !== 'system' && (await islandsOn(l))) throw new Error('Islands cannot be turned off: a map on islands stays on them.');
  const turning = on && !(await islandsOn(l));
  if (turning) {
    const blocked = await islandBlockers(l);
    if (blocked) throw new Error(blocked);
  }
  const put = async (value: boolean) => {
    await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [ISLANDS, JSON.stringify(value)]);
    await l.record('settings', actor === 'system' ? 'system' : actorId(actor), [['+', 'setting', ISLANDS, value]]);
    l.registry.turnOff(await packsOff(l), value);
    if (value) hostFor(l.registry).stop();
    await syncTypes(l);
    toolsChanged(l.workspace);
  };
  if (turning || !on) await put(on);
  if (!on || actor === 'system') return;
  // Set again while on, it moves what came in on no island since (an import, say).
  try {
    await moveOntoIslands(l, actor);
  } catch (err) {
    if (!turning) throw err;
    await put(false);
    throw new Error(`Islands stay off: what is on the map could not be moved onto islands. ${(err as Error).message}`);
  }
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

/** What is kept on this log already: the manifests whose text it keeps, and the files of packs' code (src/pack-code.ts), by hash. */
type Kept = { manifests: Set<string>; files: Set<string> };
const keptHere = async (l: Archipelago): Promise<Kept> => ({ manifests: await keptManifests(l), files: await keptHashes(l.db) });

/** A pack's code as its folder holds it now: none for one kept as an item, or one with no folder. */
const codeNow = (l: Archipelago, id: string) => (l.registry.made.has(id) ? undefined : folderCode(l.registry.folderOf(id)));

/**
 * A pack's presence as a fact: its version and manifest hash, and the manifest's text the first time this log meets
 * that hash; its code's hash and its files' (src/pack-code.ts), with the text of each file this log has not met yet.
 */
function present(l: Archipelago, pack: { id: string; version: string }, k: Kept): Fact {
  const kept = k.manifests;
  const manifest = l.registry.hashes.get(pack.id);
  // a pack kept as an item is its manifest's text, kept on the map; any other is its file.
  const file = join(l.registry.folderOf(pack.id), 'pack.json'), made = l.registry.made.get(pack.id)?.text;
  const text = !manifest || kept.has(manifest) ? undefined : made ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
  const same = text !== undefined && createHash('sha256').update(text).digest('hex') === manifest;
  if (same) kept.add(manifest!);
  const code = codeNow(l, pack.id);
  const texts = code ? Object.fromEntries([...code.texts].filter(([h]) => !k.files.has(h))) : {};
  for (const h of Object.keys(texts)) k.files.add(h);
  return ['+', packFact(pack.id), 'pack', { version: pack.version, manifest, ...(same && { text }), ...(code && { code: code.code, files: code.files }), ...(Object.keys(texts).length && { texts }) }];
}

/**
 * Packs renamed: a pack the log added that this server no longer has, whose every type and link type (as the type
 * table kept them) one pack here not yet added defines now, by its name or a name it had (moved_from). By the new
 * pack's id, the old one's.
 */
async function renamedPacks(l: Archipelago, said: Map<string, Said>): Promise<Map<string, string>> {
  const here = new Set(l.registry.found.map((p) => p.id));
  const out = new Map<string, string>();
  for (const [old, s] of said) {
    if (s.op !== '+' || here.has(old)) continue;
    const { rows } = await l.db.query<{ id: string }>(`select id from type_def where pack = $1`, [old]);
    const defines = (p: PackFile, id: string) => [...(p.types ?? []), ...(p.links ?? [])].some((d) => 'id' in d && (d.id === id || d.moved_from?.includes(id)));
    const by = l.registry.found.filter((p) => said.get(p.id)?.op !== '+' && rows.every((r) => defines(p, r.id)));
    if (rows.length && by.length === 1) out.set(by[0].id, old);
  }
  return out;
}

/**
 * Packs that took over what an added pack held: one the log never named that now defines (by its name or a name it had)
 * a type or link type the type table kept for a pack the log added, which that pack defines no longer (software's
 * feature, code's now). The owner chose those words when they added the pack that held them, so the pack that holds
 * them now is added with them, once. A pack the owner took out is never added this way.
 */
async function takenOver(l: Archipelago, said: Map<string, Said>): Promise<Set<string>> {
  const added = [...said].flatMap(([id, s]) => (s.op === '+' ? [id] : []));
  const out = new Set<string>();
  if (!added.length) return out;
  const { rows } = await l.db.query<{ id: string; pack: string }>(`select id, pack from type_def where pack = any($1::text[])`, [added]);
  const defines = (p: PackFile, id: string) => [...(p.types ?? []), ...(p.links ?? [])].some((d) => 'id' in d && (d.id === id || d.moved_from?.includes(id)));
  const files = new Map(l.registry.found.map((p) => [p.id, p]));
  for (const r of rows) {
    const holder = files.get(r.pack);
    if (holder && defines(holder, r.id)) continue;
    for (const p of l.registry.found) if (!said.has(p.id) && !KERNEL_PACKS.includes(p.id) && defines(p, r.id)) out.add(p.id);
  }
  return out;
}

/**
 * Bring the log in line with the packs this server has, when a workspace opens. The kernel's packs are asserted, and a
 * pack the log has added is asserted again when its version or manifest changed. A pack the log never added is not
 * added: that is the owner's, unless it is one the owner added under its old name (renamedPacks), which takes its
 * place once, or one that took over words a pack the owner added held (takenOver). A new workspace starts with the kernel's packs (and those the server starts with); one
 * made before packs were facts is said to have what it had (and one the old setting turned off is retracted once). A
 * pack the server does not enable is not said either way. One system change set.
 */
export async function syncPacks(l: Archipelago): Promise<Fact[]> {
  const said = await packFacts(l);
  const off = new Set(await packsOff(l));
  const kept = await keptHere(l);
  const start = startPacks();
  const first = !said.size && !(await l.db.query(`select 1 from entity limit 1`)).rows.length;
  const renamed = await renamedPacks(l, said);
  const taken = await takenOver(l, said);
  const facts: Fact[] = [];
  for (const p of l.registry.found) {
    if (p.id === LOCAL_PACK || (l.registry.only && !l.registry.only.includes(p.id) && !l.registry.made.has(p.id))) continue;
    const was = said.get(p.id);
    if (l.registry.made.has(p.id) && was?.op !== '+') continue; // kept as an item: the owner adds it, never the sync
    const kernel = KERNEL_PACKS.includes(p.id);
    const changed = !was || was.op === '-' || was.value?.version !== p.version || was.value?.manifest !== l.registry.hashes.get(p.id) || was.value?.code !== codeNow(l, p.id)?.code;
    if (renamed.has(p.id)) facts.push(present(l, p, kept), ['-', packFact(renamed.get(p.id)!), 'pack']);
    else if (kernel || was?.op === '+') {
      if (changed) facts.push(present(l, p, kept));
    } else if (taken.has(p.id)) facts.push(present(l, p, kept));
    else if (!said.size && first) {
      if (start === 'all' || start.includes(p.id)) facts.push(present(l, p, kept));
    } else if (!said.size) {
      facts.push(off.has(p.id) ? ['-', packFact(p.id), 'pack'] : present(l, p, kept));
    }
  }
  if (!facts.length) return facts;
  // A server that cannot seal (no PELAGO_SECRETS_KEY on Postgres) opens the workspace with its packs as they are and
  // leaves the log as it was: the open must not fail for want of a key, and nothing is written unsealed.
  if (!canSeal()) {
    console.warn(`${l.workspace}: the packs here differ from what its log says (${facts.map((f) => f[1]).join(', ')}), and with no sealing key the log is left as it was`);
    return [];
  }
  await appendPacks(l, 'system', 'pack.sync', 'The packs as this server has them', facts);
  return facts;
}

/**
 * Every pack this workspace may have, with its state here and why, what it needs, and what it touches. A pack the
 * server's list does not offer it (src/pack-allow.ts) is left out: it cannot be added here, so it is not shown.
 */
export function packStates(l: Archipelago) {
  const made = (id: string) => l.registry.made.get(id)?.item;
  const only = l.registry.only;
  const offered = (id: string) => !only || only.includes(id) || id === LOCAL_PACK || l.registry.made.has(id);
  return l.registry.found.filter((p) => offered(p.id)).map((p) => ({ id: p.id, title: p.title, version: p.version, manifest: l.registry.hashes.get(p.id), description: p.description, requires: p.requires ?? [], touches: packTouches(p), ...(made(p.id) && { made: made(p.id) }), ...l.registry.states.get(p.id)! }));
}

/** Turn a pack off or on in this workspace. */
export async function setPack(l: Archipelago, actor: Actor, input: { pack: string; on: boolean }) {
  needHuman(actor, 'Turning a pack on or off is the owner’s.');
  if (!l.registry.states.has(input.pack)) throw new Error(`No pack "${input.pack}" on this server. Packs: ${[...l.registry.states.keys()].join(', ')}`);
  // A pack the server's list leaves out here (src/pack-allow.ts) is not the owner's to add: the server's configuration lets it in.
  if (input.on && l.registry.only && !l.registry.only.includes(input.pack) && !l.registry.made.has(input.pack)) throw new Error(`The ${input.pack} pack is not offered to this workspace on this server.`);
  if (!input.on && KERNEL_PACKS.includes(input.pack)) throw new Error(`The ${input.pack} pack is the kernel's own: it is never taken out.`);
  const needing = input.on ? [] : l.registry.packs.filter((p) => (p.requires ?? []).includes(input.pack)).map((p) => p.id);
  if (needing.length) throw new Error(`${needing.join(', ')} require${needing.length === 1 ? 's' : ''} the ${input.pack} pack: take ${needing.length === 1 ? 'it' : 'them'} out first.`);
  await syncPacks(l); // the log says what is present before it says what changed
  const off = new Set(await packsOff(l));
  if (input.on) off.delete(input.pack);
  else off.add(input.pack);
  const list = [...off].sort();
  const pack = l.registry.found.find((p) => p.id === input.pack)!;
  const fact: Fact = input.on ? present(l, pack, await keptHere(l)) : ['-', packFact(input.pack), 'pack'];
  await appendPacks(l, actorId(actor), input.on ? 'pack.on' : 'pack.off', `${input.on ? 'Added' : 'Took out'} the ${input.pack} pack`, [fact]);
  l.registry.turnOff(list, await islandsOn(l));
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
  const newly = l.registry.turnOff(await packsOff(l), await islandsOn(l));
  if (!newly) return false;
  if (newly.length) hostFor(l.registry).stop();
  toolsChanged(l.workspace);
  return true;
}

/** After a pack kept as an item was made, changed or retired: the log says it as it is now, and the packs on follow. */
export async function followMade(l: Archipelago): Promise<void> {
  await syncPacks(l);
  await followPacks(l);
}

/** The owner’s tools for packs: their states and switch, their secrets, and the acts they ask for. */
export const PACK_STATE_TOOLS: Record<string, Tool> = {
  packs: {
    description: 'The packs here and the state of each: active, waiting (with what it needs) or off. One kept as an item names it (made). To author a pack, make an item of type pack (query schema with type pack says its fields): the owner then adds it here.',
    input: {},
    run: async (l) => withUse(l, packStates(l)),
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
