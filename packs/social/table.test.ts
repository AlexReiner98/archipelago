// The channels table (layouts/table/): fixed rows in, marks out. A row per channel per month summed from its posts, the
// conversations linked came_out_of them and the hours part_of them, two ratio bars, the bar's dot, and sources below.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const laid = mkdtempSync(join(tmpdir(), 'pelago-table-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'social.table').modules as Record<string, string>)) copyFileSync(join(import.meta.dirname, file), join(laid, name));
const { picture, sums } = await import(pathToFileURL(join(laid, 'index.js')).href);

const marks = (mark: any): any[] => (Array.isArray(mark) && typeof mark[0] === 'string' ? [mark, ...mark.slice(2).flatMap(marks)] : []);
const text = (mark: any): string => (typeof mark === 'string' ? mark : Array.isArray(mark) ? mark.slice(2).map(text).join('') : '');
const post = (id: string, channel: string, posted: string | undefined, f: Record<string, unknown> = {}) => ({ id, kind: 'work', type: 'post', title: `Post ${id}`, status: 'posted', created_at: '2026-10-01T00:00:00.000Z', fields: { channel, ...(posted && { posted }), ...f } });
const talk = (id: string, date: string) => ({ id, kind: 'record', type: 'conversation', title: `Talk ${id}`, status: 'open', created_at: `${date}T12:00:00.000Z`, fields: {} });
const hours = (id: string, f: Record<string, unknown>, status = 'logged') => ({ id, kind: 'occurrence', type: 'time_entry', title: `Time ${id}`, status, created_at: '2026-10-01T00:00:00.000Z', fields: f });
const link = (type: string, from: string, to: string) => ({ id: `r_${from}_${to}`, type, from, to });

const answer = {
  items: [
    post('p1', 'linkedin', '2026-11-02', { visits: 40, begun: 4, paid: 1 }),
    post('p2', 'linkedin', '2026-11-09', { visits: 60, begun: 6, paid: 2, conversations: 9 }),
    post('p3', 'linkedin', '2026-10-20', { visits: 10, begun: 0 }),
    post('p4', 'x', '2026-11-03', { visits: 5, conversations: 1 }),
    post('p5', 'x', undefined, {}),
    { id: 'src1', kind: 'work', type: 'channel', title: 'chatgpt', status: 'open', created_at: '2026-10-01T00:00:00.000Z', fields: { visits: 12, begun: 3, paid: 1 } },
    talk('c1', '2026-11-04'),
    talk('c2', '2026-11-10'),
    talk('c3', '2026-11-11'),
    talk('c4', '2026-11-12'),
    hours('h1', { date: '2026-11-01', hours: 2 }),
    hours('h2', { start: '2026-11-08T10:00:00.000Z', end: '2026-11-08T13:30:00.000Z' }),
    hours('h3', { date: '2026-11-08', hours: 50 }, 'void'),
    hours('h4', { date: '2026-10-30', hours: 1 }),
    hours('h5', { date: '2026-11-02', hours: 4 }),
  ],
  links: [
    link('came_out_of', 'c1', 'p1'), link('came_out_of', 'c2', 'p2'), link('came_out_of', 'c3', 'p2'), link('came_out_of', 'c4', 'src1'),
    link('part_of', 'h1', 'p1'), link('part_of', 'h2', 'p2'), link('part_of', 'h3', 'p2'), link('part_of', 'h4', 'p5'), link('part_of', 'h5', 'p4'),
  ],
};
const style = { table: { source_type: 'channel', bar: { conversations: 3, hours: 10 }, channel_names: { linkedin: 'LinkedIn' }, narrow: '640px' } };

test('a channel’s month is summed from its posts, its conversations and its hours', () => {
  const { months, sources } = sums(answer, 'channel');
  assert.deepEqual(months.map((m: any) => m.month), ['2026-11', '2026-10'], 'newest month first');
  const nov = months[0].rows;
  assert.deepEqual(nov.map((r: any) => r.channel), ['linkedin', 'x']);
  const li = nov[0];
  assert.deepEqual([li.posts.length, li.visits, li.begun, li.paid, li.conversations, li.hours], [2, 100, 10, 3, 3, 5.5], 'two posts; conversations are links, not the count typed on p2; a void hour is not spent');
  assert.deepEqual([nov[1].posts.length, nov[1].conversations, nov[1].hours], [1, 1, 4], 'a post with no conversation linked keeps the count typed on it');
  const oct = months[1].rows;
  assert.deepEqual(oct.map((r: any) => [r.channel, r.posts.length, r.hours]), [['linkedin', 1, 0], ['x', 0, 1]], 'an hour falls in the month it was logged, on a post not yet out too');
  assert.deepEqual(sources.map((s: any) => [s.item.title, s.visits, s.begun, s.paid, s.conversations]), [['chatgpt', 12, 3, 1, 1]]);
});

test('a row on one line: its numbers, two ratio bars, and the bar’s dot; sources below', () => {
  const { scene } = picture({ answer, style });
  const all = marks(scene.svg);
  const row = all.find((x) => x[1].key === 'c:2026-11:linkedin');
  assert.ok(row, 'a row for linkedin in November');
  assert.match(row[1].class, /\bmet\b/, 'three conversations in five and a half hours meets the bar');
  const nums = row.slice(2).map(text);
  assert.deepEqual(nums, ['LinkedIn', '2', '100', '10', '10%', '3', '30%', '3', '5.5', ''], 'name, posts, visits, begun, visits→begun, paid, begun→paid, conversations, hours, mark');
  assert.equal(all.find((x) => x[1].key === 'vb:c:2026-11:linkedin')[1].width, '0.1', 'a bar is filled to its share');
  const x = all.find((m) => m[1].key === 'c:2026-11:x');
  assert.doesNotMatch(x[1].class, /\bmet\b/);
  assert.ok(!all.some((m) => m[1].key === 'vb:c:2026-10:x'), 'no visits, no bar filled');
  const bands = all.filter((m) => /\btb-band\b/.test(m[1].class ?? '')).map((m) => m[1].key);
  assert.deepEqual(bands, ['m:2026-11', 'm:2026-10', 'sources'], 'months, then the sources');
  const src = all.find((m) => m[1].key === 's:src1');
  assert.equal(src[0], 'a');
  assert.equal(src[1].href, '#/e/src1', 'a source opens its page');
  assert.equal(scene.key.length, 2, 'the key says what the dot means');
  assert.match(scene.css, /@container \(max-width: 640px\)/, 'below the narrow width the bars fold');
  assert.ok(!JSON.stringify(scene.svg).includes('style'), 'no style on a mark');
});

test('with no bar there is no dot, with no narrow no fold, and with nothing out it says so', () => {
  const { scene } = picture({ answer, style: { table: { source_type: 'channel' } } });
  assert.ok(!marks(scene.svg).some((m) => /\btb-dot\b/.test(m[1].class ?? '')));
  assert.deepEqual(scene.key, []);
  assert.doesNotMatch(scene.css, /@container \(/);
  assert.ok(picture({ answer: { items: [post('p9', 'x', undefined)], links: [] }, style: {} }).scene.message);
});
