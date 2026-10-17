// The inquiry pack's view, tested without a database: the refuted hypotheses and what assumes them are fixtures.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

type Item = { id: string; type: string; title: string; status: string; is_open: boolean };

function ctxOver(hypotheses: Item[], assuming: Record<string, Item[]>) {
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    ctx: {
      now: '2026-10-17T12:00:00Z',
      zone: 'America/Toronto',
      read: async (q: Record<string, any>) => {
        asked.push(q);
        if (q.items?.type === 'inquiry.hypothesis') return hypotheses.filter((h) => h.status === q.items.status);
        if (q.related && q.relation === 'inquiry.assumes' && q.direction === 'in') return assuming[q.related] ?? [];
        throw new Error(`no read ${JSON.stringify(q)}`);
      },
    },
  };
}

test('open work resting on a refuted hypothesis, once each, named with what it assumed', async () => {
  const h = (id: string, title: string, status: string): Item => ({ id, type: 'inquiry.hypothesis', title, status, is_open: status === 'untested' });
  const t = (id: string, title: string, is_open = true): Item => ({ id, type: 'work.task', title, status: is_open ? 'todo' : 'done', is_open });
  const { ctx } = ctxOver(
    [h('h1', 'People read the blog', 'refuted'), h('h2', 'Gas is cheaper', 'refuted'), h('h3', 'Still open', 'untested')],
    { h1: [t('a', 'Write a post'), t('b', 'Old post', false)], h2: [t('a', 'Write a post'), t('c', 'Buy the van')], h3: [t('d', 'Not at risk')] },
  );
  const { answer } = await handler['inquiry.undermined']({}, ctx);
  assert.deepEqual(
    answer.map((r: { id: string; title: string }) => [r.id, r.title]),
    [
      ['a', 'Write a post · assumes People read the blog'],
      ['c', 'Buy the van · assumes Gas is cheaper'],
    ],
  );
});
