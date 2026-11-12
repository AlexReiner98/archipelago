// The map's icon as the server answers it (packs/surface/kernel/icon.ts): its PNG, or not found.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ICON, serveIcon } from '../src/icon.ts';

test('the icon is answered as its PNG, or not found', () => {
  assert.ok(ICON.test('/favicon.ico') && ICON.test('/favicon.png') && !ICON.test('/favicon.gif'));
  const res = () => {
    const r = { status: 0, body: undefined as unknown, writeHead: (s: number) => ((r.status = s), r), end: (b: unknown) => ((r.body = b), r) };
    return r;
  };
  assert.equal((serveIcon(res() as never, null) as unknown as { status: number }).status, 404);
  assert.equal((serveIcon(res() as never, Buffer.from('png')) as unknown as { status: number }).status, 200);
});
