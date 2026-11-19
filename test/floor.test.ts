// The genesis floor (packs/rules/kernel/floor.ts): core's protecting rules, kept in code, whose items on the map may only
// tighten. An agent tries to retire, edit and override each floor rule; every attempt is refused or held. A person's
// loosening is refused too: the floor changes in code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Archipelago, Op } from '../packs/write/kernel/pelago.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { FLOOR, floorRules, loosens, onFloor } from '../packs/rules/kernel/floor.ts';
import type { RuleDef } from '../packs/rules/kernel/rules.ts';
import { agent, freshWith, human, packsWith, PACKS } from './map.ts';

const core = JSON.parse(readFileSync(join(PACKS, 'core', 'pack.json'), 'utf8')) as { rules: RuleDef[] };
const judging = core.rules.filter((r) => r.then !== undefined);

/** A pack whose items are rules, shaped as core's rule type (packs/pack_model/README.md), opening the capability the judge also reads. */
const RULEBOOK: PackFile = {
  id: 'rulebook', version: '1', title: 'Rulebook', requires: ['core'], uses: ['service:capability.judges'],
  types: [{
    id: 'rulebook.rule', title: 'Rule', description: '', extends: 'record',
    statuses: { open: ['current'], closed: ['retired'] },
    fields: { declares: { type: 'string' }, spec: { type: 'json' }, shipped: { type: 'json' }, preset: { type: 'string' } },
    capabilities: { judges: {} } as never, // a capability its pack opens (uses), which the kernel's list does not know
  }],
} as PackFile;

async function map(): Promise<Archipelago> {
  return freshWith(new Registry(packsWith(RULEBOOK)), { create: 'auto', update: 'auto', link: 'auto', archive: 'auto', merge: 'auto', restore: 'auto' });
}

const change = (l: Archipelago, who: typeof agent, ops: Op[]) => l.change(who, { reason: 'test', ops });
const spec = ({ id: _, ...r }: RuleDef) => r;
const item = (r: RuleDef, pack = 'core') => ({ op: 'create', type: 'rulebook.rule', title: `${pack}.${r.id}`, status: 'current', props: { declares: r.id, spec: spec(r), shipped: { pack, version: '1', hash: 'sha256:0', value: r } } }) as Op;
/** The owner's version of a rule: an item naming it by preset, read over it. */
const version = (r: RuleDef) => ({ op: 'create', type: 'rulebook.rule', title: `${r.id}, ours`, props: { preset: r.id, spec: spec(r) } }) as Op;

/** The floor's rules as items, made by a person as a map begins: each matches code, so each passes. */
async function seeded(l: Archipelago) {
  const made = await change(l, human, judging.map((r, i) => ({ ...item(r), ref: `r${i}` }) as Op));
  assert.equal(made.status, 'applied');
  const ids = (made as { created: Record<string, string> }).created;
  return new Map(judging.map((r, i) => [r.id!, ids[`r${i}`]]));
}

/** What an attempt comes to: refused (with what it said), held, or applied. */
async function outcome(l: Archipelago, who: typeof agent, ops: Op[]): Promise<string> {
  try { return (await change(l, who, ops)).status; } catch (e) { return `refused: ${(e as Error).message}`; }
}

/** Ways to loosen a rule, each a new definition: it does less, matches less, is lifted, or for a spare, spares more. */
function loosenings(r: RuleDef): [string, RuleDef][] {
  if (r.then === 'spare') {
    const key = Object.keys(r.when ?? {})[0];
    return [['widens its when', { ...r, when: Object.fromEntries(Object.entries(r.when ?? {}).filter(([k]) => k !== key)) }], ['spares every rule', { ...r, spares: undefined }]];
  }
  return [
    ['does less', { ...r, then: r.then === 'refuse' ? 'hold' : 'ask' }],
    ['matches less', { ...r, when: { ...r.when, ...(r.when?.asked === undefined ? { asked: true } : { said: true }) } }],
    ['is lifted by a new setting', { ...r, lifted: 'agent_anything' }],
    ...(r.server ? [] : [['is lifted by the server', { ...r, server: true }] as [string, RuleDef]]),
    ['is renamed', { ...r, id: `${r.id}_old` }],
  ];
}

test('the floor names every rule of core that judges, and nothing else', () => {
  assert.deepEqual(judging.map((r) => r.id).filter((id) => !onFloor('core', id)), [], 'a judging rule of core is placed on the floor (FLOOR, with why) or off it, on purpose');
  assert.deepEqual(Object.keys(FLOOR).filter((id) => !judging.some((r) => r.id === id)), [], 'every floor rule is one of core');
  assert.equal(floorRules(core).length, Object.keys(FLOOR).length);
  for (const id of ['agent_changes', 'settle', 'forget', 'code_runs', 'public']) assert.ok(onFloor('core', id), id);
  assert.ok(!onFloor('sessions', 'agent_changes'), "a floor rule is core's");
});

test('a rule only tightens: the same, more, stronger and unlifted pass; less, narrower and lifted do not', () => {
  const r = judging.find((x) => x.id === 'agent_changes')!;
  assert.equal(loosens(r, { ...r }), '');
  assert.equal(loosens(r, { ...r, then: 'refuse' }), '', 'refusing is stronger than holding');
  assert.equal(loosens(r, { ...r, when: { ...r.when, op: [...(r.when!.op as string[]), 'forget'] } }), '', 'more ops match more');
  assert.equal(loosens(r, { ...r, when: { op: r.when!.op } }), '', 'dropping the actor matches people too');
  assert.equal(loosens(r, { ...r, lifted: undefined, server: undefined }), '', 'no longer liftable is tighter');
  assert.equal(loosens(r, { ...r, say: 'Waits for Alex.' }), '', 'what it says is words');
  assert.match(loosens(r, { ...r, when: { ...r.when, op: ['create'] } }), /narrows when.op/);
  assert.match(loosens(r, { ...r, when: { ...r.when, actor: 'human' } }), /narrows when.actor/);
  assert.match(loosens(r, undefined), /retires/);
  const settle = judging.find((x) => x.id === 'settle')!;
  assert.match(loosens(settle, { ...settle, when: { ...settle.when, status: { from: 'open', to: 'cancelled' } } }), /narrows when.status/);
  const spare = judging.find((x) => x.then === 'spare')!;
  assert.equal(loosens(spare, { ...spare, when: { ...spare.when, asked: true } }), '', 'a spare that matches less spares less');
  assert.equal(loosens(spare, { ...spare, then: 'hold' }), '', 'a spare made a hold spares nothing');
});

test('an agent cannot retire, loosen or override any floor rule', async () => {
  const l = await map();
  const items = await seeded(l);
  for (const r of judging) {
    const id = items.get(r.id!)!;
    const tried: [string, Op[]][] = [
      ['archives it', [{ op: 'archive', id }]],
      ['forgets it', [{ op: 'forget', id }]],
      ['retires it by status', [{ op: 'update', id, status: 'retired' }]],
      ['merges it away', [{ op: 'merge', keep: items.get(judging.find((x) => x.id !== r.id)!.id!)!, drop: id }]],
      ...loosenings(r).map(([how, def]) => [`edits it so it ${how}`, [{ op: 'update', id, props: { declares: def.id, spec: spec(def) } }]] as [string, Op[]]),
      ...loosenings(r).filter(([how]) => how !== 'is renamed').flatMap(([how, def]) => [[`overrides it with a copy that ${how}`, [item(def)]], [`makes an owner's version that ${how}`, [version(def)]]] as [string, Op[]][]),
    ];
    for (const [how, ops] of tried) assert.match(await outcome(l, agent, ops), /^refused: .*loosen the floor/s, `an agent ${how}: ${r.id}`);
  }
});

test('an agent cannot spare a floor rule by a new rule', async () => {
  const l = await map();
  await seeded(l);
  const bookkeeping: RuleDef = { id: 'mine', when: { bookkeeping: true }, then: 'spare' };
  assert.match(await outcome(l, agent, [item(bookkeeping, 'sessions')]), /^refused: .*spares floor rules/s, 'a spare of every rule');
  assert.match(await outcome(l, agent, [item({ id: 'let', when: { actor: 'agent' }, then: 'spare', spares: ['agent_changes'] })]), /^refused: .*floor rule/s, 'a core spare naming a floor rule');
  const plain = (await change(l, human, [{ ...item({ id: 'quiet', when: { actor: 'agent', op: 'publish' }, then: 'hold' }, 'practice'), ref: 'q' } as Op])) as { created: Record<string, string> };
  assert.match(await outcome(l, agent, [{ op: 'update', id: plain.created.q, props: { declares: 'agent_changes', shipped: { pack: 'core' }, spec: { when: { actor: 'human' }, then: 'hold' } } }]), /^refused: .*overrides a floor rule/s, "a rule renamed into a floor rule's place");
});

test("an agent's change to any rule item waits for the owner, a tightening included", async () => {
  const l = await map();
  const items = await seeded(l);
  const r = judging.find((x) => x.id === 'public')!;
  const tighter = await change(l, agent, [{ op: 'update', id: items.get('public')!, props: { spec: spec({ ...r, then: 'refuse' }) } }]);
  assert.equal(tighter.status, 'proposed', 'a tightening by an agent waits');
  assert.equal((tighter as { held_by?: { rule: string } }).held_by?.rule ?? 'rule_items', 'rule_items');
  assert.equal((await change(l, agent, [item({ id: 'new_one', when: { actor: 'agent', op: 'publish' }, then: 'hold' }, 'practice')])).status, 'proposed', 'a new rule by an agent waits');
  assert.equal((await change(l, agent, [version({ ...r, then: 'refuse' })])).status, 'proposed', "an agent's tighter version waits");
});

test('a person tightens a floor rule, and is refused a loosening: the floor changes in code', async () => {
  const l = await map();
  const items = await seeded(l);
  const r = judging.find((x) => x.id === 'agent_changes')!;
  assert.equal((await change(l, human, [{ op: 'update', id: items.get('agent_changes')!, props: { spec: spec({ ...r, lifted: undefined, server: undefined }) } }])).status, 'applied');
  assert.match(await outcome(l, human, [{ op: 'update', id: items.get('agent_changes')!, props: { spec: spec(r) } }]), /^refused: .*is lifted by agent_changes/s, 'a tightened rule stays tightened: its lift does not come back');
  assert.match(await outcome(l, human, [{ op: 'archive', id: items.get('forget')! }]), /^refused: .*retires the rule/s);
});
