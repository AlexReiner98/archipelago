// The connect pack's connections card as a part (packs/connect/parts/connections, task e_s7mfcvp6): run as its
// worker runs it, its marks the host's check takes and each press the action it sends; and the actions it sends on the
// server (packs/connect/kernel/part-connections.ts), an admin's, so each goes only with an admin's press's grant.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import connections from '../packs/connect/parts/connections/index.js';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { configureConnections } from '../packs/surface/kernel/root-connections.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh } from './map.ts';

const manifest = JSON.parse(readFileSync(new URL('../packs/connect/pack.json', import.meta.url), 'utf8'));
const kinds = manifest.parts.find((p: { id: string }) => p.id === 'connect.connections').marks;
const check = (marks: unknown) => checkMarks(marks, { kinds });

const GITHUB = { pack: 'github_app', title: 'GitHub', ready: true, name: 'GitHub App', can_setup: false, connected: { id: '42', account: 'acme' } };
const SLACK = { pack: 'slack', title: 'Slack', ready: false, name: null, can_setup: true, connected: null };

test('the card lists what connects, offers an admin what comes next, and sends it on their press', async () => {
  const sent: unknown[] = [];
  const answers = [{ status: undefined, answer: { url: 'https://example.com/go', packs: [GITHUB, SLACK] } }, { status: undefined, answer: { ended: true, packs: [{ ...GITHUB, connected: null }, SLACK] } }];
  const tools = { marks: () => {}, act: async (action: string, params: unknown) => (sent.push([action, params]), answers.shift()) };
  const part = connections({ views: { connections: { packs: [GITHUB, SLACK] } }, piece: { section: 'packs' }, admin: true }, tools);
  check(part.marks);
  const said = JSON.stringify(part.marks);
  assert.match(said, /"connected"/);
  assert.match(said, /acme/, 'the account outside');
  assert.match(said, /"setup:slack"/, 'Set up, where the server may ready it');
  check(await part.on({ name: 'press', key: 'start:github_app' }));
  assert.match(JSON.stringify(await part.on({ name: 'press', key: 'nothing' }) ?? part.update({ views: { connections: { packs: [GITHUB, SLACK] } }, piece: { section: 'packs' }, admin: true })), /"href":"https:\/\/example.com\/go"/, 'where to go, a link opened apart');
  // Disconnect is asked again before it goes.
  const asked = await part.on({ name: 'press', key: 'ask-end:github_app' });
  check(asked);
  assert.match(JSON.stringify(asked), /"end:github_app"/);
  assert.equal(sent.length, 1);
  check(await part.on({ name: 'press', key: 'end:github_app' }));
  assert.deepEqual(sent, [['connect.start', { pack: 'github_app' }], ['connect.end', { pack: 'github_app' }]]);
  assert.deepEqual(part.update({ views: { connections: { packs: [GITHUB] } }, piece: { section: 'map' } }), ['box', {}], 'nothing in another section');
});

test('the card offers no admin’s act to a person who is not one, and draws nothing where nothing connects', () => {
  const part = connections({ views: { connections: { packs: [GITHUB, SLACK] } }, piece: { section: 'packs' } }, { marks: () => {}, act: async () => ({}) });
  check(part.marks);
  assert.doesNotMatch(JSON.stringify(part.marks), /"key":"(start|setup|ask-end):/);
  assert.deepEqual(connections({ views: { connections: { packs: [] } }, piece: { section: 'packs' } }, {}).marks, ['box', {}]);
});

/** One server pack that connects, answered from memory (as test/connections-tool.test.ts). */
function server() {
  const control = { query: async (sql: string, params: unknown[]) => (sql.includes('delete from control_value') ? { rows: [{ key: `${params[0]}42`, value: { workspace: 'default', account: 'acme' } }] } : { rows: [] }) };
  const file = { id: 'github_app', title: 'GitHub', reach: { server: { connect: { status: 'status', start: 'start', setup: 'setup' } } } };
  configureConnections({
    packs: [{ file }],
    control: async () => control,
    connectionOf: async (_pack: string, workspace: string) => (workspace === 'default' ? { id: '42', workspace, account: 'acme' } : undefined),
    call: async (_pack: string, _kind: string, entry: string, input: Record<string, unknown>) => (entry === 'status' ? { ready: true, name: 'GitHub App' } : { url: `https://example.com/go?for=${input.purpose}` }),
  } as never);
}

test('connect’s actions go from its part only with an admin’s press, and an end is logged as that admin', async (t) => {
  t.after(() => configureConnections(undefined));
  server();
  const l = await fresh();
  try {
    const admin = { kind: 'human' as const, name: 'test', admin: true };
    const card = partsFor(l.registry).find((p) => p.id === 'connect.connections')!;
    assert.deepEqual(card.admin, ['connect.start', 'connect.end']);
    const part = { id: card.id, hash: card.hash };
    const listed = (await callTool(l, admin, 'view', { name: 'connections' })) as { packs: { pack: string }[] };
    assert.deepEqual(listed.packs.map((p) => p.pack), ['github_app']);
    // The list is a person's alone, as the connections tool was: an agent is neither told of it nor answered.
    await assert.rejects(callTool(l, { kind: 'agent', name: 'a' }, 'view', { name: 'connections' }), /asked by a person alone/);
    assert.ok(!Object.keys((await callTool(l, { kind: 'agent', name: 'a' }, 'view', {})) as object).includes('connections'), 'not in the list an agent reads');
    await assert.rejects(callTool(l, admin, 'connect_start', { pack: 'github_app', part }), /an admin's own press/);
    const grant = ((await callTool(l, admin, 'press_grant', { part })) as { grant: string }).grant;
    const started = (await callTool(l, admin, 'connect_start', { pack: 'github_app', part: { ...part, grant } })) as { answer: { url: string; packs: unknown[] } };
    assert.equal(started.answer.url, 'https://example.com/go?for=connect');
    assert.equal(started.answer.packs.length, 1);
    await assert.rejects(callTool(l, admin, 'connect_end', { pack: 'github_app', part: { ...part, grant } }), /an admin's own press/, 'the grant was spent');
    const again = ((await callTool(l, admin, 'press_grant', { part })) as { grant: string }).grant;
    await callTool(l, admin, 'connect_end', { pack: 'github_app', part: { ...part, grant: again } });
    const { rows } = await l.db.query<{ head: Record<string, unknown> }>(`select head from log_op where stream = 'activity' order by pos desc limit 1`);
    assert.deepEqual(rows[0].head.actor, { id: 'human:test' }, 'ended as the admin');
    await assert.rejects(callTool(l, { kind: 'agent', name: 'a' }, 'connect_start', { pack: 'github_app' }), /admins only/);
  } finally {
    hostFor(l.registry).stop();
  }
});
