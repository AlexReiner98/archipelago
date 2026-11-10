// The keys a server pack declares for the second round (src/server-reach.ts): each is checked on load, so a pack that
// takes an address off the list, fills a file or a command with what the kernel does not give, or names a function
// twice is left out and said why.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkServerPack, loadServerPacks } from '../src/server-packs.ts';
import { hookAt } from '../src/server-adapter.ts';
import { mountOf } from '../src/server-mounts.ts';
import { setupBehind } from '../src/server-files.ts';

const dir = mkdtempSync(join(tmpdir(), 'pelago-reach-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A pack folder with a handler and a setup file, and its pack.json with this server reach. */
function pack(id: string, server: Record<string, unknown>) {
  const folder = join(dir, id);
  mkdirSync(join(folder, 'files'), { recursive: true });
  writeFileSync(join(folder, 'handler.js'), 'export default {};\n');
  writeFileSync(join(folder, 'files', 'setup.mjs'), 'const ORIGIN = "{origin}";\n');
  const file = { id, version: '1', title: id, reach: { server } };
  writeFileSync(join(folder, 'pack.json'), JSON.stringify(file));
  return { file, folder };
}
const why = (server: Record<string, unknown>) => checkServerPack(pack('x', server).file as never, join(dir, 'x')).join('; ');

const READER = {
  entries: [{ id: 'page', method: 'GET', answers: 'html' }],
  mounts: { public: 'page', setup: 'setup' },
  streams: [{ id: 'live', on: 'published' }],
  files: [{ id: 'setup', file: 'setup.mjs', type: 'text/javascript', fill: ['origin', 'version'] }],
  launchers: [{ id: 'agent', argv: ['agent', '-p', '{prompt}', '--mcp-config', '{mcp_config}'], read: 'line' }],
  adapter: { surface: 'some_cli', in: 'wire_in', out: 'wire_out' },
};

test('a pack that declares each new key as it may is loaded', () => {
  assert.equal(why(READER), '');
});

test('what is off the lists is refused, each said why', () => {
  assert.match(why({ ...READER, mounts: { s: 'page' } }), /"s" is not a mount/);
  assert.match(why({ ...READER, mounts: { public: 'nothing' } }), /mount public names no entry of its own that answers a page/);
  assert.match(why({ ...READER, mounts: { setup: 'page' } }), /mount setup names no file of its own/);
  assert.match(why({ ...READER, streams: [{ id: 'page', on: 'published' }] }), /"page" cannot name a stream/);
  assert.match(why({ ...READER, streams: [{ id: 'live', on: 'changed' }] }), /stream "live" is told of published/);
  assert.match(why({ ...READER, files: [{ id: 'setup', file: 'gone.mjs', type: 'text/javascript' }] }), /file "setup" names no file/);
  assert.match(why({ ...READER, files: [{ id: 'setup', file: 'setup.mjs', type: 'text/javascript', fill: ['secret'] }] }), /not "secret"/);
  assert.match(why({ ...READER, launchers: [{ id: 'agent', argv: ['sh', '-c', '{token}'], read: 'line' }] }), /not "token"/);
  assert.match(why({ ...READER, launchers: [{ id: 'agent', argv: [], read: 'line' }] }), /needs an id and a command as a list/);
  assert.match(why({ ...READER, adapter: { surface: 'Some CLI', in: 'a', out: 'b' } }), /names its surface/);
  assert.match(why({ ...READER, adapter: { surface: 'x', in: 'page', out: 'b' } }), /no entry, page or stream: "page"/);
  assert.match(why({ ...READER, entries: [{ id: 'page', answers: 'xml' }] }), /answers json or html/);
});

test('two packs cannot take one mount or one surface', () => {
  pack('first', READER);
  const second = pack('second', READER);
  const { packs, refused } = loadServerPacks([dir]);
  assert.deepEqual(packs.map((p) => p.file.id), ['first']);
  assert.match(refused.find((r) => r.folder === second.folder)!.why.join(), /takes the mount "public" already.*translates the surface "some_cli" already/s);
});

test('the seams answer as the kernel did before', () => {
  assert.equal(mountOf('/p/default/e_abcdefgh', undefined), 'public');
  assert.equal(mountOf('/anything', 'site_ws'), 'site');
  assert.equal(mountOf('/connect/setup.mjs', undefined), 'setup');
  assert.equal(mountOf('/api/x', undefined), undefined);
  assert.deepEqual(hookAt('prompt'), { event: 'prompt' });
  assert.deepEqual(hookAt('some_cli/prompt'), { surface: 'some_cli', event: 'prompt' });
  assert.equal(typeof setupBehind('old'), 'boolean');
});
