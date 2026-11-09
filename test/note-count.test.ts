// How long a note is while it is written (ui/note-count.js): a post's ## Text counted as the places it goes count it,
// against the limit its channel picks from a pack's count piece (here one written out, as a pack would declare it).
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page's module, plain JavaScript with no types
import { counted, sectionOf, weigh } from '../ui/note-count.js';

const piece = {
  piece: 'count',
  section: 'Text',
  by: 'channel',
  limits: { linkedin: { max: 3000, low: 1200, high: 1900 }, x: { max: 280, split: 'paragraph', emoji: 2, link: 23 }, bluesky: { max: 300 } },
};

test('an emoji is one character, never the two halves it is stored as', () => {
  assert.equal(weigh('ok 👍🏽'), 4);
  assert.equal(weigh('👨‍👩‍👧'), 1);
  assert.equal(weigh('é'), 1);
});

test('a place that weighs emoji and addresses more says so in its limit', () => {
  assert.equal(weigh('hi 👍 https://archipelago.tools/?ref=x-26w45-2', { emoji: 2, link: 23 }), 3 + 2 + 1 + 23);
});

test('the section under its heading, to the next heading as high', () => {
  const body = 'Facts.\n\n## Text\nLine one.\n\n### Hook\nLine two.\n\n## Notes\nNot counted.';
  assert.equal(sectionOf(body, 'Text'), 'Line one.\n\n### Hook\nLine two.');
  assert.equal(sectionOf(body, 'text'), sectionOf(body, 'Text'));
  assert.equal(sectionOf('No heading here', 'Text'), null);
  assert.equal(sectionOf('## Text\n', 'Text'), '');
});

test('a LinkedIn post is marked in its best length, past it, and over its limit', () => {
  const post = (n: number) => `Facts the post is drawn from.\n\n## Text\n${'a'.repeat(n)}`;
  const at = (n: number) => counted(post(n), piece, { channel: 'linkedin' });
  assert.deepEqual([at(500).state, at(1500).state, at(2000).state, at(3001).state], ['', 'best', 'near', 'over']);
  assert.equal(at(1500).n, 1500);
  assert.equal(at(1500).limit.max, 3000);
});

test('an X thread counts each post, the longest against 280', () => {
  const c = counted(`## Text\n${'a'.repeat(100)}\n\n${'b'.repeat(290)}\n\n${'c'.repeat(10)}`, piece, { channel: 'x' });
  assert.deepEqual([c.n, c.posts, c.state], [290, 3, 'over']);
});

test('a channel with no limit, or a note with no count piece, is counted whole and quiet', () => {
  assert.deepEqual(counted('## Text\nHello', piece, { channel: 'hn' }), { n: 5, posts: 1, limit: null, state: '' });
  assert.equal(counted('  A note.  ', undefined).n, 7);
  assert.equal(counted('A post with no text yet', piece, { channel: 'x' }), null);
});
