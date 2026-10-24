// A workspace's own model account (src/model-account.ts): sealed where it is kept, tried before it is kept, used
// before the server's model, and said plainly when there is none. No network: every fetch here is a script.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureModels, connection, connectModel, forgetModel, modelStatus, NO_MODEL, tryAccount } from '../src/model-account.ts';
import type { Endpoint } from '../src/model.ts';
import '../src/agent-run.ts';
import { startRuns } from '../src/pack-reach.ts';
import { callTool } from '../src/tools.ts';
import { fresh, human } from './map.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A fetch that answers from a script and keeps what it was asked. */
function fake(...answers: (Response | Error)[]) {
  const asked: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    asked.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = answers.shift();
    if (!next) throw new Error('nothing more scripted');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { f, asked };
}
/** Run with these environment settings, and put them back after. */
async function withEnv(set: Record<string, string | undefined>, run: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  const put = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  };
  put(set);
  try {
    await run();
  } finally {
    put(before);
  }
}
const noServerModel = { PELAGO_MODEL_URL: undefined, PELAGO_MODEL_KEY: undefined, PELAGO_MODEL_SHARED: undefined, LATTICE_MODEL_URL: undefined };

test('an account is tried before it is kept: by its model for Anthropic and OpenAI, by one token for a compatible server', async () => {
  const anthropic = fake(json({ id: 'claude-sonnet-5-5' }), json({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401), json({ error: { message: 'model: nope' } }, 404), new TypeError('fetch failed'));
  assert.equal(await tryAccount({ provider: 'anthropic', key: 'sk-ant-good' }, anthropic.f), undefined);
  assert.match((await tryAccount({ provider: 'anthropic', key: 'sk-ant-bad' }, anthropic.f))!, /^Anthropic refused that key, so it was not saved/);
  assert.match((await tryAccount({ provider: 'anthropic', key: 'sk-ant-good', model: 'nope' }, anthropic.f))!, /^Anthropic has no model "nope"/);
  assert.match((await tryAccount({ provider: 'anthropic', key: 'sk-ant-good' }, anthropic.f))!, /^Anthropic could not be reached, so the account was not saved/);
  assert.equal(anthropic.asked[0].url, 'https://api.anthropic.com/v1/models/claude-sonnet-5-5');
  assert.equal(anthropic.asked[0].headers['x-api-key'], 'sk-ant-good');

  const openai = fake(json({ id: 'gpt-x' }), json({ error: { message: 'You exceeded your current quota.' } }, 429));
  assert.equal(await tryAccount({ provider: 'openai', key: 'sk-proj-1', model: 'gpt-x' }, openai.f), undefined);
  assert.equal(await tryAccount({ provider: 'openai', key: 'sk-proj-1', model: 'gpt-x' }, openai.f), 'OpenAI answered 429: You exceeded your current quota. The account was not saved.');
  assert.deepEqual([openai.asked[0].url, openai.asked[0].headers.authorization], ['https://api.openai.com/v1/models/gpt-x', 'Bearer sk-proj-1']);

  // A compatible server may list no models: it is asked for one token. Whatever else answered at an address is not echoed back.
  const other = fake(json({ choices: [{ message: { content: 'OK' } }] }), new Response('<html>a page of something else</html>', { status: 404 }));
  assert.equal(await tryAccount({ provider: 'compatible', key: '', url: 'https://llm.example/v1', model: 'mistral-small' }, other.f), undefined);
  assert.deepEqual([other.asked[0].url, other.asked[0].method, other.asked[0].headers.authorization, other.asked[0].body], ['https://llm.example/v1/chat/completions', 'POST', undefined, { model: 'mistral-small', max_tokens: 1, messages: [{ role: 'user', content: 'Say OK.' }] }]);
  const missed = (await tryAccount({ provider: 'compatible', key: 'k', url: 'https://llm.example', model: 'm' }, other.f))!;
  assert.match(missed, /^Nothing at https:\/\/llm\.example answered as a model server, so it was not saved/);
  assert.ok(!missed.includes('html'));
});

test('an account is sealed where it is kept, never given back whole, and removed on asking', async () => {
  await withEnv(noServerModel, async () => {
    const l = await fresh();
    const { f, asked } = fake(json({ id: 'gpt-x' }), json({}, 401), json({ choices: [] }));
    configureModels({ fetch: f });
    // What is refused is not kept, and the reason is the answer.
    await connectModel(l, { provider: 'openai', key: ' sk-proj-secret-a1b2 ', model: 'gpt-x' });
    await assert.rejects(connectModel(l, { provider: 'openai', key: 'sk-proj-revoked', model: 'gpt-x' }), /OpenAI refused that key/);
    await assert.rejects(connectModel(l, { provider: 'openai', key: 'sk-proj-1' }), /Name the model/);
    await assert.rejects(connectModel(l, { provider: 'compatible', key: 'k', url: 'ftp://x/v1', model: 'm' }), /https:\/\/host\/v1/);
    await assert.rejects(connectModel(l, { provider: 'compatible', key: 'k', url: 'https://user:pw@x/v1', model: 'm' }), /no sign-in in it/);
    assert.equal(asked.length, 2, 'what is wrong on its face is not sent anywhere');
    const kept = (await l.setting<string>('model_account'))!;
    assert.match(kept, /^sealed:v1:/);
    assert.ok(!kept.includes('sk-proj'));
    assert.deepEqual(JSON.parse((await l.secret('model_account'))!), { provider: 'openai', key: 'sk-proj-secret-a1b2', model: 'gpt-x' });
    const status = await modelStatus(l);
    assert.deepEqual(status.account, { provider: 'openai', name: 'OpenAI', model: 'gpt-x', url: null, price: null, key: '…a1b2' });
    assert.equal((await modelStatus(l, false)).account!.key, undefined, 'a member who is not an admin is not shown even the end of it');
    // A compatible server is kept with its address, without the trailing slash.
    await connectModel(l, { provider: 'compatible', key: '', url: 'https://llm.example/v1/', model: 'mistral-small' });
    assert.deepEqual((await modelStatus(l)).account, { provider: 'compatible', name: 'The model server', model: 'mistral-small', url: 'https://llm.example/v1', price: null, key: null });
    await forgetModel(l);
    assert.equal(await l.setting('model_account'), undefined);
    assert.deepEqual(await modelStatus(l), { account: null, server_model: null, default_model: 'claude-sonnet-5-5', runs_on: null, note: NO_MODEL });
  });
});

test('a server on its own network can be refused as an address, when the server says so', async () => {
  await withEnv({ PELAGO_MODEL_PRIVATE_URLS: 'off' }, async () => {
    const l = await fresh();
    configureModels({ fetch: fake(json({ choices: [] })).f });
    for (const url of ['http://127.0.0.1:11434/v1', 'http://localhost:4000/v1', 'http://169.254.169.254/v1', 'http://[::1]/v1', 'http://10.1.2.3/v1']) {
      await assert.rejects(connectModel(l, { provider: 'compatible', key: 'k', url, model: 'm' }), /does not call addresses on its own network/, url);
    }
    await connectModel(l, { provider: 'compatible', key: 'k', url: 'https://93.184.215.14/v1', model: 'm' });
  });
});

test('the workspace’s own account comes first; the server’s model is the fallback, and can be turned off', async () => {
  const used: { key: string | undefined; at: Endpoint }[] = [];
  configureModels({ ask: (key, at) => (used.push({ key, at }), async () => ({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } })), fetch: fake(json({}), json({})).f });
  await withEnv({ ...noServerModel, PELAGO_MODEL_URL: 'http://litellm:4000/v1', PELAGO_MODEL_KEY: 'sk-operator' }, async () => {
    const l = await fresh();
    // No account: the server's model, on the server's key.
    const server = (await connection(l))!;
    assert.deepEqual([server.from, server.model, used.at(-1)!.at], ['server', 'claude-sonnet-5-5', { url: 'http://litellm:4000/v1', key: 'sk-operator' }]);
    assert.equal((await modelStatus(l)).runs_on, 'server');
    // An account of its own: that, and the server's key is not sent.
    await connectModel(l, { provider: 'openai', key: 'sk-proj-own', model: 'gpt-x' });
    const own = (await connection(l))!;
    assert.deepEqual([own.from, own.name, own.model, used.at(-1)], ['workspace', 'OpenAI', 'gpt-x', { key: 'sk-proj-own', at: { url: 'https://api.openai.com/v1', key: 'sk-proj-own', openai: true } }]);
    // Turned off (a hosted server): without an account of its own, nothing.
    await forgetModel(l);
    process.env.PELAGO_MODEL_SHARED = 'off';
    assert.equal(await connection(l), undefined);
    assert.deepEqual(await modelStatus(l), { account: null, server_model: null, default_model: 'claude-sonnet-5-5', runs_on: null, note: NO_MODEL });
    await connectModel(l, { provider: 'anthropic', key: 'sk-ant-own' });
    assert.equal((await connection(l))!.from, 'workspace', 'its own account still runs');
  });
});

test('with no model, what needs one says so plainly', async () => {
  await withEnv(noServerModel, async () => {
    const l = await fresh();
    // A pack's run is not started.
    const pack = { id: 'demo', version: '0', title: 'Demo', reach: { runs: [] } };
    const runs = await startRuns(l, { kind: 'agent', name: 'pack:demo' }, pack, 'webhook', [{ title: 'Read the push', system: 'Read it.', task: 'A push.', within: ['e_00000000'] }]);
    assert.deepEqual(runs, [{ started: false, title: 'Read the push', reason: NO_MODEL }]);
    assert.match(NO_MODEL, /^No model account is connected to this workspace[\s\S]*Workspace page/);
    // The tool says it too, and only an admin connects one; an agent cannot reach it at all.
    assert.equal(((await callTool(l, human, 'model_account', {})) as { note: string }).note, NO_MODEL);
    await assert.rejects(callTool(l, { ...human, admin: false }, 'model_account', { provider: 'anthropic', key: 'sk-ant-x' }), /Only a workspace admin/);
  });
});
