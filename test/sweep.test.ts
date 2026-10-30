// What a test run removes from the machine's temp folder, and what it leaves, and how many pulled-over data folders
// are kept.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sweepLooks } from '../src/chrome.ts';
import { pruneKept } from '../src/pull.ts';
import { sweepTemp } from './sweep.ts';

const DAY = 86_400_000;
const made = (at: string, days: number, now: number) => {
  mkdirSync(at, { recursive: true });
  utimesSync(at, new Date(now - days * DAY), new Date(now - days * DAY));
};

test('a run sweeps what was left over a day old, and leaves the young, the kept and what is not its own', () => {
  const temp = mkdtempSync(join(tmpdir(), 'sweep-'));
  const now = Date.now();
  for (const name of ['pelago-packs-old', 'pelago-chrome-old', 'pelago-run-old']) made(join(temp, name), 2, now);
  made(join(temp, 'pelago-packs-young'), 0.5, now);
  made(join(temp, 'somebody-else'), 40, now);
  made(join(temp, 'pelago-look-1-abc'), 2, now);
  writeFileSync(join(temp, 'pelago-blank-abc.tar'), 'image');
  utimesSync(join(temp, 'pelago-blank-abc.tar'), new Date(now - 40 * DAY), new Date(now - 40 * DAY));
  made(join(temp, 'pelago-drawings', 'stale'), 31, now);
  made(join(temp, 'pelago-drawings', 'fresh'), 29, now);
  made(join(temp, 'pelago-drawings'), 40, now);

  sweepTemp(temp, now);
  assert.deepEqual(readdirSync(temp).sort(), ['pelago-blank-abc.tar', 'pelago-drawings', 'pelago-look-1-abc', 'pelago-packs-young', 'somebody-else']);
  assert.deepEqual(readdirSync(join(temp, 'pelago-drawings')), ['fresh']);
});

test('a temp folder with no drawings laid out is swept all the same', () => {
  const temp = mkdtempSync(join(tmpdir(), 'sweep-'));
  assert.doesNotThrow(() => sweepTemp(temp));
});

test('a look sweeps the Chrome folders of servers that have gone, and leaves those of servers still here', () => {
  const temp = mkdtempSync(join(tmpdir(), 'sweep-'));
  const now = Date.now();
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  made(join(temp, `pelago-look-${gone}-abc`), 0, now);
  made(join(temp, `pelago-look-${process.pid}-abc`), 40, now);
  made(join(temp, 'pelago-look-oldOne'), 2, now);
  made(join(temp, 'pelago-look-youngO'), 0.5, now);

  sweepLooks(temp, now);
  assert.deepEqual(readdirSync(temp).sort(), [`pelago-look-${process.pid}-abc`, 'pelago-look-youngO'].sort());
});

test('a pull keeps the newest data folders it put aside, and touches nothing else beside them', () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-'));
  const dataDir = join(root, 'data');
  const times = ['2026-10-18T15-41-25.351Z', '2026-10-18T15-42-23.535Z', '2026-10-20T13-22-39.707Z', '2026-10-20T13-24-28.031Z', '2026-10-20T13-25-05.296Z'];
  for (const time of times) mkdirSync(`${dataDir}-backup-${time}`);
  for (const other of ['data', 'data.pulled', 'data-backup-mine', 'database']) mkdirSync(join(root, other));

  pruneKept(dataDir);
  assert.equal(existsSync(`${dataDir}-backup-${times[0]}`), false);
  assert.equal(existsSync(`${dataDir}-backup-${times[1]}`), false);
  assert.deepEqual(readdirSync(root).sort(), ['data', 'data-backup-2026-10-20T13-22-39.707Z', 'data-backup-2026-10-20T13-24-28.031Z', 'data-backup-2026-10-20T13-25-05.296Z', 'data-backup-mine', 'data.pulled', 'database']);
});
