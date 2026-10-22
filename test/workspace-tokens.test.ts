import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { sought, within } from '../src/reader.ts';
import { limiter } from '../src/limit.ts';
import { serve } from './serve.ts';

test('an agent\'s token can be limited to some repositories, and its owner hears when a token is used from a new place', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const made = (
    await call('/api/change', admin, {
      reason: 'x',
      ops: [
        { op: 'create', ref: 'r', type: 'software.repo', title: 'Site repo', props: { remote: 'https://github.com/acme/site' } },
        { op: 'create', ref: 'other', type: 'software.repo', title: 'Books repo', props: { remote: 'https://github.com/acme/books' } },
        { op: 'create', ref: 'p', type: 'work.project', title: 'Site' },
        { op: 'create', ref: 't', type: 'work.task', title: 'Fix the footer' },
        { op: 'create', ref: 'o', type: 'work.task', title: 'Close the year' },
        { op: 'link', type: 'software.lives_in', from: 'p', to: 'r' },
        { op: 'link', type: 'part_of', from: 't', to: 'p' },
      ],
    })
  ).result.created;
  // Its owner makes it within one repository, with an end. It is within an item of the map, and only an agent's is scoped.
  assert.match((await call('/api/token_create', admin, { kind: 'agent', name: 'x', within: ['e_nothing1'] })).error, /no item in this map/);
  assert.match((await call('/api/token_create', admin, { kind: 'human', name: 'x', within: [made.r] })).error, /Only an agent/);
  assert.match((await call('/api/token_create', admin, { kind: 'human', name: 'x', may: 'report' })).error, /Only an agent/);
  const site = (await call('/api/token_create', admin, { kind: 'agent', name: 'site-machine', within: [made.r], expires_days: 90 })).result.token;
  const free = (await call('/api/token_create', admin, { kind: 'agent', name: 'everywhere' })).result.token;
  const listed = (await call('/api/token_list', admin)).result.find((t: any) => t.name === 'site-machine');
  assert.deepEqual([listed.within, listed.within_titles, listed.may, Math.round((Date.parse(listed.expires_at) - Date.now()) / 86_400_000)], [[made.r], ['Site repo'], 'change', 90]);

  const change = (token: string, ops: unknown[]) => call('/agent/change', token, { reason: 'test', ops });
  // What is the repository's it can change; what is not, it cannot, though it can read it.
  assert.equal((await change(site, [{ op: 'update', id: made.t, status: 'doing' }])).result.status, 'proposed');
  assert.match((await change(site, [{ op: 'update', id: made.o, status: 'done' }])).error, /limited to the work of Site repo\. "Close the year" is not part of it, so this token cannot change it/);
  assert.equal((await call('/agent/get', site, { id: made.o })).result.entity.title, 'Close the year');
  assert.equal((await change(free, [{ op: 'update', id: made.o, status: 'doing' }])).result.status, 'proposed', 'a token with no limit is as before');
  // What it makes has to be tied into that work in the same change; then it may be.
  assert.match((await change(site, [{ op: 'create', type: 'work.task', title: 'Loose' }])).error, /made without being tied to anything there/);
  assert.equal((await change(site, [{ op: 'create', ref: 'n', type: 'work.task', title: 'Test the footer' }, { op: 'create', ref: 'q', type: 'work.decision', title: 'Which footer?' }, { op: 'link', type: 'part_of', from: 'n', to: made.p }, { op: 'link', type: 'depends_on', from: 'n', to: 'q' }])).result.status, 'proposed');
  // It may say its work waits on something outside, but not hang anything on what is outside, nor merge, archive or retype the map.
  assert.equal((await change(site, [{ op: 'link', type: 'depends_on', from: made.t, to: made.o }])).result.status, 'proposed');
  assert.match((await change(site, [{ op: 'link', type: 'depends_on', from: made.o, to: made.t }])).error, /cannot change what it is linked to/);
  assert.match((await change(site, [{ op: 'archive', id: made.o }])).error, /cannot archive it/);
  assert.match((await change(site, [{ op: 'merge', keep: made.t, drop: made.o }])).error, /cannot merge it/);
  assert.match((await change(site, [{ op: 'define_type', type: { id: 'local.x', title: 'X', description: 'x' } }])).error, /cannot define a type/);
  // Nor speak for another repository, or take on work that is not its own.
  assert.match((await call('/agent/rechecked', site, { repo: 'acme/books' })).error, /cannot speak for another repository/);
  assert.equal((await call('/agent/rechecked', site, { repo: 'acme/site' })).status, 200);
  const run = (await call('/agent/session_start', site, { title: 'On the site' })).result.run;
  assert.match((await call('/agent/session_update', site, { run, task: made.o })).error, /cannot take it on/);
  assert.equal((await call('/agent/session_update', site, { run, task: made.t })).status, 200);

  // What it may call is a list. Beyond changing its own work it reads, and what else writes is held to that work too.
  const more = (
    await call('/api/change', admin, {
      reason: 'x',
      ops: [
        { op: 'create', ref: 'q', type: 'software.proof', title: 'Does the footer stay down?' },
        { op: 'create', ref: 'mine', type: 'software.test', title: 'Footer stays down', props: { entrypoint: 'Footer.StaysDown' } },
        { op: 'create', ref: 'theirs', type: 'software.test', title: 'Books balance', props: { entrypoint: 'Books.Balance' } },
        { op: 'create', ref: 'lane', type: 'resource', title: 'The one browser' },
        { op: 'create', ref: 'press', type: 'resource', title: 'The printing press' },
        { op: 'create', ref: 'shared', type: 'resource', title: 'The one lane' },
        { op: 'link', type: 'part_of', from: 'q', to: made.p },
        { op: 'link', type: 'software.answers', from: 'mine', to: 'q' },
        { op: 'link', type: 'needs', from: made.t, to: 'lane' },
        { op: 'link', type: 'needs', from: made.o, to: 'press' },
      ],
    })
  ).result.created;
  for (const tool of ['backup', 'confirmed', 'check_connections', 'import_audit']) {
    const input = tool === 'confirmed' ? { upto: 1, basis: 'x' } : tool === 'import_audit' ? { connection: 'x' } : {};
    assert.match((await call(`/agent/${tool}`, site, input)).error, new RegExp(`limited to the work of Site repo\\. It cannot call ${tool}\\.`));
  }
  for (const tool of ['schema', 'search', 'proposals']) assert.equal((await call(`/agent/${tool}`, site, {})).status, 200, `${tool} only reads`);
  // A test's results: for a test that helps answer a question of its work, not for another's.
  const report = (results: unknown[]) => call('/agent/test_report', site, { build: '1.0.0', results });
  assert.match((await report([{ test: 'Books.Balance', passed: true }])).error, /"Books balance" is not part of it/);
  assert.match((await report([{ test: 'Footer.StaysDown', passed: true }, { test: more.theirs, passed: true }])).error, /is not part of it/);
  assert.equal((await report([{ test: 'Footer.StaysDown', passed: true }])).status, 200);
  assert.deepEqual((await report([{ test: 'Nobody.KnowsThis', passed: true }])).result.answer.unknown, ['Nobody.KnowsThis'], 'a test the map does not know is named, as for any token');
  const theirResult = (await call('/api/test_report', admin, { build: '1.0.0', results: [{ test: 'Books.Balance', passed: true }] })).result;
  assert.equal(theirResult.answer.recorded, 1);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const resultOf = async (test: string) => (await call('/api/get', admin, { id: test })).result.outgoing.find((r: any) => r.type === 'produced')?.id;
  assert.match((await call('/agent/picture_put', site, { result: await resultOf(more.theirs), data: png, content_type: 'image/png' })).error, /is not part of it, so this token cannot keep a picture/);
  // A resource: one its work needs or that no work is said to need, held for its work; not one that is other work's.
  assert.equal((await call('/agent/claim', site, { resource: more.shared, holder: run, reason: 'x' })).status, 200);
  assert.equal((await call('/agent/release', site, { resource: more.shared, holder: run, reason: 'x' })).status, 200);
  assert.match((await call('/agent/claim', site, { resource: more.press, holder: run, reason: 'x' })).error, /Nothing there needs "The printing press"/);
  assert.match((await call('/agent/release', site, { resource: more.press, reason: 'x' })).error, /cannot release it/);
  assert.match((await call('/agent/claim', site, { resource: more.lane, holder: run, for: made.o, reason: 'x' })).error, /cannot hold a resource for it/);
  assert.equal((await call('/agent/claim', site, { resource: more.lane, holder: run, for: made.t, reason: 'x' })).status, 200);
  assert.equal((await call('/agent/release', site, { resource: more.lane, holder: run, reason: 'x' })).status, 200);
  // And it tells the owner only of its own work.
  assert.match((await call('/agent/notify', site, { title: 'Look', about: made.o })).error, /cannot send a notification about it/);
  assert.equal((await call('/agent/notify', site, { title: 'Look', about: made.t })).status, 200);
  assert.equal((await call('/agent/check_connections', free, {})).status, 200, 'a token with no limit calls what it could');

  // The hooks of a machine with such a token register and speak for sessions in its repositories, and no others.
  const sessions = async () => (await call('/agent/view', free, { name: 'sessions' })).result.open.map((s: any) => s.title);
  const before = await sessions();
  const elsewhere = await call('/hooks/session-start', site, { session_id: 'desk-books', cwd: '/x', remote: 'https://github.com/acme/books.git' });
  assert.match(elsewhere.hookSpecificOutput.additionalContext, /limited to some repositories[^]*not registered in Archipelago/);
  assert.deepEqual(await sessions(), before, 'nothing was registered');
  const here = await call('/hooks/session-start', site, { session_id: 'desk-site', cwd: '/x', remote: 'https://github.com/acme/site.git' });
  assert.match(here.hookSpecificOutput.additionalContext, /registered in Archipelago[^]*Site repo/);
  // A session another token registered in another repository is not ended, or counted for, by this one.
  await call('/hooks/session-start', free, { session_id: 'desk-other', cwd: '/x', remote: 'https://github.com/acme/books.git' });
  assert.equal((await sessions()).length, before.length + 2);
  await call('/hooks/session-end', site, { session_id: 'desk-other', reason: 'exit' });
  assert.equal((await sessions()).length, before.length + 2, 'still open');
  await call('/hooks/session-end', site, { session_id: 'desk-site', reason: 'exit' });
  assert.equal((await sessions()).length, before.length + 1, 'its own is ended');

  // Used from a network it has not been used from, its owner is told, once for that network. The first place is not news.
  const from = (address: string) => fetch(`${base}/agent/search`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${site}`, 'x-forwarded-for': address }, body: '{}' });
  const notices = async () => (await call('/api/view', admin, { name: 'notifications' })).result.filter((n: any) => /new place/.test(n.title));
  assert.equal((await notices()).length, 0);
  await from('203.0.113.9');
  assert.deepEqual((await notices()).map((n: any) => [n.title, /203\.0\.113\.x/.test(n.body)]), [['The token "site-machine" was used from a new place', true]]);
  await from('203.0.113.200, 10.0.0.1');
  assert.equal((await notices()).length, 1, 'the same network is the same place');
  await from('198.51.100.7');
  assert.equal((await notices()).length, 2);
  assert.equal((await call('/api/token_list', admin)).result.find((t: any) => t.name === 'site-machine').seen.length, 3);
});

test('a workspace chooses whether agents’ changes are applied as made or held, the answer to a question with them', async () => {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const member = (await createToken(db, 'default', { kind: 'human', name: 'sam' })).token;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const change = (token: string, ops: unknown[], authority?: unknown) => call(token === admin ? '/api/change' : '/agent/change', token, { reason: 'x', ops, authority });
  const made = (await change(admin, [
    { op: 'create', ref: 'a', type: 'work.task', title: 'Paint the fence', visibility: 'shared' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'Paint the fence again', visibility: 'shared' },
    { op: 'create', ref: 'd', type: 'work.decision', title: 'Which colour?', visibility: 'shared' },
  ])).result.created;

  assert.equal((await call('/api/workspace_info', admin)).result.agent_changes, 'hold', 'held unless the workspace says otherwise');
  assert.equal((await change(robot, [{ op: 'create', type: 'work.note', title: 'One', visibility: 'shared' }])).result.status, 'proposed');
  assert.match((await call('/api/workspace_set', member, { agent_changes: 'apply' })).error, /admin/);
  assert.match((await call('/agent/workspace_set', robot, { agent_changes: 'apply' })).error, /humans only/, 'an agent cannot let itself through');

  assert.equal((await call('/api/workspace_set', admin, { agent_changes: 'apply' })).result.agent_changes, 'apply');
  const applied = (await change(robot, [{ op: 'create', type: 'work.note', title: 'Two', visibility: 'shared' }])).result;
  assert.equal(applied.status, 'applied');
  assert.equal((await change(robot, [{ op: 'merge', keep: made.a, drop: made.b }])).result.status, 'applied', 'merging too');
  assert.equal((await change(robot, [{ op: 'archive', id: made.a }])).result.status, 'applied', 'and archiving');
  // An agent can settle a question too, when the record stands on its own, and the human is told.
  assert.match((await change(robot, [{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Green' } }])).error, /what was chosen \(props\.outcome\) and why \(props\.rationale\)/);
  const green = [{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Green', rationale: 'It is the paint we have.' } }];
  assert.match((await change(robot, green)).error, /on whose authority/, 'and on whose authority');
  assert.match((await change(robot, green, { of: 'human' })).error, /what they said and where/, 'a human\u2019s word has to be quoted');
  const word = { of: 'human', basis: 'Alex, in chat on 8 Oct: "go with green"' };
  const answer = (await change(robot, green, word)).result;
  const onWord = { ...word, stated_by: 'agent:robot/script' };
  assert.deepEqual([answer.status, answer.answered], ['applied', [{ id: made.d, title: 'Which colour?', status: 'decided', outcome: 'Green', authority: onWord }]]);
  // The human is not sent a notification for each: what agents settled is put to them in one list, by the next session they talk to.
  assert.deepEqual((await call('/api/view', admin, { name: 'notifications' })).result, []);
  const toConfirm = async () => (await call('/agent/view', robot, { name: 'attention', params: { reasons: ['to_confirm'] } })).result;
  const asked = await toConfirm();
  assert.deepEqual(asked.items.map((q: any) => [q.title, q.reasons[0].answer, q.reasons[0].on, q.reasons[0].basis]), [['Which colour?', 'Green', 'the owner\u2019s word, as the agent reports it', word.basis]]);
  // Their answer is recorded as their word, as the agent reports it: not as a human having looked.
  assert.match((await call('/agent/confirmed', robot, { upto: asked.to_confirm.upto })).error, /basis/);
  const said = (await call('/agent/confirmed', robot, { upto: asked.to_confirm.upto, basis: 'Alex, in chat on 9 Oct: "yes, green"' })).result;
  assert.deepEqual([said.questions, said.left], [1, 0]);
  // What an agent settled on its own judgment comes first and is counted apart: it is what the owner has not seen.
  const guessed = (await change(admin, [{ op: 'create', ref: 'h', type: 'inquiry.hypothesis', title: 'Green fades', visibility: 'shared' }, { op: 'create', ref: 'd', type: 'work.decision', title: 'Which brush?', visibility: 'shared' }])).result.created;
  await change(robot, [{ op: 'update', id: guessed.d, status: 'decided', props: { outcome: 'The wide one', rationale: 'It is the one we have.' } }], word);
  await change(robot, [{ op: 'update', id: guessed.h, status: 'refuted' }], { of: 'agent', basis: 'A month of photos' });
  await change(robot, [{ op: 'create', type: 'work.note', title: 'Three', visibility: 'shared' }]);
  const sorted = await toConfirm();
  assert.deepEqual([sorted.to_confirm.on_agents_judgment, sorted.to_confirm.on_owners_word, sorted.items.map((q: any) => q.title)], [1, 1, ['Green fades', 'Which brush?']]);  const relayed = ((await call('/agent/events', robot, { limit: 50 })).result as any[]).find((e) => e.action === 'questions.confirmed');
  assert.deepEqual(relayed.detail.authority, { of: 'human', basis: 'Alex, in chat on 9 Oct: "yes, green"', stated_by: 'agent:robot/script' });
  // An agent reads what one actor did by naming them, and reads the log back by page.
  const byRobot = (await call('/agent/events', robot, { by: 'agent:robot/script', limit: 50 })).result as any[];
  assert.ok(byRobot.length > 0 && byRobot.every((e) => e.actor === 'agent:robot/script'));
  assert.ok(((await call('/agent/events', robot, { before: byRobot[0].seq, limit: 50 })).result as any[]).every((e) => e.seq < byRobot[0].seq));
  const guess = (await change(admin, [{ op: 'create', ref: 'h', type: 'inquiry.hypothesis', title: 'Green hides dirt', visibility: 'shared' }])).result.created.h;
  assert.equal((await change(robot, [{ op: 'update', id: guess, status: 'supported' }], { of: 'agent', basis: 'Two weeks of photos' })).result.status, 'applied', 'and a hypothesis');
  // Every change says on whose authority it was made: the human's own, a human's word as an agent reports it, or the agent's judgment.
  const authorityOf = async (id: string) => ((await call('/api/events', admin, { target: id, limit: 1 })).result as any[])[0].detail.authority;
  assert.deepEqual(await authorityOf(made.d), onWord);
  assert.deepEqual(await authorityOf(guess), { of: 'agent', who: 'agent:robot/script', basis: 'Two weeks of photos' });
  assert.deepEqual(await authorityOf(applied.created['#1']), { of: 'agent', who: 'agent:robot/script' }, 'unsaid, it is the agent\u2019s own');
  const mine = (await change(admin, [{ op: 'create', ref: 'n', type: 'work.note', title: 'Mine', visibility: 'shared' }], { of: 'agent' })).result.created.n;
  assert.deepEqual([(await authorityOf(mine)).of, /alex/.test((await authorityOf(mine)).who)], ['human', true], 'a human\u2019s own change is theirs, whatever it claims');

  // What was applied is on the record, with who made it, and can be put back.
  const logged = ((await call('/agent/events', robot, { limit: 50 })).result as any[]).filter((e) => e.changeset === applied.changeset);
  assert.deepEqual([logged.length > 0, logged.every((e) => /robot/.test(e.actor))], [true, true]);
  assert.equal((await call('/api/undo', admin, { changeset: applied.changeset })).status, 200);
  // That a human looked is a record of its own, and nothing an agent can make for them.
  assert.match((await call('/agent/seen', robot, { upto: logged[0].seq })).error, /humans only/);
  assert.equal((await call('/api/seen', admin, { upto: logged[0].seq })).result.seen_upto, logged[0].seq);
  const looked = ((await call('/api/events', admin, { limit: 5 })).result as any[]).find((e) => e.action === 'changes.seen');
  assert.deepEqual([looked.detail.upto, /alex/.test(looked.actor), logged[0].target_type], [logged[0].seq, true, 'work.note']);

  await call('/api/workspace_set', admin, { agent_changes: 'hold' });
  assert.equal((await change(robot, [{ op: 'create', type: 'work.note', title: 'Three', visibility: 'shared' }])).result.status, 'proposed');
  const [held] = (await call('/api/proposals', admin)).result as any[];
  const let_in = (await call('/api/decide', admin, { proposal: held.id, approve: true })).result;
  const by = (await authorityOf(Object.values(let_in.created)[0] as string)) as any;
  assert.deepEqual([by.of, /alex/.test(by.who), by.stated_by], ['human', true, undefined], 'what a human applies rests on that human');
  const set = ((await call('/api/events', admin, { limit: 50 })).result as any[]).filter((e) => e.action === 'workspace.set').map((e) => e.reason);
  assert.deepEqual(set, ['agent_changes set to "hold"', 'agent_changes set to "apply"'], 'and the choice itself is in the log');
});

test('a product\u2019s public page is open to anyone, and says nothing until something is made public', async () => {
  const { call, base } = await serve('off');
  const made = await call('/api/change', undefined, {
    reason: 'x',
    ops: [
      { op: 'create', ref: 'app', type: 'work.project', title: 'App', body: 'An internal note' },
      { op: 'create', ref: 'sun', type: 'software.proof', title: 'How do we know the sun is correct?' },
      { op: 'link', type: 'part_of', from: 'sun', to: 'app' },
    ],
  });
  const app = made.result.created.app;
  const get = (path: string) => call(path, undefined, undefined, 'GET');
  assert.equal((await get(`/p/default/${app}/data`)).status, 404);
  await call('/api/change', undefined, { reason: 'x', ops: [{ op: 'update', id: app, visibility: 'public' }, { op: 'update', id: made.result.created.sun, visibility: 'public' }] });
  const page = await get(`/p/default/${app}/data`);
  assert.deepEqual([page.status, page.title, page.questions.map((q: any) => q.title)], [200, 'App', ['How do we know the sun is correct?']]);
  assert.ok(!JSON.stringify(page).includes('internal note'));
  // The page itself is a shell that asks for the data; it carries nothing of the map, and may load nothing from elsewhere.
  const shell = await fetch(`${base}/p/default/${app}`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(await shell.text(), /public\.js/);
  assert.equal((await fetch(`${base}/public.js`)).status, 200);
  // What is not there is not there: another product, another workspace, a picture that was never kept.
  assert.equal((await get(`/p/default/e_nothing1/data`)).status, 404);
  assert.equal((await get(`/p/elsewhere/${app}/data`)).status, 404);
  assert.equal((await get(`/p/default/${app}/picture/${made.result.created.sun}`)).status, 404);
});

test('what answers without a token is asked only so often: by one address, and by all together', async () => {
  // The count itself: so many a minute for each address, and the minute starts again.
  let clock = 0;
  const count = limiter({ each: 2, all: 3 }, () => clock);
  assert.deepEqual([count.take('a'), count.take('a'), count.take('a')], [0, 0, 60]);
  clock = 30_000;
  assert.deepEqual([count.take('b'), count.take('b'), count.take('c')], [0, 30, 30], 'a third address is stopped by what all have asked together');
  clock = 60_000;
  assert.equal(count.take('a'), 0);

  const { base, call } = await serve('tokens', { open: { each: 3, all: 5 }, deliveries: { each: 2 } });
  const get = (path: string, address: string) => fetch(base + path, { headers: { 'x-forwarded-for': address } });
  const statuses = async (path: string, address: string, times: number) => {
    const seen: number[] = [];
    for (let i = 0; i < times; i++) seen.push((await get(path, address)).status);
    return seen;
  };
  // Nothing is public here, so a page's data is not found; asked a fourth time, it is refused instead, and says for how long.
  assert.deepEqual(await statuses('/p/default/e_nothing1/data', '198.51.100.1', 3), [404, 404, 404]);
  const refused = await get('/p/default/e_nothing1/data', '198.51.100.1');
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get('retry-after')) >= 1 && Number(refused.headers.get('retry-after')) <= 60);
  assert.match(((await refused.json()) as { error: string }).error, /too often/);
  // The page, its pictures and the setup script are counted together.
  assert.deepEqual([(await get('/p/default/e_nothing1', '198.51.100.1')).status, (await get('/connect/setup.mjs', '198.51.100.1')).status], [429, 429]);
  // Another address is not held up by the first, until all together have asked as much as all may.
  assert.deepEqual(await statuses('/connect/setup.mjs', '198.51.100.2', 2), [200, 200]);
  assert.equal((await get('/connect/setup.mjs', '198.51.100.3')).status, 429);
  // Deliveries are counted apart, and an unsigned one is refused as unsigned until it is asked too often.
  const deliver = async () => (await fetch(base + '/hook/default/github/github.push', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.1' }, body: '{}' })).status;
  assert.deepEqual([await deliver(), await deliver(), await deliver()], [401, 401, 429]);
  // What needs a token, and health, are not counted.
  assert.equal((await get('/health', '198.51.100.1')).status, 200);
  assert.equal((await call('/api/search', undefined, {})).status, 401);
});

test('a request larger than any honest one is refused, before it is known who sent it', async () => {
  const { base } = await serve('tokens');
  const send = (headers: Record<string, string>, megabytes: number, whole = true) =>
    new Promise<number | 'ended'>((resolve, reject) => {
      const req = request(base + '/hook/default/github/github.push', { method: 'POST', agent: false, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        if (!whole) req.destroy();
      });
      // The server answers while the body is still on its way and ends the connection, so the answer can be lost to the sender.
      req.on('error', (err: NodeJS.ErrnoException) => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? resolve('ended') : reject(err)));
      req.flushHeaders();
      const piece = Buffer.alloc(1_000_000, 0x20);
      for (let i = 0; i < megabytes; i++) req.write(piece);
      if (whole) req.end();
    });
  // By what it says it carries, and by what arrives when it does not say.
  assert.equal(await send({ 'content-length': '33000000' }, 0, false), 413);
  assert.ok([413, 'ended'].includes(await send({}, 33)));
  assert.equal(await send({}, 1), 401, 'one that is not too large is refused for the reason it would have been: it is not signed');
});

test('the reader asks GitHub only about the one repository, whatever the text it read there tells it to ask', () => {
  // A path or a ref is part of an address under the repository: a step up would land in another one.
  assert.equal(within('src/a file.ts'), 'src/a%20file.ts');
  assert.equal(within('feature/x'), 'feature/x');
  assert.equal(within(undefined), '');
  for (const path of ['../../other/contents/secrets.txt', 'src/../../../other', './x', '..']) assert.throws(() => within(path), /steps outside the repository/);
  // An encoded step is a name like any other to GitHub, and stays encoded.
  assert.equal(within('%2e%2e/x'), '%252e%252e/x');
  // A search is of this repository: words that say where to search are dropped.
  assert.equal(sought('api key repo:someone/private'), 'api key');
  assert.equal(sought('ORG:acme user: me token'), 'token');
  assert.equal(sought('reporter: is a word'), 'reporter: is a word');
});

