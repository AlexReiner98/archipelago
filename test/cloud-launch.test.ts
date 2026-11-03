import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { checkAutomation, weekdays } from '../src/automation-rules.ts';
import { Automations } from '../src/automations.ts';
import { heldResources } from '../src/blocking.ts';
import { checkCloud, configureCloud, githubUrl, REPO_TOKEN } from '../src/cloud-launch.ts';
import { launch } from '../src/launcher.ts';
import { ACCOUNT } from '../src/model-account.ts';
import { sessionEnd } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { fresh, human, make } from './map.ts';

after(() => configureCloud(undefined));

/** Anthropic, faked: each call is kept, and a session answers as `state` says. */
function fakeAnthropic() {
  const calls: { method: string; path: string; body?: any; key?: string }[] = [];
  const state = { status: 'running', stop: 'end_turn', said: 'Posted the week’s plan.' };
  let n = 0;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch: typeof globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const call = { method: init?.method ?? 'GET', path: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: (init?.headers as Record<string, string>)['x-api-key'] };
    calls.push(call);
    assert.equal((init?.headers as Record<string, string>)['anthropic-beta'], 'managed-agents-2026-04-01');
    const id = (prefix: string) => `${prefix}_${++n}`;
    if (call.method === 'POST' && u.pathname === '/v1/agents') return reply({ id: id('agent') });
    if (call.method === 'POST' && u.pathname === '/v1/environments') return reply({ id: id('env') });
    if (call.method === 'POST' && u.pathname === '/v1/vaults') return reply({ id: id('vlt') });
    if (call.method === 'POST' && /\/credentials$/.test(u.pathname)) return reply({ id: id('cred') });
    if (call.method === 'POST' && u.pathname === '/v1/sessions') return reply({ id: id('sesn'), status: 'running' });
    if (call.method === 'GET' && /^\/v1\/sessions\/[^/]+$/.test(u.pathname)) return reply({ status: state.status, stop_reason: { type: state.stop } });
    if (call.method === 'GET' && /\/events$/.test(u.pathname)) return reply({ data: [{ type: 'span.model_request_end' }, { type: 'agent.message', content: [{ type: 'text', text: state.said }] }] });
    if (call.method === 'DELETE' || /\/events$/.test(u.pathname)) return new Response(null, { status: 204 });
    return reply({ error: { message: 'not faked' } }, 404);
  }) as typeof globalThis.fetch;
  return { calls, state, fetch };
}

test('a weekly trigger names its days and fires once on each, at its time', async () => {
  assert.deepEqual(weekdays(['monday', 'Fri', 7]), [1, 5, 7]);
  assert.deepEqual(weekdays('mon'), [1]);
  assert.equal(weekdays(['mo']), undefined, 'two letters name no day for sure');
  assert.equal(weekdays([8]), undefined);
  assert.equal(weekdays([]), undefined);
  assert.deepEqual(checkAutomation({ trigger: 'weekly', days: ['monday'], at: '09:00', action: 'notify' }), []);
  assert.match(checkAutomation({ trigger: 'weekly', at: '9:00', action: 'notify' }).join('; '), /needs days[\s\S]*needs at as "HH:MM"/);

  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'w', type: 'automation', title: 'Weekly posting', status: 'enabled', props: { trigger: 'weekly', days: ['monday'], at: '09:00', action: 'notify' } }]);
  const autos = new Automations(l);
  const fired = async (when: Date) => (await autos.tick(when)).map((f) => f.automation);
  // 2 Nov 2026 is a Monday.
  assert.deepEqual(await fired(new Date(2026, 10, 2, 8, 59)), [], 'not before its time');
  assert.deepEqual(await fired(new Date(2026, 10, 2, 9, 0)), [made.w]);
  assert.deepEqual(await fired(new Date(2026, 10, 2, 15, 0)), [], 'once on its day');
  assert.deepEqual(await fired(new Date(2026, 10, 3, 9, 0)), [], 'not on a Tuesday');
  assert.deepEqual(await fired(new Date(2026, 10, 9, 9, 30)), [made.w], 'and again the next Monday');
});

test('a GitHub remote is read in any form it is written in', () => {
  for (const r of ['https://github.com/AlexReiner98/archipelago.git', 'git@github.com:AlexReiner98/archipelago.git', 'https://token@github.com/AlexReiner98/archipelago', 'ssh://git@github.com/AlexReiner98/archipelago']) assert.equal(githubUrl(r), 'https://github.com/AlexReiner98/archipelago', r);
  assert.equal(githubUrl('https://gitlab.com/a/b'), undefined);
});

test('a hosted server launches in the cloud on the workspace’s account, and ends the run when the session stops', async () => {
  const l = await fresh();
  const fake = fakeAnthropic();
  configureCloud({ mcpUrl: 'https://map.example.com/mcp', auth: true, fetch: fake.fetch });
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'repo', title: 'Site repo', props: { remote: 'https://github.com/acme/site.git' } },
    { op: 'create', ref: 'proj', type: 'project', title: 'Site' },
    { op: 'create', ref: 'post', type: 'task', title: 'Run the weekly posting' },
    { op: 'create', ref: 'loose', type: 'task', title: 'Plan the week' },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Posting lane' },
    { op: 'link', type: 'lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'post', to: 'proj' },
    { op: 'link', type: 'needs', from: 'post', to: 'lane' },
  ]);

  await assert.rejects(launch(l, human, { task: made.post }), /own Anthropic account, and none is connected/);
  await l.setSecret(ACCOUNT, JSON.stringify({ provider: 'openai', key: 'sk-o', model: 'gpt' }));
  await assert.rejects(launch(l, human, { task: made.post }), /none is connected/, 'another provider runs no cloud session');
  await l.setSecret(ACCOUNT, JSON.stringify({ provider: 'anthropic', key: 'sk-ant-workspace' }));
  await assert.rejects(launch(l, human, { task: made.post }), /no GitHub token to clone it with/);
  assert.equal(fake.calls.length, 0, 'nothing is asked of Anthropic before it can start');
  await l.setSecret(REPO_TOKEN, 'github_pat_secret');

  const started = await launch(l, human, { task: made.post, mode: 'acceptEdits', budget_usd: 12.5 });
  assert.equal((started as { where: string }).where, 'cloud');
  assert.ok(fake.calls.every((c) => c.key === 'sk-ant-workspace'), 'paid by the workspace’s account');
  const agentMade = fake.calls.find((c) => c.path === '/v1/agents')!.body;
  assert.deepEqual(agentMade.mcp_servers, [{ type: 'url', name: 'pelago', url: 'https://map.example.com/mcp' }]);
  assert.equal(agentMade.model, 'claude-sonnet-5-5');
  const credential = fake.calls.find((c) => c.path.endsWith('/credentials'))!.body;
  assert.equal(credential.auth.type, 'static_bearer');
  assert.equal(credential.auth.mcp_server_url, 'https://map.example.com/mcp');
  assert.match(credential.auth.token, /\w{20,}/, 'a token of its own for the map');
  const session = fake.calls.find((c) => c.path === '/v1/sessions')!.body;
  assert.deepEqual(session.resources, [{ type: 'github_repository', url: 'https://github.com/acme/site', authorization_token: 'github_pat_secret' }]);
  assert.deepEqual(session.budget, { type: 'limit', max_list_cost: { amount: '1250', currency: 'USD' } });
  assert.equal(session.metadata.run, started.run);
  const prompt = session.initial_events[0].content[0].text as string;
  assert.ok(prompt.includes('Run the weekly posting') && prompt.includes('may edit files') && prompt.includes('https://github.com/acme/site cloned'), 'the brief, the mode and where it runs');
  assert.equal(JSON.stringify(fake.calls).includes(credential.auth.token) && !prompt.includes(credential.auth.token), true, 'the token goes to the vault, never into the prompt');
  assert.equal((await heldResources(l)).length, 1, 'it holds the lane while it runs');
  await assert.rejects(launch(l, human, { task: made.post }), /Not launched\. "Posting lane" is held/);

  // Running, it is left alone; stopped, its run ends with what it last said, and what it was given goes.
  assert.deepEqual(await checkCloud(l), []);
  fake.state.status = 'idle';
  assert.deepEqual(await checkCloud(l), [started.run]);
  const run = (await l.entity(started.run))!;
  assert.equal(run.status, 'finished');
  assert.match(run.body, /Posted the week’s plan\./);
  assert.ok(fake.calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/v1/vaults/')), 'its vault is deleted');
  assert.equal((await heldResources(l)).length, 0, 'the lane came back');
  assert.deepEqual(await checkCloud(l), [], 'asked after once');

  // Work with no repository runs in an empty sandbox; the agent and environment are made once.
  const before = fake.calls.length;
  const second = await launch(l, human, { task: made.loose });
  const fresh2 = fake.calls.slice(before);
  assert.ok(!fresh2.some((c) => c.path === '/v1/agents' || c.path === '/v1/environments'), 'made once per workspace');
  assert.equal(fresh2.find((c) => c.path === '/v1/sessions')!.body.resources, undefined);
  assert.deepEqual(fresh2.find((c) => c.path === '/v1/sessions')!.body.budget.max_list_cost.amount, '500', 'capped at US$5 unless said');
  // Stopped at a step nobody could allow, it failed; ended on the map first, its session is stopped.
  fake.state.stop = 'requires_action';
  assert.deepEqual(await checkCloud(l), [second.run]);
  assert.equal((await l.entity(second.run))!.status, 'failed');
  assert.match((await l.entity(second.run))!.body, /nobody was there to allow/);
  fake.state.status = 'running';
  const third = await launch(l, human, { task: made.loose });
  await sessionEnd(l, human, { run: third.run, summary: 'Stopped by hand' });
  assert.deepEqual(await checkCloud(l), [third.run]);
  assert.ok(fake.calls.at(-2)!.path.endsWith('/events') && fake.calls.at(-2)!.body.events[0].type === 'user.interrupt', 'its session is interrupted');
});

test('the admin keeps the GitHub token sealed', async () => {
  const l = await fresh();
  const admin = { ...human, admin: true };
  assert.deepEqual(await callTool(l, admin, 'repo_token', {}), { kept: false });
  await assert.rejects(callTool(l, admin, 'repo_token', { token: 'hunter2' }), /not a GitHub token/);
  assert.deepEqual(await callTool(l, admin, 'repo_token', { token: 'github_pat_11ABCDEFGHIJKLMNOPQRSTUV' }), { kept: true });
  assert.equal(await l.secret(REPO_TOKEN), 'github_pat_11ABCDEFGHIJKLMNOPQRSTUV');
  assert.notEqual(await l.setting(REPO_TOKEN), 'github_pat_11ABCDEFGHIJKLMNOPQRSTUV', 'sealed where it is stored');
  assert.deepEqual(await callTool(l, admin, 'repo_token', { remove: true }), { kept: false });
});
