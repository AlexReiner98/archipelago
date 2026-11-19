// A rule's own examples (packs/rules/kernel/examples.ts, task e_qzhezahm): each a small change on made-up items and what it
// must come to, judged as the pack's manifest is written. The two cases are UI design's that misbehaved only on the live
// map (18 Nov 2026): a matches on a field the change leaves out, and an unless walk over a link made in the same change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../packs/identity/kernel/workspaces.ts'; // as on a server: a change to a pack item makes the log and the packs on follow
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { exampleProblems, type Example } from '../packs/rules/kernel/examples.ts';
import { decide, type RuleDef } from '../packs/rules/kernel/rules.ts';
import { fresh, make, packsWith } from './map.ts';

const types = [
  { id: 'ui.sighting', title: 'Sighting', description: 'A thing seen.', extends: 'record', fields: { look: { type: 'string' } } },
  { id: 'ui.screen', title: 'Screen', description: 'A screen.', extends: 'task' },
  { id: 'ui.verdict', title: 'Verdict', description: 'A verdict.', extends: 'record', statuses: { open: ['open'], closed: ['kept', 'changed', 'superseded'] } },
];
const links = [{ id: 'ui.judges', title: 'Judges', inverse: 'Judged by', description: 'A verdict on a screen.', from: ['ui.verdict'], to: ['ui.screen'] }];
const pack = (rules: RuleDef[]) => ({ id: 'ui', version: '1.0.0', title: 'UI', description: 'A pack to try examples with.', requires: ['core'], types, links, rules }) as unknown as PackFile;
const problems = (rules: RuleDef[]) => exampleProblems(new Registry(packsWith(pack(rules))), 'ui', decide);

// A screen and its verdicts, made up: the screen made building, then set done in the same change.
const screenDone = (verdicts: { status: string; title?: string }[], linked = true): Example['ops'] => [
  { op: 'create', ref: 's', type: 'ui.screen', title: 'The opening view uses the frame', status: 'todo' },
  ...verdicts.map((v, i) => ({ op: 'create', ref: `v${i}`, type: 'ui.verdict', title: v.title ?? 'The opening view uses the frame', status: v.status })),
  ...(linked ? verdicts.map((_, i) => ({ op: 'link', type: 'ui.judges', from: `v${i}`, to: 's' })) : []),
  { op: 'update', id: 's', status: 'done' },
];
const doneOnKeep = (walk: string, examples: Example[]): RuleDef => ({
  id: 'ui.done_on_keep', when: { op: 'update', type: 'ui.screen', status: { to: 'done' } }, then: 'refuse',
  unless: { walk, type: 'ui.verdict', holds: { status: ['kept', 'superseded'] } }, say: '"{title}" is done once its newest verdict keeps it. Still standing: {missing}.', examples,
});
const KEPT: Example = { name: 'a kept verdict made with it', ops: screenDone([{ status: 'kept' }]), expect: 'applied' };
const OPEN: Example = { name: 'an open verdict made with it', ops: screenDone([{ status: 'superseded' }, { status: 'open' }]), expect: 'refused' };

test('a matches on a field the example leaves out is caught: the rule never fires there', async () => {
  const look = (rule: Partial<RuleDef>): RuleDef => ({ id: 'ui.sighting_look_kept', ...rule, examples: [{ name: 'a sighting with no look', ops: [{ op: 'create', ref: 'x', type: 'ui.sighting', title: 'Seen' }], expect: 'refused' }, { name: 'a kept look', ops: [{ op: 'create', ref: 'x', type: 'ui.sighting', title: 'Seen', props: { look: 'k_1' } }], expect: 'applied' }] });
  const wrong = await problems([look({ when: { type: 'ui.sighting', matches: { look: '^(?!k_)' } }, then: 'refuse' })]);
  assert.deepEqual(wrong, ['rule ui.sighting_look_kept, example "a sighting with no look" should be refused, and is applied']);
  assert.deepEqual(await problems([look({ when: { op: 'create', type: 'ui.sighting' }, then: { require: ['look'] } })]), [], 'require refuses what matches let through');
});

test('an unless walk sees the items and links its own change makes', async () => {
  assert.deepEqual(await problems([doneOnKeep('ui.judges<', [KEPT, OPEN])]), [], 'the walk reaches a verdict linked in the same change');
  // The walk the wrong way round reaches nothing, so an open verdict made with the screen does not keep it from done.
  const wrong = await problems([doneOnKeep('ui.judges>', [KEPT, OPEN])]);
  assert.deepEqual(wrong, ['rule ui.done_on_keep, example "an open verdict made with it" should be refused, and is applied']);
  // An example that expects the wrong thing names what refused it.
  const said = await problems([doneOnKeep('ui.judges<', [{ ...OPEN, expect: 'applied' }])]);
  assert.match(said[0], /should be applied, and is refused \("The opening view uses the frame" is done once its newest verdict keeps it\. Still standing: "The opening view uses the frame" \(open\)\.\)/);
});

test('{missing} names each reached item that fails, by its title and status, not the item judged', async () => {
  const titled = { ...OPEN, ops: screenDone([{ status: 'superseded', title: 'Round 1' }, { status: 'open', title: 'Round 2' }, { status: 'changed', title: 'Round 3' }]), expect: 'applied' as const };
  const [said] = await problems([doneOnKeep('ui.judges<', [titled])]);
  assert.match(said, /Still standing: "Round 2" \(open\), "Round 3" \(changed\)\.\)$/);
});

test('an example is a change on its own refs, with an outcome', async () => {
  const bad = await problems([doneOnKeep('ui.judges<', [{ ops: [{ op: 'update', id: 'e_stored', status: 'done' }], expect: 'refused' }, { ops: KEPT.ops, expect: 'fine' as Example['expect'] }, { ops: [], expect: 'applied' }])]);
  assert.deepEqual(bad, [
    'rule ui.done_on_keep, example 1: an example names only items it makes, by ref: not e_stored',
    'rule ui.done_on_keep, example 2: expect is applied, held or refused',
    'rule ui.done_on_keep, example 3: an example is { ops, expect }, its ops a change',
  ]);
});

test('a pack item whose rule does not come to its example is refused as it is written, naming both', async () => {
  const l = await fresh();
  const manifest = (walk: string) => ({ types, links, rules: [doneOnKeep(walk, [KEPT, OPEN])] });
  const item = (walk: string) => ({ op: 'create', ref: 'p', type: 'pack', title: 'UI', body: 'Screens by eye.', props: { name: 'ui', manifest: manifest(walk) } }) as const;
  await assert.rejects(make(l, [item('ui.judges>')]), /the pack ui: rule ui\.done_on_keep, example "an open verdict made with it" should be refused, and is applied/);
  const { p } = await make(l, [item('ui.judges<')]);
  await assert.rejects(make(l, [{ op: 'update', id: p, props: { manifest: manifest('ui.judges>') } }]), /should be refused, and is applied/, 'an edit to the manifest is judged too');
  assert.equal(((await l.entity(p))!.props.manifest as { rules: RuleDef[] }).rules[0].unless!.walk, 'ui.judges<', 'nothing of the refused edit is written');
});
