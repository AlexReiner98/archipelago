// The software pack's proof and changelog, tested without a database: a small map of items and links stands where
// the kernel answers the handler's reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

type Item = { id: string; type: string; title: string; status?: string; is_open?: boolean; visibility?: string; props?: Record<string, unknown>; updated_at?: string };
type Link = [string, string, string];

const LINEAGE: Record<string, string[]> = {
  'work.project': ['work.project', 'work'],
  'software.feature': ['software.feature', 'work'],
  'software.release': ['software.release', 'event', 'occurrence'],
  'software.proof': ['software.proof', 'question'],
  'software.test': ['software.test', 'work'],
  'software.test_result': ['software.test_result', 'record'],
};

function ctxOver(items: Item[], links: Link[], pictures: string[] = []) {
  const byId = new Map(items.map((e) => [e.id, { status: 'open', is_open: true, visibility: 'shared', props: {}, updated_at: '2026-10-01T00:00:00Z', ...e, is: LINEAGE[e.type] ?? [e.type] }]));
  const fits = (type: string, asked: string) => type === asked || type.endsWith(`.${asked}`);
  const partsUnder = (id: string): string[] => [id, ...links.filter(([t, , to]) => t === 'part_of' && to === id).flatMap(([, from]) => partsUnder(from))];
  return {
    now: '2026-10-16T12:00:00Z',
    zone: 'America/Toronto',
    read: async (q: Record<string, any>) => {
      if (q.get) return byId.get(q.get) ?? null;
      if (q.items) return [...byId.values()].filter((e) => e.is.includes(q.items.type));
      if (q.scope && q.parts) return partsUnder(q.scope).map((id) => byId.get(id));
      if (q.related) {
        const back = q.direction === 'in';
        return links.filter(([t, from, to]) => fits(t, q.relation) && (back ? to : from) === q.related).map(([, from, to]) => byId.get(back ? from : to));
      }
      if (q.pictures) return q.pictures.filter((id: string) => pictures.includes(id));
      throw new Error(`no read ${JSON.stringify(q)}`);
    },
  };
}

const ITEMS: Item[] = [
  { id: 'prod', type: 'work.project', title: 'Aperture' },
  { id: 'sun', type: 'software.feature', title: 'Sun study', status: 'shipped', updated_at: '2026-10-05T00:00:00Z' },
  { id: 'shade', type: 'software.feature', title: 'Shade maps', status: 'built', updated_at: '2026-10-10T00:00:00Z' },
  { id: 'later', type: 'software.feature', title: 'Wind', status: 'planned' },
  { id: 'rel', type: 'software.release', title: 'First release', props: { version: '1.0.0' } },
  { id: 'q', type: 'software.proof', title: 'Does the sun match NOAA?', visibility: 'public' },
  { id: 'q2', type: 'software.proof', title: 'Are shadows right?' },
  { id: 't1', type: 'software.test', title: 'Sun.MatchesNoaa', props: { entrypoint: 'Sun.MatchesNoaa' } },
  { id: 't2', type: 'software.test', title: 'Sun.Equinox' },
  { id: 'r1', type: 'software.test_result', title: '1.0.0: Sun.MatchesNoaa', props: { build: '1.0.0', passed: true, value: '0.004 deg', picture: '.proof/a.png' }, updated_at: '2026-10-12T00:00:00Z' },
  { id: 'r2', type: 'software.test_result', title: '1.0.0: Sun.Equinox', props: { build: '1.0.0', passed: false }, updated_at: '2026-10-12T00:00:00Z' },
  { id: 'r0', type: 'software.test_result', title: '0.9.0: Sun.MatchesNoaa', props: { build: '0.9.0', passed: false }, updated_at: '2026-10-01T00:00:00Z' },
];
const LINKS: Link[] = [
  ['part_of', 'sun', 'prod'],
  ['part_of', 'shade', 'prod'],
  ['part_of', 'later', 'prod'],
  ['software.ships', 'rel', 'sun'],
  ['part_of', 'q', 'sun'],
  ['about', 'q2', 'shade'],
  ['software.answers', 't1', 'q'],
  ['software.answers', 't2', 'q'],
  ['produced', 't1', 'r1'],
  ['produced', 't1', 'r0'],
  ['produced', 't2', 'r2'],
];

test('a proof question is answered on a build when every test of it passed there, the newest build unless asked', async () => {
  const ctx = ctxOver(ITEMS, LINKS, ['r1']);
  const { answer } = await handler['software.proof']({ of: 'prod' }, ctx);
  assert.deepEqual([answer.build, answer.builds], ['1.0.0', ['1.0.0', '0.9.0']]);
  assert.deepEqual(answer.proofs.map((p: { id: string; answered: boolean; passed: number; failed: number }) => [p.id, p.answered, p.passed, p.failed]), [
    ['q2', false, 0, 0],
    ['q', false, 1, 1],
  ], 'a question about something in the product is the product’s too');
  const t1 = answer.proofs[1].tests.find((t: { id: string }) => t.id === 't1');
  assert.deepEqual([t1.result.stored, t1.before.build, t1.entrypoint], [true, '0.9.0', 'Sun.MatchesNoaa']);
  assert.deepEqual(answer.to_send, [], 'a picture already kept is not owed');
  const older = (await handler['software.proof']({ of: 'prod', build: '0.9.0' }, ctx)).answer;
  assert.deepEqual([older.counts.passed, older.counts.failed, older.counts.not_run], [0, 1, 1]);
  const listed = (await handler['software.proof']({}, ctx)).answer;
  assert.deepEqual(listed.products, [{ id: 'prod', type: 'work.project', title: 'Aperture', status: 'open', questions: 2 }]);
  await assert.rejects(handler['software.proof']({ of: 'nowhere' }, ctx), /No entity "nowhere"/);
});

test('a changelog is what is built or shipped, with its release, built and unreleased first', async () => {
  const { answer } = await handler['software.changelog']({ of: 'prod' }, ctxOver(ITEMS, LINKS));
  assert.deepEqual(answer.features.map((f: { id: string; release: { version: string } | null }) => [f.id, f.release?.version ?? null]), [['shade', null], ['sun', '1.0.0']]);
  assert.deepEqual(answer.counts, { built: 1, shipped: 1 });
  const given = (await handler['software.changelog']({ of: 'prod', within: ['sun'] }, ctxOver(ITEMS, LINKS))).answer;
  assert.deepEqual(given.features.map((f: { id: string }) => f.id), ['sun'], 'asked for the public page, only what it is given');
});
