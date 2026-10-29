import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { countLook } from '../src/looks.ts';
import { bytes, limitsFrom, requestsThisMinute, useOf } from '../src/plan.ts';
import { runAct } from '../src/server-acts.ts';
import { loadServerPacks } from '../src/server-packs.ts';
import { serve } from './serve.ts';

const FIXTURES = join(import.meta.dirname, 'server-packs');
before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: FIXTURES }));
after(() => void delete process.env.PELAGO_SERVER_PACKS);

const PLAN = { plan: 'Solo', note: 'Move to Team for more.', manage: 'https://seller.example/billing' };
/** The refusal names the plan, says how to make room, and where to change it. */
const NAMES_PLAN = /on the Solo plan.*Move to Team for more\. Change the plan at https:\/\/seller\.example\/billing\./;

test('a plan’s limits are read from what the pack sends: each optional, and none at all is no limit', () => {
  assert.deepEqual(limitsFrom({ members: 1, storage: 1e9, requests: 300, sessions: 5, looks: 30 }, { plan: 'Solo' }), { members: 1, storage: 1e9, requests: 300, sessions: 5, looks: 30, plan: 'Solo' });
  assert.deepEqual(limitsFrom({ storage: 5e9, members: null }, {}), { storage: 5e9 });
  assert.equal(limitsFrom({ members: null }, { plan: 'Solo' }), null);
  assert.throws(() => limitsFrom({ sessions: 0 }, {}), /sessions: a whole number from 1/);
  assert.throws(() => limitsFrom({ requests: 2.5 }, {}), /requests: a whole number/);
  assert.equal(bytes(1_500_000_000), '1.5 GB');
  const use = useOf({ storage: 1e9, sessions: 5 }, { members: 0, storage: 850e6, requests: 0, sessions: 5, looks: 0 });
  assert.deepEqual(use.map(({ name, shown, of, near, over }) => [name, shown, of, near, over]), [['storage', '850 MB', '1 GB', true, false], ['sessions', '5', '5 agent sessions at once', true, true]]);
});

test('over each limit what would add to it is refused, naming the plan, and reads, export and backup go on working', async () => {
  const { workspaces, call } = await serve('tokens');
  const pack = loadServerPacks([FIXTURES]).packs[0].file;
  const act = (name: string, input: Record<string, unknown>) => runAct(workspaces, pack, name, input);
  const { workspace } = (await act('workspace.create', { name: 'Plan Co' })) as { workspace: { id: string } };
  const ws = await workspaces.get(workspace.id);
  const person = ((await act('workspace.admit', { workspace: ws.id, email: 'ola@plan.example', admin: true })) as { person: string }).person;
  const owner = (await createToken(ws.pelago.db, ws.id, { kind: 'human', name: 'ola@plan.example', entity: person, admin: true })).token;
  const agent = (await createToken(ws.pelago.db, ws.id, { kind: 'agent', name: 'claude' })).token;
  const limit = (limits: Record<string, unknown>) => act('workspace.limit', { workspace: ws.id, ...PLAN, ...limits });
  const write = (title: string) => call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', type: 'task', title }] });
  const reads = async () => {
    assert.equal((await call('/api/search', owner, { q: 'Kept' })).status, 200, 'a read');
    const backup = await call('/api/backup_download', owner, {});
    assert.equal(backup.status, 200, 'the backup');
    assert.match(backup.result.path, /^\/backup-file\//);
  };
  assert.ok((await write('Kept')).result.created, 'a write within the plan');
  const note = (await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 'n', type: 'note', title: 'A figure' }] })).result.created.n;

  // Storage: the log and pictures take more than the plan has, so nothing more is written, a picture included.
  assert.deepEqual(await limit({ storage: 1 }), { workspace: ws.id, storage: 1 });
  const refused = await write('One too many');
  assert.equal(refused.status, 400);
  assert.match(refused.error, /Plan Co has room for 1 bytes on the Solo plan, and holds .*: nothing more is written until there is room/);
  assert.match(refused.error, NAMES_PLAN);
  assert.match((await call('/api/picture_put', owner, { result: note, data: 'iVBORw0KGgo=', content_type: 'image/png' })).error, /Plan Co has room for 1 bytes/);
  await reads();
  const info = (await call('/api/workspace_info', owner)).result;
  assert.deepEqual(info.use.map((u: any) => [u.name, u.over]), [['storage', true]], 'the Plan card is told');
  await limit({ storage: 10e9 });
  assert.equal((await write('Room again')).status, 200, 'more room, and it writes');

  // Sessions at once: one more past the plan's is refused; the one at work goes on.
  await limit({ sessions: 1 });
  const start = (session_id: string) => call('/agent/capture', agent, { action: 'session_start', params: { session_id } });
  assert.ok((await start('first')).result.run);
  const second = await start('second');
  assert.match(second.error, /room for 1 agent session at once on the Solo plan, and has 1: end one/);
  assert.match(second.error, NAMES_PLAN);
  assert.ok((await start('first')).result.resumed, 'the session at work is heard again');
  await reads();

  // Looks an hour: past the plan's, the next is refused (a look's drawing needs Chrome: here only its count).
  await limit({ looks: 2 });
  await countLook(ws.id);
  await countLook(ws.id);
  await assert.rejects(countLook(ws.id), (err: Error) => /room for 2 looks an hour on the Solo plan, and has 2: read one again/.test(err.message) && NAMES_PLAN.test(err.message));

  // Members, as before, and the Plan card at 80% of a limit.
  await limit({ members: 1, storage: 10e9 });
  assert.match((await call('/api/member_add', owner, { email: 'kim@plan.example' })).error, /Plan Co has room for 1 member\. Move to Team/);
  const use = (await call('/api/workspace_info', owner)).result.use;
  assert.deepEqual(use.map((u: any) => [u.name, u.shown, u.near, u.over]), [['members', '1', false, false], ['storage', use[1].shown, false, false]], 'one seat, filled, is no warning');
  await limit({ members: 2, sessions: 1 });
  assert.deepEqual((await call('/api/workspace_info', owner)).result.use.map((u: any) => [u.name, u.near, u.over]), [['members', false, false], ['sessions', true, true]], 'at 80% and at the limit, the card is told');

  // Requests a minute, all the workspace's tokens together: past them, 429 with when to ask again. Reads too, until then.
  await limit({ requests: requestsThisMinute(ws.id) + 2 });
  assert.equal((await call('/api/search', owner, { q: 'Kept' })).status, 200);
  assert.equal((await call('/api/search', agent, { q: 'Kept' })).status, 200);
  const over = await call('/api/search', owner, { q: 'Kept' });
  assert.equal(over.status, 429);
  assert.match(over.error, /room for .* requests a minute on the Solo plan.*try again in \d+ seconds/);
  await limit({});
  assert.equal((await call('/api/search', owner, { q: 'Kept' })).status, 200, 'lifted');
});

test('one token is slowed past its requests a minute, wherever it is used', async () => {
  const { workspaces, call, base } = await serve('tokens', { token: { each: 20 } });
  const ws = await workspaces.get('default');
  const token = (await createToken(ws.pelago.db, ws.id, { kind: 'agent', name: 'loop' })).token;
  let got: { r: Response; body: { error: string } } | undefined;
  for (let n = 0; n < 20 * 2 + 2; n++) {
    const r = await fetch(`${base}/agent/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"name":"schema"}' });
    const body = (await r.json()) as { error: string };
    if (r.status === 429) {
      got = { r, body };
      break;
    }
  }
  assert.ok(got, 'refused before twice its limit');
  assert.ok(Number(got.r.headers.get('retry-after')) >= 1);
  assert.match(got.body.error, /This token has made 20 requests this minute/);
  const other = (await createToken(ws.pelago.db, ws.id, { kind: 'agent', name: 'other' })).token;
  assert.equal((await call('/agent/query', other, { name: 'schema' })).status, 200, 'another token is not slowed by it');
});
