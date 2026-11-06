// The month's reading, tested without a database: the channels view's answer as fixtures, the ops out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';
import { monthBefore, readingOf } from './reading.js';

const post = (id: string, channel: string, posted: string, fields: Record<string, unknown> = {}) => ({ id, type: 'post', title: id, status: 'posted', created_at: `${posted}T12:00:00Z`, fields: { channel, posted, ...fields } });
const talk = (id: string, began: string) => ({ id, type: 'conversation', title: id, status: 'open', created_at: `${began}T12:00:00Z`, fields: { began } });
const hours = (id: string, date: string, h: number) => ({ id, type: 'time_entry', title: id, status: 'logged', created_at: `${date}T12:00:00Z`, fields: { date, hours: h } });

const ANSWER = {
  items: [
    post('e_li1', 'linkedin', '2026-11-04', { visits: 40, begun: 3, paid: 1 }),
    post('e_li2', 'linkedin', '2026-11-20', { visits: 10 }),
    post('e_x1', 'x', '2026-11-10', { visits: 5 }),
    post('e_old', 'linkedin', '2026-10-28', { visits: 99 }),
    talk('e_t1', '2026-11-05'),
    talk('e_t2', '2026-11-06'),
    talk('e_t3', '2026-11-22'),
    hours('e_h1', '2026-11-04', 4),
    hours('e_h2', '2026-11-20', 2.5),
    { id: 'e_src', type: 'channel', title: 'chatgpt', status: 'available', created_at: '2026-11-04T12:00:00Z', fields: { tag: 'chatgpt', visits: 7 } },
  ],
  links: [
    { type: 'came_out_of', from: 'e_t1', to: 'e_li1' },
    { type: 'came_out_of', from: 'e_t2', to: 'e_li1' },
    { type: 'came_out_of', from: 'e_t3', to: 'e_li2' },
    { type: 'part_of', from: 'e_h1', to: 'e_li1' },
    { type: 'part_of', from: 'e_h2', to: 'e_li2' },
  ],
};

test('the month before is read from now, across a year’s turn', () => {
  assert.equal(monthBefore('2026-12-01T00:05:00Z'), '2026-11');
  assert.equal(monthBefore('2027-01-14T09:00:00Z'), '2026-12');
});

test('a month’s reading sums its channels as the table does, and names the ones that met the bar', () => {
  const r = readingOf(ANSWER, '2026-11')!;
  assert.equal(r.title, 'Channels, November 2026');
  assert.deepEqual(r.props, { month: '2026-11', posts: 3, visits: 55, begun: 3, paid: 1, conversations: 3, hours: 6.5, met: ['linkedin'] });
  assert.match(r.body, /^3 posts, 55 visits, 3 trials begun, 1 paid, 3 conversations\. linkedin met the bar of 3 conversations in under 10 hours\./);
  assert.match(r.body, /\| linkedin \| 2 \| 50 \| 3 \| 1 \| 6% \| 3 \| 6\.5 \| met \|/);
  assert.match(r.body, /\| x \| 1 \| 5 \| 0 \| 0 \| 0% \| 0 \| 0 \| short \|/);
  assert.deepEqual(r.posts.sort(), ['e_li1', 'e_li2', 'e_x1']);
  assert.equal(readingOf(ANSWER, '2026-09'), null, 'a month nothing went out in has no reading');
  assert.match(readingOf(ANSWER, '2026-10')!.body, /^1 post, 99 visits, 0 trials begun, 0 paid, 0 conversations\./, 'one is one');
});

test('the schedule writes last month’s reading once, part of the posts’ project and about each post', async () => {
  const made: unknown[] = [];
  const ctx = (had: boolean) => ({
    now: '2026-12-01T06:00:00Z',
    read: async (q: Record<string, any>) => {
      if (q.items?.type === 'channel_month') return had ? [{ id: 'e_r', props: { month: '2026-11' } }] : [];
      if (q.view === 'flat') return ANSWER;
      if (q.items?.type === 'post') return [{ id: 'e_li1' }];
      if (q.trail) return [{ id: 'e_proj', is: ['project'] }];
      return [];
    },
  });
  const done = await handler['social.reading']({}, ctx(false));
  made.push(...done.changes[0].ops);
  assert.deepEqual(done.answer, { month: '2026-11', made: true });
  assert.equal((made[0] as any).type, 'channel_month');
  assert.deepEqual(made.slice(1, 2), [{ op: 'link', type: 'part_of', from: 'r', to: 'e_proj' }]);
  assert.equal(made.filter((o: any) => o.type === 'about').length, 3);
  assert.equal((await handler['social.reading']({}, ctx(true))).answer.made, false, 'never twice');
});
