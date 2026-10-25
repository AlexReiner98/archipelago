// The standing views pinned: each one's answer on one fixture map, as it was answered by the old lens (recorded on
// ad8eb76, before they moved off it), so a view that moves to the flat lens or a read of its own answers agents the
// same. Ids are named by the ref that made them and times are dropped; a list whose order differs from run to run
// (one ordered by random ids) is compared as a set, and that is recorded too. PIN_RECORD=1 records it again.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { askView } from '../src/askview.ts';
import { sessionStart } from '../src/sessions.ts';
import { agent, fresh, human, make } from './map.ts';

const PINNED = join(import.meta.dirname, 'fixtures', 'standing-views.json');

async function fixture() {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } },
    { op: 'create', ref: 'app', type: 'work.project', title: 'App', props: { hub_at: 2 } },
    { op: 'create', ref: 'business', type: 'work.project', title: 'Business' },
    { op: 'create', ref: 'addin', type: 'software.feature', title: 'Add-in', props: { order: 2 } },
    { op: 'create', ref: 'installer', type: 'software.feature', title: 'Installer', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'docs', type: 'software.feature', title: 'Docs' },
    { op: 'create', ref: 'old', type: 'software.feature', title: 'Old feature', status: 'shipped' },
    { op: 'create', ref: 'sign', type: 'work.task', title: 'Sign the package', props: { tokens_estimated: 4000 } },
    { op: 'create', ref: 'cert', type: 'work.decision', title: 'Which certificate?', owner: 'me' },
    { op: 'create', ref: 'clean', type: 'work.task', title: 'Uninstall leaves it clean', status: 'done', props: { tokens_estimated: 1000 } },
    { op: 'create', ref: 'hover', type: 'work.task', title: 'Hover cards', status: 'doing', owner: 'bo' },
    { op: 'create', ref: 'extras', type: 'work.task', title: 'Capture extras' },
    { op: 'create', ref: 'guide', type: 'work.task', title: 'Write the guide', props: { tokens_estimated: 2000, tokens_used: 500 } },
    { op: 'create', ref: 'bug', type: 'work.issue', title: 'Crash on thin walls' },
    { op: 'create', ref: 'loose', type: 'work.task', title: 'Loose task in app' },
    { op: 'create', ref: 'pricing', type: 'work.decision', title: 'What does it cost?', owner: 'me' },
    { op: 'create', ref: 'release', type: 'software.release', title: 'Version 1.0' },
    { op: 'create', ref: 'plans', type: 'software.feature', title: 'Price plans' },
    { op: 'create', ref: 'tiers', type: 'work.task', title: 'Write the tiers' },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' },
    { op: 'create', ref: 'rule', type: 'work.decision', title: 'One live lane.', status: 'decided', props: { outcome: 'Only one session drives the CAD app.' } },
    { op: 'create', ref: 'q', type: 'work.decision', title: 'Is the cert enough?' },
    { op: 'create', ref: 'view', type: 'lens', title: 'The app, flat', props: { far: 1 } },
    { op: 'link', type: 'software.lives_in', from: 'app', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'addin', to: 'app' },
    { op: 'link', type: 'part_of', from: 'installer', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'docs', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'old', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sign', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'cert', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'clean', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'hover', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'extras', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'guide', to: 'docs' },
    { op: 'link', type: 'part_of', from: 'bug', to: 'docs' },
    { op: 'link', type: 'part_of', from: 'loose', to: 'app' },
    { op: 'link', type: 'part_of', from: 'pricing', to: 'business' },
    { op: 'link', type: 'part_of', from: 'q', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'plans', to: 'business' },
    // A task part of a feature and of the project the feature is in: it is inside the nearer.
    { op: 'link', type: 'part_of', from: 'tiers', to: 'plans' },
    { op: 'link', type: 'part_of', from: 'tiers', to: 'business' },
    { op: 'link', type: 'depends_on', from: 'sign', to: 'cert' },
    { op: 'link', type: 'depends_on', from: 'guide', to: 'clean' },
    { op: 'link', type: 'depends_on', from: 'extras', to: 'hover' },
    { op: 'link', type: 'waits_on', from: 'hover', to: 'bo', props: { for: 'The card design' } },
    { op: 'link', type: 'needs', from: 'sign', to: 'lane' },
    { op: 'link', type: 'work.governed_by', from: 'lane', to: 'rule' },
    { op: 'link', type: 'relates_to', from: 'sign', to: 'q' },
    { op: 'link', type: 'software.ships', from: 'release', to: 'addin' },
    { op: 'link', type: 'depends_on', from: 'release', to: 'installer' },
    { op: 'link', type: 'depends_on', from: 'release', to: 'pricing' },
    { op: 'link', type: 'defers', from: 'release', to: 'hover' },
    { op: 'link', type: 'about', from: 'view', to: 'app' },
  ]);
  // Each made a minute apart, in the order of their titles: what is ordered by when it changed has one order.
  await l.db.query(`update entity e set created_at = t.at, updated_at = t.at from (select id, timestamptz '2026-10-01T00:00:00Z' + (row_number() over (order by title)) * interval '1 minute' as at from entity) t where t.id = e.id`);
  await l.init(human, { name: 'Owner' });
  const { run } = await sessionStart(l, agent, { task: made.hover, session_id: 'pin', title: 'Pinning session' });
  return { l, made: { ...made, run } };
}

/** What each standing view answers on the fixture, by name. */
async function answers() {
  const { l, made } = await fixture();
  const ask = (name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'agent', name: 'test' }, name, params).catch((err: Error) => ({ refused: err.message }));
  const out: Record<string, unknown> = {
    'graph focus all closed 1': await ask('graph', { focus: made.installer, relations: 'all', include_closed: true, depth: 1 }),
    'graph focus all closed 2': await ask('graph', { focus: made.installer, relations: 'all', include_closed: true, depth: 2 }),
    'graph focus all 3': await ask('graph', { focus: made.addin, relations: 'all', depth: 3 }),
    'graph focus closed item': await ask('graph', { focus: made.clean }),
    'graph focus blocking': await ask('graph', { focus: made.sign }),
    'graph focus structure system': await ask('graph', { focus: made.app, relations: 'structure', include_system: true, depth: 4 }),
    'graph newest blocking': await ask('graph', {}),
    'graph newest structure closed': await ask('graph', { relations: 'structure', include_closed: true }),
    'graph newest all system': await ask('graph', { relations: 'all', include_system: true }),
    'tree roots': await ask('tree', {}),
    'tree app': await ask('tree', { root: made.app }),
    'tree business': await ask('tree', { root: made.business }),
    'tree addin': await ask('tree', { root: made.addin }),
    'hubs app': await ask('hubs', { within: made.app }),
    'hubs repo': await ask('hubs', { within: made.repo }),
    'attention me': await ask('attention', { person: 'me' }),
    'attention app': await ask('attention', { within: made.app }),
    'brief sign': await ask('brief', { task: made.sign }),
    'brief hover': await ask('brief', { task: made.hover }),
    'brief installer': await ask('brief', { task: made.installer }),
    'handoff repo': await ask('handoff', { repo: made.repo }),
    'gate release': await ask('gate', { event: made.release }),
    'gate events': await ask('gate', {}),
    'lens app': await ask('lens', { from: made.app }),
    'lens kinds': await ask('lens', { kinds: ['software.feature'] }),
    'lens view': await ask('lens', { lens: made.view }),
    'lens holding': await ask('lens', { from: made.extras, lens: 'holding' }),
    'lens near': await ask('lens', { from: made.sign, near: 2, over: 'all' }),
  };
  // Names for ids: the refs that made them, the workspace owner's person as "owner".
  const names = new Map<string, string>(Object.entries(made).map(([ref, id]) => [id, ref]));
  const owner = (await l.setting<string>('me')) ?? '';
  if (owner && !names.has(owner)) names.set(owner, 'owner');
  const named = normalise(out, names) as Record<string, Record<string, unknown>>;
  // A style is the page's, and long (its drawings' code): pinned by its hash.
  for (const answer of Object.values(named)) if (answer && typeof answer.style === 'object') answer.style = createHash('sha256').update(JSON.stringify(answer.style)).digest('hex');
  return named;
}

const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/** Ids named, times dropped, as JSON. */
function normalise(value: unknown, names: Map<string, string>): unknown {
  const rename = (s: string) => s.replace(/\b[er]_[a-z0-9]{8}\b/g, (id) => (names.has(id) ? `<${names.get(id)}>` : id.startsWith('r_') ? '<link>' : `<${id}>`));
  const walk = (v: unknown): unknown => {
    if (v instanceof Date) return '<time>';
    if (typeof v === 'string') return TIME.test(v) ? '<time>' : rename(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [rename(k), walk(x)]));
    return v;
  };
  return JSON.parse(JSON.stringify(walk(value), (_k, v) => (v instanceof Date ? '<time>' : v)), (_k, v) => (typeof v === 'string' && TIME.test(v) ? '<time>' : v));
}

/** The paths of the lists in an answer (indices as []), each with its value at each place it is found. */
function lists(value: unknown, path = '', out = new Map<string, string[]>()): Map<string, string[]> {
  if (Array.isArray(value)) {
    out.set(path, [...(out.get(path) ?? []), JSON.stringify(value)]);
    value.forEach((v) => lists(v, `${path}[]`, out));
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) lists(v, `${path}.${k}`, out);
  return out;
}

/** The answer with every list at an unordered path sorted. */
function ordered(value: unknown, unordered: Set<string>, path = ''): unknown {
  if (Array.isArray(value)) {
    const each = value.map((v) => ordered(v, unordered, `${path}[]`));
    // Sorted by the element with every list in it sorted, so the order does not hang on the order of what is inside.
    const key = (v: unknown) => JSON.stringify(canon(v));
    return unordered.has(path) ? each.sort((a, b) => key(a).localeCompare(key(b))) : each;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v, unordered, `${path}.${k}`)]));
  return value;
}

/** Sorted as a set, a list's order no longer says anything: what is unordered once is compared as a set at every path below. */
const canon = (value: unknown) => ordered(value, new Set([...lists(value).keys()]));

test('every standing view answers agents as it did on the old lens', { timeout: 120_000 }, async () => {
  if (process.env.PIN_RECORD) {
    // Five runs: a list whose order is not the same in all of them is ordered by ids, and compared as a set.
    const runs = [await answers(), await answers(), await answers(), await answers(), await answers()];
    // Outermost first, so a list is looked at with the lists that hold it already ordered.
    const unordered = new Set<string>();
    const paths = [...lists(runs[0]).keys()].sort((a, b) => a.split('[]').length - b.split('[]').length || a.length - b.length);
    for (const path of paths) {
      const seen = runs.map((r) => lists(ordered(r, unordered)).get(path) ?? []);
      const each = (one: string) => (JSON.parse(one) as unknown[]).map((v) => JSON.stringify(canon(v)));
      const orders = seen.map((s) => JSON.stringify(s.map(each)));
      const sets = seen.map((s) => JSON.stringify(s.map((one) => each(one).sort())));
      // Same members in every run but not the same order: unordered.
      if (orders.some((o) => o !== orders[0]) && sets.every((x) => x === sets[0])) unordered.add(path);
    }
    for (const r of runs.slice(1)) assert.deepEqual(ordered(r, unordered), ordered(runs[0], unordered), 'the fixture answers the same each run');
    writeFileSync(PINNED, `${JSON.stringify({ unordered: [...unordered].sort(), answers: ordered(runs[0], unordered) }, null, 1)}\n`);
  }
  assert.ok(existsSync(PINNED), 'record the pinned answers first: PIN_RECORD=1');
  const pinned = JSON.parse(readFileSync(PINNED, 'utf8')) as { unordered: string[]; answers: Record<string, unknown> };
  const now = ordered(await answers(), new Set(pinned.unordered)) as Record<string, unknown>;
  for (const name of Object.keys(pinned.answers)) assert.deepEqual(now[name], pinned.answers[name], name);
});
