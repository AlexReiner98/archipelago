// Service names (docs/kernel-packs.md, "Service names"): one owner per name, a caller's need checked by shape, and
// each closed list opened as a family a pack provides: answers, terms, capabilities, settings, pieces and pages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCapabilities } from '../src/capabilities.ts';
import { checkDeclared, KERNEL_OWNS } from '../src/declared.ts';
import { isName, needOf, orderPacks, providersOf } from '../src/packorder.ts';
import type { PackFile } from '../src/packs.ts';
import { answerPreset } from '../src/query-presets.ts';
import { checkServices, fillServices, fits, meets, shapeProblem, valueProblem, type ServiceFn } from '../src/services.ts';
import { callTool } from '../src/tools.ts';
import { flatRead } from '../src/query-flat.ts';
import type { Actor } from '../src/pelago.ts';
import { fresh, make } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const pack = (id: string, more: Record<string, unknown> = {}) => ({ id, version: '1', ...more }) as unknown as PackFile;
const core = pack('core');
const ATTENTION = { in: { viewer: 'id', 'limit?': 'number' }, out: [{ id: 'id', why: 'string' }] } as const;

test('a service is a name of its own form, provided by the pack whose kernel key says so', () => {
  assert.ok(isName('service:answer.attention'));
  assert.deepEqual(needOf('service:answer.attention'), { by: 'service', name: 'answer.attention' });
  const p = pack('attention', { kernel: { provides: { 'answer.attention': ATTENTION } } });
  assert.deepEqual(providersOf('service:answer.attention', [core, p]), ['attention']);
  assert.deepEqual(providersOf('service:answer.brief', [core, p]), []);
});

test('one owner: a second pack providing a name waits, and a caller with no provider waits saying which', () => {
  const a = pack('a', { kernel: { provides: { 'answer.attention': ATTENTION } } });
  const b = pack('b', { kernel: { provides: { 'answer.attention': ATTENTION } } });
  const user = pack('user', { requires: ['service:answer.brief'] });
  const { states } = orderPacks(new Map([['core', core], ['a', a], ['b', b], ['user', user]]), new Map(), 'local');
  assert.equal(states.get('a')!.state, 'active');
  assert.equal(states.get('b')!.state, 'waiting');
  assert.match(states.get('b')!.why!, /service:answer\.attention is a's: one pack owns a name/);
  assert.match(states.get('user')!.why!, /needs service:answer\.brief: no pack here provides it/);
});

test('checked by shape: more is fine, less waits, naming the field', () => {
  const provider = pack('p', { kernel: { provides: { 'answer.attention': ATTENTION } } });
  const happy = pack('happy', { requires: ['service:answer.attention'], kernel: { calls: { 'answer.attention': { in: { viewer: 'id', extra: 'string' }, out: [{ id: 'string' }] } } } });
  const greedy = pack('greedy', { requires: ['service:answer.attention'], kernel: { calls: { 'answer.attention': { in: { viewer: 'id' }, out: [{ id: 'id', score: 'number' }] } } } });
  const silent = pack('silent', { requires: ['service:answer.attention'], kernel: { calls: { 'answer.attention': { in: {}, out: [{ id: 'id' }] } } } });
  const { states } = orderPacks(new Map([['core', core], ['p', provider], ['happy', happy], ['greedy', greedy], ['silent', silent]]), new Map(), 'local');
  assert.equal(states.get('happy')!.state, 'active', 'an id serves where a string is read; a field sent and not wanted is let be');
  assert.match(states.get('greedy')!.why!, /out lacks what the caller reads: \[\]\.score is not there/);
  assert.match(states.get('silent')!.why!, /in wants what the caller does not send: viewer is not there/);
  assert.equal(fits({ 'a?': 'number' }, { 'a?': 'string' }), 'a is "number", not string');
  assert.equal(meets({ out: 'any' }, { out: { anything: 'string' } }), undefined);
});

test('a shape is a JSON sketch, and a value is checked against it', () => {
  assert.equal(shapeProblem({ a: ['id'], 'b?': { c: 'boolean' } }), undefined);
  assert.match(shapeProblem({ a: 'date' })!, /"date" is no shape/);
  assert.match(shapeProblem(['id', 'id'])!, /a list's shape is one shape/);
  assert.equal(valueProblem({ zone: 'Europe/Berlin' }, { zone: 'string', 'days?': ['number'] }), undefined);
  assert.equal(valueProblem({ days: [1, 'x'] }, { 'days?': ['number'] }), 'it.days[1] is a number');
});

test('what the kernel still answers is its own: a pack may not provide it, and a setting says who reads it', () => {
  const p = pack('x', { kernel: { provides: { 'answer.frontier': ATTENTION, 'term.held': {}, 'setting.zone': { out: 'string' }, 'sort.of': {}, 'piece.chart': { read: 'member' } } } });
  const problems = checkServices(p, KERNEL_OWNS);
  assert.ok(problems.some((m) => /answers answer "frontier" itself/.test(m)));
  assert.ok(problems.some((m) => /answers term "held" itself/.test(m)));
  assert.ok(problems.some((m) => /"setting.zone": a setting says .* who reads it/.test(m)));
  assert.ok(problems.some((m) => /"sort.of" is no service name/.test(m)));
  assert.ok(problems.some((m) => /"piece.chart": only a setting says who reads it/.test(m)));
  assert.deepEqual(checkServices(pack('y', { kernel: { provides: { 'answer.inbox': { out: [{ id: 'id' }] }, 'setting.zone': { out: 'string', read: 'member' } } } }), KERNEL_OWNS), []);
});

test('a pack names an answer, a piece or a page it provides or requires, and nothing else', () => {
  const views = [{ id: 'v.inbox', description: 'inbox', shape: 'rows', lens: {}, answer: 'inbox' }, { id: 'v.s', form: 'screen', title: 'S', nav: true, pieces: [{ piece: 'chart' }, { piece: 'page', page: 'calendar' }] }];
  const without = checkDeclared(pack('v', { views }), new Map(), [], false);
  assert.ok(without.some((m) => /answer is one of .*service:answer/.test(m)));
  assert.ok(without.some((m) => /"chart" is not a piece/.test(m)));
  assert.ok(without.some((m) => /no page "calendar"/.test(m)));
  const opened = pack('v', { views, requires: ['service:answer.inbox', 'service:piece.chart'], kernel: { provides: { 'page.calendar': {} } } });
  assert.deepEqual(checkDeclared(opened, new Map(), [], false), []);
});

test('a capability a pack opens may be carried; one nobody opened is refused', () => {
  assert.match(checkCapabilities({ tide: {} } as never, {}, new Set())[0], /"tide" is not a capability/);
  assert.deepEqual(checkCapabilities({ tide: {} } as never, {}, new Set(), [], ['tide']), []);
});

test('an answer and a term a pack provides are asked of it, and a term answers ids alone', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'a', type: 'task', title: 'Kept' }, { op: 'create', ref: 'b', type: 'task', title: 'Left' }]);
  const asked: unknown[] = [];
  fillServices(l.registry, new Map<string, ServiceFn>([
    ['answer.inbox', async (input: unknown) => (asked.push(input), { rows: [] })],
    ['term.near', async (input: unknown) => (asked.push(input), { ids: [made.a] })],
    ['term.broken', async () => ({ ids: 'no' })],
  ]));
  assert.deepEqual(await answerPreset(l, { id: 'v.inbox', description: '', shape: 'rows', lens: { over: ['x'] }, answer: 'inbox' }, { limit: 3 }), { rows: [] });
  assert.deepEqual(asked[0], { limit: 3, lens: { over: ['x'] } });
  const found = (await flatRead(l, { filter: { find: ['type task'], only: ['near Kept'] } })) as { items: { title: string }[] };
  assert.deepEqual(found.items.map((i) => i.title), ['Kept']);
  assert.deepEqual(asked[1], { end: 'Kept', me: null });
  await assert.rejects(flatRead(l, { filter: { find: ['type task'], only: ['broken'] } }), /answered no ids/);
  await assert.rejects(flatRead(l, { filter: { find: ['type task'], only: ['nowhere'] } }), /is no term/);
  fillServices(l.registry, new Map());
  await assert.rejects(answerPreset(l, { id: 'v.inbox', description: '', shape: 'rows', lens: {}, answer: 'inbox' }, {}), /No pack here provides service:answer\.inbox/);
});

test('a setting a pack provides is set by its key, checked by its shape, and read by a member only when it says so', async () => {
  const l = await fresh();
  l.registry.packs.push(pack('clock', { kernel: { provides: { 'setting.zone': { out: 'string', read: 'member' }, 'setting.secret_hour': { out: 'number', read: 'admin' } } } }));
  await assert.rejects(callTool(l, owner, 'workspace_set', { settings: { zone: 3 } }), /The setting "zone" \(clock's\): zone is a string/);
  await assert.rejects(callTool(l, owner, 'workspace_set', { settings: { tide: 1 } }), /No pack here provides the setting "tide": these do, zone, secret_hour/);
  const info = (await callTool(l, owner, 'workspace_set', { settings: { zone: 'Europe/Berlin', secret_hour: 3 } })) as { settings: Record<string, unknown> };
  assert.deepEqual(info.settings, { zone: 'Europe/Berlin', secret_hour: 3 });
  const member = l.as('e_member1');
  assert.equal(await member.setting('member.zone'), 'Europe/Berlin', 'every member reads what the pack opened to members');
  assert.equal(await member.setting('admin.secret_hour'), undefined, 'and not what is an admin’s');
  await assert.rejects(member.db.query(`insert into setting (key, value) values ('member.zone', '"x"'::jsonb)`), 'reading is all the prefix opens');
  await callTool(l, owner, 'workspace_set', { settings: { zone: null } });
  assert.equal(await member.setting('member.zone'), undefined);
});
