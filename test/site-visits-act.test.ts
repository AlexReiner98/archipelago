// The server act site.visits: a server pack that declares it reads a public site's visit counts after a position of
// the visits stream, and nothing else; the read is logged on the site's map.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAct } from '../src/server-acts.ts';
import type { ServerPackFile } from '../src/server-packs.ts';
import { countVisit, flushVisits } from '../src/visits.ts';
import { serve } from './serve.ts';

const packOf = (acts: string[]) => ({ id: 'reader', version: '0.1.0', title: 'Reader', reach: { server: { acts } } }) as unknown as ServerPackFile;

test('a pack that declares site.visits reads a site’s counts after a position; others, and other sites, are refused', async () => {
  const { workspaces } = await serve('off');
  const was = process.env.PELAGO_SITES;
  process.env.PELAGO_SITES = 'visits.example=default';
  try {
    const reader = packOf(['site.visits']);
    const act = (input: Record<string, unknown>, pack = reader) => runAct(workspaces, pack, 'site.visits', input) as Promise<{ counts: { tag: string; day: string; n: number }[]; pos: number }>;
    await assert.rejects(act({ site: 'visits.example' }, packOf(['mail.send'])), /did not declare the act "site.visits"/);
    await assert.rejects(act({ site: 'elsewhere.example' }), /not a site this server serves/);
    await assert.rejects(act({ site: 'visits.example', after: -1 }), /after:/);

    assert.deepEqual(await act({ site: 'visits.example' }), { counts: [], pos: 0 });
    countVisit('default', 'linkedin', '2026-11-04', 2);
    await flushVisits((id) => workspaces.get(id));
    const first = await act({ site: 'Visits.Example' });
    assert.deepEqual(first.counts, [{ tag: 'linkedin', day: '2026-11-04', n: 2 }]);
    countVisit('default', 'linkedin', '2026-11-04');
    countVisit('default', 'x', '2026-11-04');
    await flushVisits((id) => workspaces.get(id));
    const next = await act({ site: 'visits.example', after: first.pos });
    assert.deepEqual(next.counts, [{ tag: 'linkedin', day: '2026-11-04', n: 1 }, { tag: 'x', day: '2026-11-04', n: 1 }], 'after returns only newer counts');
    assert.deepEqual((await act({ site: 'visits.example', after: next.pos })).counts, []);

    const { pelago } = await workspaces.get('default');
    const { rows } = await pelago.db.query<{ actor: string; detail: { rows: number } }>(`select actor, detail from event where action = 'server.site.visits' order by seq desc limit 1`);
    assert.equal(rows[0].actor, 'pack:reader');
    assert.equal(rows[0].detail.rows, 0);
  } finally {
    if (was === undefined) delete process.env.PELAGO_SITES;
    else process.env.PELAGO_SITES = was;
  }
});
