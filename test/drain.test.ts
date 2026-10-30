// A server stopping answers the requests in hand before its databases close, and cuts one held open past the bound.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { drained } from '../src/drain.ts';

/** A server whose /slow answers after `wait` ms, /held never, anything else at once. */
async function serve(wait: number) {
  const server = createServer((req, res) => {
    if (req.url === '/slow') return void setTimeout(() => res.end('slow'), wait);
    if (req.url === '/held') return void res.writeHead(200).write('…');
    res.end('quick');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: (server.address() as AddressInfo).port };
}

const get = (port: number, path: string) =>
  new Promise<string>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => done(body));
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end();
  });

test('a request in hand is answered before the server is drained', async () => {
  const { server, port } = await serve(150);
  const answer = get(port, '/slow');
  await new Promise((r) => setTimeout(r, 30));
  let finished = false;
  const done = drained(server, 5_000).then(() => (finished = true));
  assert.equal(await answer, 'slow');
  await done;
  assert.ok(finished);
  await assert.rejects(get(port, '/'), 'no new request is taken');
});

test('a request held open past the bound is cut, and the drain does not wait on it', async () => {
  const { server, port } = await serve(0);
  const held = get(port, '/held').catch((err: Error) => err);
  await new Promise((r) => setTimeout(r, 30));
  const began = Date.now();
  await drained(server, 100);
  assert.ok(Date.now() - began < 2_000, 'it waited only the bound');
  assert.ok(await held, 'the held request ended');
});
