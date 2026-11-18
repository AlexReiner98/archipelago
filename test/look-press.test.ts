// A look that presses marks first (packs/look_draw/kernel/look-draw.ts, pressAll; Lane 8 of e_cxv6sseq): once the view
// has drawn, each mark named by its key is clicked where it stands, from the look's own browser, as a person's pointer
// clicks it, so the drawing's own handler answers; the picture is taken once the page has settled. In a real browser
// (skipped where there is no Chrome): a flow of an island whose pack names its parts, its pack's row opened (pk:) and
// then one kind listed (pg:), each a picture of its own.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { stopLayout } from '../packs/look_draw/kernel/look-draw.ts';
import { setIslands, setPack } from '../packs/loader/kernel/packstate.ts';
import { chrome } from './browser.ts';
import { human } from './map.ts';
import { serve } from './serve.ts';

after(stopLayout);

/** A pack kept as an item whose parts the answer names: two types and a rule. */
const LANES = {
  types: [
    { id: 'lanes.lane', title: 'Lane', description: 'A lane of work.', extends: 'work' },
    { id: 'lanes.overlap', title: 'Overlap', description: 'Two lanes touching one file.', extends: 'work' },
  ],
  rules: [{ id: 'lanes.careful', when: { actor: 'agent', op: 'update', type: 'lanes.lane' }, then: 'hold', say: 'A lane changed by an agent waits.' }],
};

/** Where a run keeps the pictures it took, for a person to look at (LOOK_PRESS_OUT), else nowhere. */
const out = process.env.LOOK_PRESS_OUT;
const save = (name: string, data: string) => out && (mkdirSync(out, { recursive: true }), writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64')));

test('in a browser, a look presses a pack’s mark open, then lists one kind of its parts, each its own picture', { skip: !chrome() && 'no Chrome here (set CHROME)' }, async () => {
  const { workspaces, call } = await serve('off');
  const l = (await workspaces.get('default')).pelago;
  await setIslands(l, human, true);
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'pack', title: 'Lanes', body: 'Work in lanes.', props: { name: 'lanes', manifest: LANES } }] });
  await setPack(l, human, { pack: 'lanes', on: true });
  const here = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'here', type: 'island', title: 'Here', props: { pack: 'lanes' } }] })).result.created.here as string;
  await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'lanes.lane', title: 'A lane here', props: { island: here } },
      { op: 'create', ref: 'b', type: 'lanes.overlap', title: 'An overlap here', props: { island: here } },
    ],
  });
  const lens = { filter: { find: [`island ${here}`] } };
  const look = (params: Record<string, unknown>) => call('/agent/query', undefined, { actor: 'robot', name: 'look', params: { lens, width: 900, height: 500, ...params } }).then((r) => r.result ?? r);
  const [pk, pg] = [`pk:${here}:lanes`, `pg:${here}:lanes:type`];

  const closed = await look({});
  assert.equal(closed.state, 'drawn', JSON.stringify({ ...closed, image: undefined }));
  assert.equal(closed.pressed, undefined, 'a look that presses nothing says nothing of it');
  save('closed', closed.image.data);

  // A kind's mark is drawn only in an open row: pressed alone, it is missing, and the picture is the view as it opens.
  const early = await look({ press: [pg] });
  assert.deepEqual([early.pressed, early.missing], [[], [pg]]);

  const opened = await look({ press: [pk] });
  assert.equal(opened.state, 'drawn', JSON.stringify({ ...opened, image: undefined }));
  assert.deepEqual([opened.pressed, opened.missing], [[pk], []]);
  assert.notEqual(opened.look, closed.look, 'a pressed look is a picture of its own, not the view as it opens again');
  assert.notEqual(opened.image.data, closed.image.data, 'the pack’s row is drawn open');
  save('opened', opened.image.data);

  // Then one kind: found only because the row opened, and its parts listed below it.
  const listed = await look({ press: [pk, pg, 'pk:e_nothere0:lanes'] });
  assert.deepEqual([listed.pressed, listed.missing], [[pk, pg], ['pk:e_nothere0:lanes']]);
  assert.notEqual(listed.image.data, opened.image.data, 'the kind’s parts are listed');
  save('listed', listed.image.data);

  // The same presses, the map unchanged: that picture again.
  const again = await look({ press: [pk, pg, 'pk:e_nothere0:lanes'] });
  assert.equal(again.again, true);
  assert.equal(again.look, listed.look);
  assert.deepEqual(again.pressed, [pk, pg]);
});
