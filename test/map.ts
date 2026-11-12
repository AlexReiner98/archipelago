// What the map's tests share: a fresh map in memory, the two actors, and quick ways to change and ask it.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import '../src/packreads.ts'; // the reads API fills the loader's slot loader.reads, as the surface root loads it at a workspace's open
import { syncTypes } from '../src/typetable.ts';
import { entries, type Entry } from '../src/log.ts';
import { rebuild } from '../src/replay.ts';
import { KEPT_FIELDS } from '../src/operational.ts';

export const human: Actor = { kind: 'human', name: 'test' };
export const agent: Actor = { kind: 'agent', name: 'test' };

/** The packs as they are in the repository. Nothing writes there (a type a test defines is kept in its database), so
 * the tests read them in place; a test that adds a pack makes its own copy. */
export const PACKS = join(import.meta.dirname, '..', 'packs');

/** A fresh in-memory map with the repository's packs. */
export const fresh = () => freshWith(new Registry(PACKS));

/** A fresh in-memory map with these packs, and the policy given. */
export async function freshWith(registry: Registry, policy?: ConstructorParameters<typeof Archipelago>[2]) {
  const l = new Archipelago(await openDb(), registry, policy);
  return (await syncTypes(l), l); // as a workspace is opened: the type table holds what the public rule reads
}

/** A copy of the repository's packs, in a folder of its own, with more beside them: a pack file (with an empty
 * handler.js when it names handlers), or the name of a test pack under test/packs. */
export function packsWith(...more: (PackFile | string | undefined)[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-packs-'));
  cpSync(PACKS, dir, { recursive: true });
  for (const m of more) {
    if (!m) continue;
    if (typeof m === 'string') cpSync(join(PACKS, '..', 'test', 'packs', m), join(dir, m), { recursive: true });
    else {
      mkdirSync(join(dir, m.id));
      writeFileSync(join(dir, m.id, 'pack.json'), JSON.stringify(m));
      if (m.handlers) writeFileSync(join(dir, m.id, 'handler.js'), 'export default {};\n');
    }
  }
  return dir;
}

export const attend = async (l: Archipelago, params: Record<string, unknown>) => (await callTool(l, human, 'view', { name: 'attention', params })) as any;

export async function make(l: Archipelago, ops: Op[]) {
  const result = await l.change(human, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

/** A project in a repo, with one task that needs the live lane and one that does not. */
export async function laneSetup(l: Archipelago) {
  return make(l, [
    // A checkout found by its folder where the map has the test pack for it (test/packs/checkout), else a plain place.
    l.registry.types.has('checkout') ? { op: 'create', ref: 'repo', type: 'checkout', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } } : { op: 'create', ref: 'repo', type: 'place', title: 'Apex repo' },
    { op: 'create', ref: 'proj', type: 'aim', title: 'Apex' },
    { op: 'create', ref: 'lane', type: 'place', props: { exclusive: true }, title: 'Live lane' },
    { op: 'create', ref: 'rule', type: 'decision', title: 'One live lane.', status: 'decided', props: { outcome: 'Only one session drives the CAD app.' } },
    { op: 'create', ref: 'live', type: 'task', title: 'Capture probe' },
    { op: 'create', ref: 'offline', type: 'task', title: 'Write unit tests' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which target?' },
    { op: 'create', ref: 'gated', type: 'task', title: 'Tune the solver' },
    { op: 'link', type: 'lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'offline', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'gated', to: 'proj' },
    { op: 'link', type: 'depends_on', from: 'gated', to: 'q' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
    { op: 'link', type: 'about', from: 'lane', to: 'rule' },
  ]);
}

/** Every entry of a stream, in order. */
export async function all(l: Archipelago, stream: 'facts' | 'pending' = 'facts') {
  const out: Entry[] = [];
  for (let page = await entries(l.db, stream, 1); page.length; page = await entries(l.db, stream, out.at(-1)!.pos + 1)) out.push(...page);
  return out;
}

const ITEM = `id, type, title, body, status, is_open, owner, visibility, confidence, jsonb_strip_nulls(props) - $1::text[] as props, source_id,
  date_trunc('milliseconds', created_at) as created_at, date_trunc('milliseconds', updated_at) as updated_at, date_trunc('milliseconds', archived_at) as archived_at, private_to, kind`;
const LINK = `id, type, from_id, to_id, props, confidence, source_id, date_trunc('milliseconds', valid_from) as valid_from, date_trunc('milliseconds', valid_to) as valid_to`;
const QUEUE = `id, ts, actor, reason, source, ops, warnings, status, decided_by, decided_at, note, private_to, held_by`;

/** The live rows, and the rows every projection gives when the log is projected again into an empty map. */
export async function replayed(l: Archipelago) {
  const copy = new Archipelago(await openDb(), l.registry);
  const log = [...(await all(l)), ...(await all(l, 'pending'))];
  await copy.db.transaction((tx) => rebuild(tx, l.registry, log));
  const read = async (m: Archipelago) => ({
    items: (await m.db.query(`select ${ITEM} from entity order by id`, [KEPT_FIELDS])).rows,
    links: (await m.db.query(`select ${LINK} from relation order by id`)).rows,
    queue: (await m.db.query(`select ${QUEUE} from proposal order by id`)).rows,
    closure: (await m.db.query(`select ancestor, descendant from part_closure order by ancestor, descendant`)).rows,
    mentions: (await m.db.query(`select from_id, to_id from mention order by from_id, to_id`)).rows,
  });
  return { live: await read(l), replay: await read(copy) };
}

