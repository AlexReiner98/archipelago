// What the map's tests share: a fresh map in memory, the two actors, and quick ways to change and ask it.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
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
export async function fresh() {
  const l = new Archipelago(await openDb(), new Registry(PACKS));
  return (await syncTypes(l), l); // as a workspace is opened: the type table holds what the public rule reads
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
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } },
    { op: 'create', ref: 'proj', type: 'work.project', title: 'Apex' },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' },
    { op: 'create', ref: 'rule', type: 'work.decision', title: 'One live lane.', status: 'decided', props: { outcome: 'Only one session drives the CAD app.' } },
    { op: 'create', ref: 'live', type: 'work.task', title: 'Capture probe' },
    { op: 'create', ref: 'offline', type: 'work.task', title: 'Write unit tests' },
    { op: 'create', ref: 'q', type: 'work.decision', title: 'Which target?' },
    { op: 'create', ref: 'gated', type: 'work.task', title: 'Tune the solver' },
    { op: 'link', type: 'software.lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'offline', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'gated', to: 'proj' },
    { op: 'link', type: 'depends_on', from: 'gated', to: 'q' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
    { op: 'link', type: 'work.governed_by', from: 'lane', to: 'rule' },
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

