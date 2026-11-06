// The Social vocabulary for islands (packs/outreach, task e_2rwcf6eu): posts, the channels they go out on, the
// conversations they begin and what each brought, on the shared set alone. It has no code, so its tests are its file
// in and what the registry makes of it out, with no database: taken on an island map, its types on the starters they
// say, its counts kept for an operator to write (e_hfqpcng4), and a post's fields checked as the write path checks them.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkValue } from '../src/fields.ts';
import { islandProblems, sharedOf } from '../src/islands.ts';
import { readManifest } from '../src/manifest.ts';
import { Registry } from '../src/packs.ts';

const PACKS = join(import.meta.dirname, '..', 'packs');
const read = (id: string) => readManifest(readFileSync(join(PACKS, id, 'pack.json'), 'utf8'), id).manifest;

/** The registry over the packs as they are, with the island rules on. */
function onIslands() {
  const reg = new Registry(PACKS);
  reg.turnOff([], true);
  return reg;
}

test('the pack is of the island shape: vocabulary, views and instructions on the shared set, and no code', () => {
  assert.deepEqual(islandProblems(read('outreach'), sharedOf([read('core')])), []);
  assert.deepEqual(readdirSync(join(PACKS, 'outreach')), ['pack.json'], 'a file and nothing that runs');
  assert.ok(!existsSync(join(PACKS, 'outreach', 'handler.js')));
});

test('on an island map it is taken, and today’s social is not', () => {
  const reg = onIslands();
  assert.equal(reg.states.get('outreach')?.state, 'active');
  assert.equal(reg.states.get('social')?.state, 'off', 'social keeps its handler and builds on work');
  const starters = { post: 'work', channel: 'place', conversation: 'occurrence', channel_month: 'record' };
  for (const [id, starter] of Object.entries(starters)) assert.equal(reg.types.get(id)?.starter, starter, id);
  assert.ok(reg.types.get('channel_month')!.lineage.includes('finding'), 'a month is a finding, read across by another island');
  assert.equal(reg.relations.get('goes_out_on')?.root, 'lives_in');
  assert.equal(reg.relations.get('came_out_of')?.root, 'about');
});

test('with the island rules off, social runs over its words and declares none of its own', () => {
  const reg = new Registry(PACKS);
  assert.equal(reg.states.get('social')?.state, 'active');
  assert.equal(reg.states.get('outreach')?.state, 'active');
  for (const id of ['post', 'channel', 'conversation', 'channel_month']) assert.equal(reg.types.get(id)?.pack, 'outreach', id);
  assert.deepEqual([...reg.types.values()].filter((t) => t.pack === 'social'), []);
});

test('the counts are kept for the operator: system fields on posts, channels and months', () => {
  const reg = onIslands();
  const counted = ['visits', 'first_visit', 'last_visit', 'asked', 'begun', 'paid', 'ended'];
  for (const type of ['post', 'channel']) {
    const fields = reg.types.get(type)!.fields;
    for (const f of counted) assert.equal(fields[f]?.system, true, `${type}.${f}`);
  }
  assert.equal(reg.types.get('post')!.fields.conversations.system, true);
  for (const f of ['replies', 'impressions', 'reactions', 'reposts', 'tag', 'channel', 'posted']) assert.ok(!reg.types.get('post')!.fields[f].system, `post.${f} is typed in`);
  for (const f of ['month', 'posts', 'visits', 'begun', 'paid', 'conversations', 'hours', 'met']) assert.equal(reg.types.get('channel_month')!.fields[f]?.system, true, `channel_month.${f}`);
});

test('a post set out empty, and one that went out, check as the write path checks them', () => {
  const fields = onIslands().types.get('post')!.fields;
  const problems = (props: Record<string, unknown>) => Object.entries(props).flatMap(([k, v]) => (fields[k] ? (checkValue(fields[k], v) ?? []) : [`${k} is not declared`]));
  assert.deepEqual(problems({ channel: 'linkedin', tag: 'linkedin-26w46-1' }), []);
  assert.deepEqual(problems({ channel: 'x', posted: '2026-11-05', url: 'https://x.com/a/status/1', replies: 4, impressions: 900 }), []);
  assert.equal(problems({ channel: 'myspace' }).length, 1, 'a channel not listed');
  assert.equal(problems({ trials: 3 }).length, 1, 'a field the type does not declare');
});

test('its views are drawn by the kernel: a post’s length by its channel, and lenses on its own types', () => {
  const m = read('outreach');
  const screen = m.views!.find((v) => v.id === 'outreach.length') as { form: string; on: string[]; pieces: { piece: string; by: string; limits: Record<string, unknown> }[] };
  assert.equal(screen.form, 'screen');
  assert.deepEqual(screen.on, ['post']);
  const channels = onIslands().types.get('post')!.fields.channel.values!;
  for (const c of Object.keys(screen.pieces[0].limits)) assert.ok(channels.includes(c), `${c} is a channel a post may name`);
  const lenses = (m.styles ?? []).filter((s) => s.type === 'lens');
  assert.deepEqual(lenses.map((s) => s.title), ['Posts and what each brought', 'Channels and what each brought', 'Posts to write']);
  for (const s of lenses) {
    const shape = (s.props as { style?: { shape?: string } }).style?.shape;
    assert.ok(['list', 'flow', undefined].includes(shape), `${s.id} is drawn by a layout every map has`);
  }
});

test('its instructions hold that a post’s words are its author’s', () => {
  const said = (read('outreach').styles ?? []).filter((s) => s.type === 'instruction');
  const prose = said.find((s) => s.id === 'outreach.prose') as { body: string } | undefined;
  assert.ok(prose && /Never draft, rewrite or suggest its words/.test(prose.body));
  assert.ok(said.every((s) => (s.title ?? '').length <= 60));
});

test('how tags and conversations are kept is a guide, said when asked for, never a working rule of every project', () => {
  const said = (read('outreach').styles ?? []).filter((s) => s.type === 'instruction');
  const fors = Object.fromEntries(said.map((s) => [s.id, (s.props as { for: string[] }).for]));
  assert.deepEqual(fors, { 'outreach.prose': ['session_start'], 'outreach.tag': ['guide:social'], 'outreach.talk': ['guide:social'] });
  assert.match((said[0] as { body: string }).body, /params for guide:social/);
});
