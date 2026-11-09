// The Social vocabulary for islands (task e_2rwcf6eu): posts, the channels they go out on, the conversations they
// begin and what each brought, on the shared set alone. It has no code, so its tests are its file in and what the map
// makes of it out, read through the tools: its types on the starters they say, its counts kept for an operator to
// write (e_hfqpcng4), and a post's fields checked on write.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { call, human, make, mapWith, type Archipelago } from '#pelago/test';

const fresh = () => mapWith(dirname(import.meta.dirname));
type Style = { id: string; type: string; title?: string; body?: string; props?: Record<string, unknown> };
const file = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')) as { views?: { id: string; form?: string; on?: string[]; pieces?: { piece: string; by?: string; limits?: Record<string, unknown> }[] }[]; styles?: Style[] };

type Field = { type: string; system?: boolean; values?: string[] };
type Type = { id: string; pack: string; starter: string; flavour_of?: string; fields: Record<string, Field> };
const typeOf = async (l: Archipelago, id: string) => (await call<{ types: Type[] }>(l, human, 'schema', { type: id })).types[0];
const rootOf = async (l: Archipelago, id: string) => (await call<{ relations: { root?: string }[] }>(l, human, 'schema', { type: id })).relations[0]?.root;

test('the pack is a file and nothing that runs', () => {
  const files = readdirSync(import.meta.dirname).filter((f) => !f.endsWith('.test.ts'));
  assert.deepEqual(files, ['pack.json'], 'a file, and its tests');
  assert.ok(!existsSync(join(import.meta.dirname, 'handler.js')));
});

test('its types stand on the starters they say, and its links on the roots', async () => {
  const l = await fresh();
  const packs = await call<{ id: string; state: string; touches: { key: string; n: number }[] }[]>(l, human, 'packs', {});
  assert.equal(packs.find((p) => p.id === 'outreach')?.state, 'active');
  const starters = { post: 'work', channel: 'place', conversation: 'occurrence', channel_month: 'record' };
  for (const [id, starter] of Object.entries(starters)) {
    const t = await typeOf(l, id);
    assert.equal(t.starter, starter, id);
    assert.equal(t.pack, 'outreach', id);
  }
  assert.equal((await typeOf(l, 'channel_month')).flavour_of, 'finding', 'a month is a finding, read across by another island');
  assert.equal(await rootOf(l, 'goes_out_on'), 'lives_in');
  assert.equal(await rootOf(l, 'came_out_of'), 'about');
  const social = packs.find((p) => p.id === 'social');
  if (social) assert.equal(social.touches.find((t) => t.key === 'types')?.n, 0, 'social runs over these words and declares none of its own');
});

test('the counts are kept for the operator: system fields on posts, channels and months', async () => {
  const l = await fresh();
  const [post, channel, month] = [await typeOf(l, 'post'), await typeOf(l, 'channel'), await typeOf(l, 'channel_month')];
  const counted = ['visits', 'first_visit', 'last_visit', 'asked', 'begun', 'paid', 'ended'];
  for (const t of [post, channel]) for (const f of counted) assert.equal(t.fields[f]?.system, true, `${t.id}.${f}`);
  assert.equal(post.fields.conversations.system, true);
  for (const f of ['replies', 'impressions', 'reactions', 'reposts', 'tag', 'channel', 'posted']) assert.ok(!post.fields[f].system, `post.${f} is typed in`);
  for (const f of ['month', 'posts', 'visits', 'begun', 'paid', 'conversations', 'hours', 'met']) assert.equal(month.fields[f]?.system, true, `channel_month.${f}`);
});

test('a post set out empty, and one that went out, check as the write path checks them', async () => {
  const l = await fresh();
  const post = async (props: Record<string, unknown>) => {
    try {
      await make(l, [{ op: 'create', type: 'post', title: 'A post', props }]);
      return true;
    } catch (e) {
      return String(e);
    }
  };
  assert.equal(await post({ channel: 'linkedin', tag: 'linkedin-26w46-1' }), true);
  assert.equal(await post({ channel: 'x', posted: '2026-11-05', url: 'https://x.com/a/status/1', replies: 4, impressions: 900 }), true);
  assert.match(String(await post({ channel: 'myspace' })), /channel/, 'a channel not listed');
  assert.match(String(await post({ trials: 3 })), /trials/, 'a field the type does not declare');
});

test('its views are drawn by the kernel: a post’s length by its channel, and lenses on its own types', async () => {
  const screen = file.views!.find((v) => v.id === 'outreach.length')!;
  assert.equal(screen.form, 'screen');
  assert.deepEqual(screen.on, ['post']);
  const channels = (await typeOf(await fresh(), 'post')).fields.channel.values!;
  for (const c of Object.keys(screen.pieces![0].limits!)) assert.ok(channels.includes(c), `${c} is a channel a post may name`);
  const lenses = (file.styles ?? []).filter((s) => s.type === 'lens');
  assert.deepEqual(lenses.map((s) => s.title), ['Posts and what each brought', 'Channels and what each brought', 'Posts to write']);
  for (const s of lenses) {
    const shape = (s.props as { style?: { shape?: string } }).style?.shape;
    assert.ok(['list', 'flow', undefined].includes(shape), `${s.id} is drawn by a layout every map has`);
  }
});

test('its instructions hold that a post’s words are its author’s', () => {
  const said = (file.styles ?? []).filter((s) => s.type === 'instruction');
  const prose = said.find((s) => s.id === 'outreach.prose');
  assert.ok(prose && /Never draft, rewrite or suggest its words/.test(prose.body ?? ''));
  assert.ok(said.every((s) => (s.title ?? '').length <= 60));
});

test('how tags and conversations are kept is a guide, said when asked for, never a working rule of every project', () => {
  const said = (file.styles ?? []).filter((s) => s.type === 'instruction');
  const fors = Object.fromEntries(said.map((s) => [s.id, (s.props as { for: string[] }).for]));
  assert.deepEqual(fors, { 'outreach.prose': ['session_start'], 'outreach.tag': ['guide:social'], 'outreach.talk': ['guide:social'] });
  assert.match(said[0].body ?? '', /params for guide:social/);
});
