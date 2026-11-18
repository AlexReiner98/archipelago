// The rule form apart (packs/rules/kernel/apart.ts) and the glob meeting it decides by (packs/rules/kernel/globs.ts):
// two lanes on one island whose files meet are refused, unless both depend on one overlap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRules } from '../packs/loader/kernel/rule-check.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { globsMeet, meeting } from '../packs/rules/kernel/globs.ts';
import '../packs/rules/kernel/apart.ts';
import type { RuleDef } from '../packs/rules/kernel/rules.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import type { Op } from '../packs/write/kernel/pelago-types.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

test('globs meet where some path could match both', () => {
  const meet: [string, string][] = [
    ['packs/rules/**', 'packs/rules/kernel/rules.ts'],
    ['packs/rules/kernel/rules.ts', 'packs/rules/kernel/rules.ts'],
    ['**', 'anything/at/all.js'],
    ['src/**/*.ts', 'src/a/b/c.ts'],
    ['src/**/*.ts', 'src/c.ts'],
    ['src/*.ts', 'src/a*.ts'],
    ['src/a*', 'src/*b'],
    ['test/rule-?.test.ts', 'test/rule-*.test.ts'],
    ['packs/{rules,loader}/kernel/*.ts', 'packs/loader/**'],
    ['./ui/x.js', 'ui/x.js'],
    ['ui\\x.js', 'ui/*.js'],
    ['packs/*/kernel/[ab].ts', 'packs/x/kernel/a.ts'],
    ['packs/**/kernel/**', '**/rules.ts'],
    ['!packs/**', 'src/a.ts'],
  ];
  const apart: [string, string][] = [
    ['ui/*.js', 'src/**'],
    ['ui/*.js', 'ui/a/b.js'],
    ['src/*.ts', 'src/a.js'],
    ['packs/rules/kernel/apart.ts', 'packs/rules/kernel/globs.ts'],
    ['packs/{rules,loader}/kernel/*.ts', 'packs/write/**'],
    ['test/rule-?.test.ts', 'test/rule-ab.test.ts'],
    ['src/a*b', 'src/c*'],
  ];
  for (const [a, b] of meet) assert.ok(globsMeet(a, b) && globsMeet(b, a), `${a} meets ${b}`);
  for (const [a, b] of apart) assert.ok(!globsMeet(a, b) && !globsMeet(b, a), `${a} does not meet ${b}`);
  assert.deepEqual(meeting(['packs/rules/**', 'ui/*.js'], ['packs/rules/kernel/rules.ts', 'src/**']), ['packs/rules/** ~ packs/rules/kernel/rules.ts']);
  assert.deepEqual(meeting(['a.ts'], ['a.ts']), ['a.ts']);
});

const lane = { id: 'apart.lane', title: 'Lane', description: 'A lane.', extends: 'work', statuses: { open: ['planned', 'working'], closed: ['merged'] }, fields: { files: { type: 'json' } } };
const overlap = { id: 'apart.overlap', title: 'Overlap', description: 'Where lanes meet.', extends: 'work' };
const RULES: RuleDef[] = [{ id: 'lanes_apart', type: 'apart.lane', apart: { field: 'files', link: 'depends_on', unless: 'apart.overlap' } }];
const pack = (rules: RuleDef[] = RULES) => ({ id: 'apart', version: '1.0.0', title: 'Apart', description: 'A pack to try apart with.', requires: ['core'], types: [lane, overlap], rules }) as unknown as PackFile;

const send = (l: Archipelago, ops: Op[], who = agent) => l.change(who, { reason: 'test', authority: { of: 'agent', basis: 'a test' }, ops }) as Promise<{ status?: string; created?: Record<string, string> }>;
const refusal = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as Error).message; } return ''; };

test('apart is checked as its pack loads', () => {
  const reg = new Registry(packsWith(pack()));
  assert.deepEqual(checkRules(RULES, reg), [], 'the rule as written holds');
  const bad = (rule: RuleDef) => checkRules([rule], reg).join('\n');
  const apart = RULES[0].apart!;
  assert.match(bad({ id: 'x', apart }), /type it holds of/);
  assert.match(bad({ id: 'x', type: 'apart.lane', apart: { ...apart, field: 'nothing' } }), /no field "nothing"/);
  assert.match(bad({ id: 'x', type: 'apart.lane', apart: { ...apart, link: 'no_such' } }), /link type the packs define/);
  assert.match(bad({ id: 'x', type: 'apart.lane', apart: { ...apart, unless: 'no.type' } }), /apart.unless/);
  assert.match(bad({ id: 'x', type: 'apart.lane', apart, when: { actor: 'agent' } }), /takes no when/);
  assert.match(bad({ id: 'x', type: 'apart.lane', apart, at_most: { link: 'depends_on', n: 1 } }), /a rule of its own/);
});

async function map() {
  const l = await freshWith(new Registry(packsWith(pack())));
  await setIslands(l, human, true);
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"'::jsonb) on conflict (key) do update set value = excluded.value`);
  const made = await make(l, [
    { op: 'create', ref: 'home', type: 'island', title: 'Home', props: { pack: 'apart' } },
    { op: 'create', ref: 'away', type: 'island', title: 'Away', props: { pack: 'apart' } },
  ] as Op[]);
  const lanes = await make(l, [{ op: 'create', ref: 'one', type: 'apart.lane', title: 'Lane one', status: 'working', props: { island: made.home, files: ['packs/rules/**'] } }] as Op[]);
  return { l, ...made, ...lanes } as { l: Archipelago } & Record<string, string>;
}

test('a lane whose files meet another on its island is refused, naming it and the globs', async () => {
  const { l, home, away } = await map();
  const said = await refusal(send(l, [{ op: 'create', type: 'apart.lane', title: 'Lane two', status: 'planned', props: { island: home, files: ['packs/rules/kernel/rules.ts', 'ui/*.js'] } }] as Op[]));
  assert.match(said, /"Lane two" and "Lane one" both touch packs\/rules\/kernel\/rules\.ts ~ packs\/rules\/\*\*/);
  assert.doesNotMatch(said, /ui\/\*\.js/, 'only the globs that meet are named');
  assert.equal((await send(l, [{ op: 'create', type: 'apart.lane', title: 'Lane three', props: { island: home, files: ['src/**'] } }] as Op[])).status, 'applied', 'files apart pass');
  assert.equal((await send(l, [{ op: 'create', type: 'apart.lane', title: 'Lane far', props: { island: away, files: ['packs/rules/**'] } }] as Op[])).status, 'applied', 'another island is apart');
});

test('two lanes that depend on one overlap may meet; cutting it, or moving the files onto another, is refused', async () => {
  const { l, home, one } = await map();
  const { two, o } = await make(l, [
    { op: 'create', ref: 'o', type: 'apart.overlap', title: 'Both share rules', props: { island: home } },
    { op: 'create', ref: 'two', type: 'apart.lane', title: 'Lane two', props: { island: home, files: ['packs/rules/kernel/rules.ts'] } },
    { op: 'link', type: 'depends_on', from: 'two', to: 'o' },
    { op: 'link', type: 'depends_on', from: one, to: 'o' },
  ] as Op[]);
  assert.ok(two && o, 'made in one change, with the overlap');
  const { rows } = await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and to_id = $2 and valid_to is null`, [two, o]);
  assert.match(await refusal(send(l, [{ op: 'unlink', relation: rows[0].id }] as Op[])), /"Lane two" and "Lane one" both touch/);
  const { three } = await make(l, [{ op: 'create', ref: 'three', type: 'apart.lane', title: 'Lane three', props: { island: home, files: ['src/**'] } }] as Op[]);
  assert.match(await refusal(send(l, [{ op: 'update', id: three, props: { files: ['packs/rules/globs.ts'] } }] as Op[])), /"Lane three" and "Lane one"/);
});

test('a closed lane holds no files, and a lane closing is never refused', async () => {
  const { l, home, one } = await map();
  const { two } = await make(l, [
    { op: 'create', ref: 'o', type: 'apart.overlap', title: 'Overlap', props: { island: home } },
    { op: 'create', ref: 'two', type: 'apart.lane', title: 'Lane two', props: { island: home, files: ['packs/**'] } },
    { op: 'link', type: 'depends_on', from: 'two', to: 'o' },
    { op: 'link', type: 'depends_on', from: one, to: 'o' },
  ] as Op[]);
  assert.equal((await send(l, [{ op: 'update', id: one, status: 'merged' }] as Op[])).status, 'applied');
  assert.match(await refusal(send(l, [{ op: 'create', type: 'apart.lane', title: 'Lane four', props: { island: home, files: ['packs/rules/**', 'src/x.ts'] } }] as Op[])), /"Lane four" and "Lane two" both touch packs\/rules\/\*\* ~ packs\/\*\*/, 'Lane two still holds packs/**');
  assert.equal((await send(l, [{ op: 'update', id: two, status: 'merged' }] as Op[])).status, 'applied');
  assert.equal((await send(l, [{ op: 'create', type: 'apart.lane', title: 'Lane five', props: { island: home, files: ['packs/rules/**'] } }] as Op[])).status, 'applied', 'every lane that held them is closed');
});
