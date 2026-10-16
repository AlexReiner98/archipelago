// The money pack's costs view, tested without a database: the kernel's spent view and the cost items are fixtures.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

const NOW = '2026-10-16T12:00:00Z';
const LONG_AGO = '2026-01-01';

function ctxOver(items: Record<string, unknown>[]) {
  return {
    now: NOW,
    zone: 'America/Toronto',
    read: async (q: Record<string, any>) => {
      if (q.view === 'spent') return { days: q.params.days, since: '2026-09-16T12:00:00.000Z', cost_usd: 12.5, tokens: 900, unpriced_tokens: 400, by: [{ surface: 'github-actions', runs: 2, tokens: 500, cost_usd: 12.5, unpriced_tokens: 0 }] };
      if (q.items?.type === 'money.cost') return items.map((e) => ({ status: 'paying', is_open: true, created_at: LONG_AGO, updated_at: LONG_AGO, ...e }));
      throw new Error(`no read ${JSON.stringify(q)}`);
    },
  };
}

test('what the work costs: agents as the kernel measured them, and each regular payment by its share of the period', async () => {
  const { answer } = await handler['money.costs'](
    { days: 30 },
    ctxOver([
      { id: 'host', type: 'money.cost', title: 'Hosting', props: { amount: 25, since: LONG_AGO, vendor: 'Render' } },
      { id: 'domain', type: 'money.cost', title: 'Domain', props: { amount: 120, every: 'year', since: LONG_AGO } },
      { id: 'sub', type: 'money.cost', title: 'Subscription', props: {} },
      { id: 'euro', type: 'money.cost', title: 'Licence', props: { amount: 10, currency: 'EUR', since: LONG_AGO } },
      { id: 'old', type: 'money.cost', title: 'Old host', status: 'ended', is_open: false, props: { amount: 50, since: LONG_AGO, until: LONG_AGO } },
    ]),
  );
  assert.equal(answer.agents.cost_usd, 12.5);
  assert.deepEqual(answer.recurring.items.map((i: { title: string }) => i.title), ['Domain', 'Hosting', 'Licence', 'Subscription'], 'ended long ago, it has no share and is not listed');
  assert.equal(answer.recurring.per_month, 35, '25 a month and 120 a year, in dollars');
  assert.deepEqual(answer.recurring.unpriced, [{ id: 'sub', title: 'Subscription' }]);
  assert.deepEqual(answer.recurring.other_currencies, [{ id: 'euro', title: 'Licence', currency: 'EUR' }]);
  assert.equal(answer.total_usd, Math.round((12.5 + answer.recurring.cost_usd) * 100) / 100);
});
