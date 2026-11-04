// Visits to a public site, counted per tag per day: a reader's page load only, never a bot's, a prefetch or a page's
// data, and nothing of the request kept but the count.

import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { dayOf, heldVisits, isVisit } from '../src/visits.ts';
import { serve } from './serve.ts';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

test('a reader is a GET from a browser, not a bot, a prefetch or a HEAD', () => {
  const as = (agent: string, more: Record<string, string> = {}, method = 'GET') => isVisit({ method, headers: { 'user-agent': agent, ...more } });
  assert.ok(as(BROWSER));
  for (const bot of ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', 'Twitterbot/1.0', 'facebookexternalhit/1.1', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'Cardyb/1.1', 'TelegramBot (like TwitterBot)', 'WhatsApp/2.23', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'SomeCrawler/1', 'a spider', 'Link Preview'])
    assert.ok(!as(bot), bot);
  assert.ok(!as(BROWSER, {}, 'HEAD'));
  assert.ok(!as(BROWSER, { 'sec-purpose': 'prefetch' }));
  assert.ok(!as(BROWSER, { 'sec-purpose': 'prefetch;prerender' }));
  assert.ok(!as(BROWSER, { purpose: 'prefetch' }));
});

/** A request as a browser at the site's domain sends it. */
function visit(base: string, path: string, headers: Record<string, string>, method = 'GET') {
  const { hostname, port } = new URL(base);
  return new Promise<number>((resolve, reject) => {
    request({ hostname, port, path, method, headers: { host: 'visits.test', 'user-agent': BROWSER, ...headers } }, (res) => res.resume().on('end', () => resolve(res.statusCode ?? 0))).on('error', reject).end();
  });
}

test('a page read with a tag is counted once, under its tag; its data, figures, a bot and a prefetch are not', async () => {
  const { call, base } = await serve('off', undefined, { 'visits.test': 'default' });
  const { home } = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'home', type: 'document', title: 'Welcome', visibility: 'shared', props: { path: 'home' }, body: 'The front page.' }] })).result.created;
  assert.equal((await call('/api/publish', undefined, { id: home })).status, 200);
  const today = dayOf();
  const count = (tag: string) => heldVisits('default').find((r) => r.tag === tag && r.day === today)?.n ?? 0;

  for (let i = 0; i < 3; i++) assert.equal(await visit(base, '/?ref=x', {}), 200);
  assert.equal(count('x'), 3, 'each page load counts');
  assert.equal(await visit(base, '/data?ref=x', {}), 200);
  assert.equal(await visit(base, '/picture/nothing?ref=x', {}), 404);
  assert.equal(await visit(base, '/robots.txt?ref=x', {}), 200);
  assert.equal(await visit(base, '/home?ref=x', {}), 301);
  assert.equal(await visit(base, '/nowhere?ref=x', {}), 404);
  await visit(base, '/?ref=x', { 'user-agent': 'LinkedInBot/1.0' });
  await visit(base, '/?ref=x', { 'sec-purpose': 'prefetch' });
  await visit(base, '/?ref=x', {}, 'HEAD');
  assert.equal(count('x'), 3, 'nothing but a reader’s page load counts');

  await visit(base, '/', { referer: 'https://news.ycombinator.com/item?id=1' });
  assert.equal(count('ycombinator'), 1, 'an untagged page from another site counts under its name');
  await visit(base, '/', { referer: 'https://visits.test/other' });
  await visit(base, '/', {});
  assert.deepEqual(heldVisits('default').map((r) => r.tag).sort(), ['x', 'ycombinator'], 'no tag, no count');
});
