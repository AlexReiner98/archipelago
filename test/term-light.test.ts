// A term lights what it brought in every drawing: what a Find term found and what the walk reached from it, and each
// built-in drawing says which item each of its marks stands for, so the page can light them whatever the style.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error: a plain module of the page, with no types of its own.
import { litBy } from '../ui/lit-by.js';

const [a, b, c, d] = ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_cccccccc', 'e_dddddddd'];
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: 'work', type: 'task', title: `Step ${id}`, open: true, status: 'todo', visibility: 'shared', created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z',
  time: [{ start: '2026-10-28T10:00:00Z', end: '2026-10-28T11:00:00Z' }], state: { blocked: false, waits_on: [], needs_you: false, sessions: 0 }, within: { items: 0, needs_you: 0, blocked: 0, work: 0, sessions: 0 }, size: { work: 0 }, inside: null, ...extra,
});
const answer = {
  items: [item(a, { terms: ['type task'] }), item(b, { step: 1 }), item(c, { step: 2 }), item(d, { terms: ['text roof'] })],
  links: [{ id: 'r_1', type: 'depends_on', kind: 'depends_on', from: a, to: b }, { id: 'r_2', type: 'depends_on', kind: 'depends_on', from: b, to: c }],
};

test('a Find term lights what it found and what the walk reached from it, not what another term found', () => {
  assert.deepEqual([...litBy(answer, 'type task')].sort(), [a, b, c]);
  assert.deepEqual([...litBy(answer, 'text roof')], [d]);
  assert.deepEqual([...litBy(answer, 'tagged e_nothing0')], []);
});

// A drawing runs only in its sandbox, so what each says is read from its code; a drawing in the browser tests is seen doing it.
for (const name of ['flow', 'grid', 'time', 'pages', 'architecture']) {
  test(`the ${name} drawing says the item its marks stand for`, () => {
    const code = readFileSync(join(import.meta.dirname, '..', 'packs', 'core', 'draw', name, 'index.js'), 'utf8');
    assert.match(code, /href: `#\/e\/\$\{|\bitem: /, 'a link to the item, or item');
  });
}
