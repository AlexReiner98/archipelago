// Model calls (src/model.ts) without a network: a request in, the answer parsed out, for Anthropic and for an
// OpenAI-compatible server (LiteLLM) alike.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asker, configured, ModelError, shared, type Params } from '../src/model.ts';

/** A fetch that answers from a script and keeps what it was asked. */
function fake(...answers: (Response | Error)[]) {
  const asked: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = answers.shift();
    if (!next) throw new Error('nothing more scripted');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { f, asked };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const params: Params = {
  model: 'some-model',
  max_tokens: 1000,
  cache_control: { type: 'ephemeral' },
  system: 'Keep the map true.',
  tools: [{ name: 'get', description: 'One item.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }],
  betas: ['server-side-fallback-2026-07-01'],
  messages: [
    { role: 'user', content: 'A push landed.' },
    { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu_1', name: 'get', input: { id: 'e_1' } }, { type: 'tool_use', id: 'tu_2', name: 'get', input: { id: 'e_2' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"title":"Oil"}' }, { type: 'tool_result', tool_use_id: 'tu_2', content: 'No such item.', is_error: true }] },
  ],
};

test('by default a conversation goes to Anthropic as it is, on the workspace key, with its betas as the header', async () => {
  const reply = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 } };
  const { f, asked } = fake(json(reply));
  const answer = await asker('sk-ant-key', {}, f)(params);
  assert.deepEqual(answer, reply);
  assert.equal(asked[0].url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual([asked[0].headers['x-api-key'], asked[0].headers['anthropic-version'], asked[0].headers['anthropic-beta']], ['sk-ant-key', '2023-06-01', 'server-side-fallback-2026-07-01']);
  assert.equal(asked[0].body.betas, undefined, 'the betas go as a header, not in the body');
  assert.deepEqual(asked[0].body.cache_control, { type: 'ephemeral' });
  assert.deepEqual(asked[0].body.messages, params.messages);
  assert.throws(() => asker(undefined, {}, f), ModelError, 'Anthropic without a key is not asked');
});

test('with a model server, a conversation is a chat completion, and its answer comes back as a message', async () => {
  const { f, asked } = fake(
    json({
      choices: [{ finish_reason: 'tool_calls', message: { content: 'Closing it.', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'get', arguments: '{"id":"e_3"}' } }, { id: 'call_10', type: 'function', function: { name: 'get', arguments: '{not json' } }] } }],
      usage: { prompt_tokens: 1200, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1000 } },
    }),
  );
  const answer = await asker('sk-ant-workspace', { url: 'http://litellm:4000/v1', key: 'sk-litellm' }, f)(params);
  // Out: one URL, the server's key, the tools as functions, a tool call per tool_use and a tool message per result.
  assert.equal(asked[0].url, 'http://litellm:4000/v1/chat/completions');
  assert.equal(asked[0].headers.authorization, 'Bearer sk-litellm');
  const body = asked[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'tools'], 'nothing only Anthropic understands');
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'get', description: 'One item.', parameters: params.tools![0].input_schema } }]);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Keep the map true.' },
    { role: 'user', content: 'A push landed.' },
    { role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'get', arguments: '{"id":"e_1"}' } }, { id: 'tu_2', type: 'function', function: { name: 'get', arguments: '{"id":"e_2"}' } }] },
    { role: 'tool', tool_call_id: 'tu_1', content: '{"title":"Oil"}' },
    { role: 'tool', tool_call_id: 'tu_2', content: 'Error: No such item.' },
  ]);
  // In: a message as Anthropic would have sent it, cached tokens counted apart, and arguments that are not JSON handed on.
  assert.deepEqual(answer, {
    content: [{ type: 'text', text: 'Closing it.' }, { type: 'tool_use', id: 'call_9', name: 'get', input: { id: 'e_3' } }, { type: 'tool_use', id: 'call_10', name: 'get', input: { arguments: '{not json' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
  });
});

test('a model server\'s other endings are said as Anthropic says them', async () => {
  const ending = async (choice: object) => (await asker(undefined, { url: 'http://m/v1' }, fake(json({ choices: [choice] })).f)(params));
  assert.equal((await ending({ finish_reason: 'stop', message: { content: 'All done.' } })).stop_reason, 'end_turn');
  assert.equal((await ending({ finish_reason: 'length', message: { content: 'Half' } })).stop_reason, 'max_tokens');
  const refused = await ending({ finish_reason: 'stop', message: { content: null, refusal: 'Not that.' } });
  assert.deepEqual([refused.stop_reason, refused.stop_details, refused.content], ['refusal', { explanation: 'Not that.' }, []]);
  // With no key of its own, the server sends the workspace's, or none.
  const { f, asked } = fake(json({ choices: [{ message: { content: 'x' } }] }), json({ choices: [{ message: { content: 'x' } }] }));
  await asker('ws-key', { url: 'http://m/v1' }, f)(params);
  await asker(undefined, { url: 'http://m/v1' }, f)(params);
  assert.deepEqual(asked.map((a) => a.headers.authorization), ['Bearer ws-key', undefined]);
});

test('what passes is tried again, and what does not is said by kind', async () => {
  const at = { url: 'http://m/v1' };
  const ok = json({ choices: [{ message: { content: 'Fine.' } }] });
  const { f, asked } = fake(json({ error: { message: 'busy' } }, 429, { 'retry-after': '0' }), new TypeError('fetch failed'), ok);
  assert.equal(((await asker('k', at, f)(params)).content[0] as { text: string }).text, 'Fine.');
  assert.equal(asked.length, 3);
  const refused = await asker('k', at, fake(json({ error: { message: 'bad key' } }, 401)).f)(params).catch((e) => e);
  assert.ok(refused instanceof ModelError);
  assert.deepEqual([refused.kind, refused.status, refused.message], ['auth', 401, 'bad key']);
  const wrong = await asker('k', at, fake(json({ error: { message: 'no such model' } }, 400)).f)(params).catch((e) => e);
  assert.deepEqual([wrong.kind, wrong.message], ['api', 'no such model']);
});

test('OpenAI itself is asked with max_completion_tokens, which its newer models require; other servers with max_tokens', async () => {
  const { f, asked } = fake(json({ choices: [{ message: { content: 'x' } }] }));
  await asker(undefined, { url: 'https://api.openai.com/v1', key: 'sk-proj', openai: true }, f)(params);
  assert.deepEqual([asked[0].url, asked[0].headers.authorization, asked[0].body.max_completion_tokens, asked[0].body.max_tokens], ['https://api.openai.com/v1/chat/completions', 'Bearer sk-proj', 1000, undefined]);
  assert.equal(asked[0].body.tools[0].function.name, 'get', 'with the tools as functions');
});

test('the model server is configuration: a URL and a key from the environment', () => {
  const before = { url: process.env.PELAGO_MODEL_URL, key: process.env.PELAGO_MODEL_KEY, shared: process.env.PELAGO_MODEL_SHARED };
  try {
    delete process.env.PELAGO_MODEL_URL;
    delete process.env.PELAGO_MODEL_KEY;
    assert.deepEqual(configured(), { url: undefined, key: undefined });
    process.env.PELAGO_MODEL_URL = 'http://litellm:4000/v1/';
    process.env.PELAGO_MODEL_KEY = 'sk-litellm';
    assert.deepEqual(configured(), { url: 'http://litellm:4000/v1', key: 'sk-litellm' });
    // Offered to workspaces without an account of their own, unless the server turns that off.
    assert.deepEqual(shared(), { url: 'http://litellm:4000/v1', key: 'sk-litellm' });
    process.env.PELAGO_MODEL_SHARED = 'off';
    assert.equal(shared(), undefined);
  } finally {
    for (const [k, v] of [['PELAGO_MODEL_URL', before.url], ['PELAGO_MODEL_KEY', before.key], ['PELAGO_MODEL_SHARED', before.shared]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});
