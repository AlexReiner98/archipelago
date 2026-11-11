// What every address of a site answers, kept to compare: its status, its title, the address it says to keep and a
// digest of its words. Run it against a server before a change to what a site is read from and after it (public
// views, task e_3zm5mexm), on a copy of the live map (`npm run pull`), and it says what answers differently.
//
//   node scripts/site-check.ts <server> <site domain> <file.json>              records what each address answers
//   node scripts/site-check.ts <server> <site domain> <file.json> <before.json>  and says what differs from before
//
// The server is asked as the site's domain (its Host), so a local server with PELAGO_SITES naming that domain answers
// as the live one does. The addresses are the site's own (/, /home, /footer, robots.txt, sitemap.xml, llms.txt), every one its
// sitemap names, then and now, and every one the file before held.

import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

type Answer = { status: number; title?: string; canonical?: string; location?: string; words?: string };

const [server, domain, file, before] = process.argv.slice(2);
if (!server || !domain || !file) {
  console.error('node scripts/site-check.ts <server> <site domain> <file.json> [<before.json>]');
  process.exit(2);
}

/** What the server answers at path, asked as the site's domain. */
function ask(path: string): Promise<{ status: number; body: string; location?: string }> {
  const url = new URL(path, server);
  return new Promise((done, fail) => {
    const req = request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { host: domain, 'user-agent': 'site-check' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, body, location: res.headers.location }));
    });
    req.on('error', fail);
    req.end();
  });
}

const entity = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const canonicalOf = (html: string) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
/** A digest of the words a page's data holds (its parts, in order), so the same words are told from other ones. */
const wordsOf = (html: string) => {
  const data = /id="page-data">(.*?)<\/script>/s.exec(html)?.[1];
  return data ? createHash('sha256').update(JSON.stringify(JSON.parse(data).parts ?? null)).digest('hex').slice(0, 16) : undefined;
};
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(entity(m[1])).pathname);

const was: Record<string, Answer> = before ? JSON.parse(readFileSync(before, 'utf8')) : {};
const sitemap = await ask('/sitemap.xml');
const paths = [...new Set(['/', '/home', '/footer', '/robots.txt', '/sitemap.xml', '/llms.txt', ...locs(sitemap.body), ...Object.keys(was)])].sort();
const now: Record<string, Answer> = {};
for (const path of paths) {
  const got = await ask(path);
  const title = titleOf(got.body);
  const canonical = canonicalOf(got.body);
  const words = wordsOf(got.body);
  now[path] = { status: got.status, ...(title && { title: entity(title) }), ...(canonical && { canonical }), ...(words && { words }), ...(got.location && { location: got.location }) };
}
writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
console.log(`${paths.length} addresses of ${domain} recorded in ${file}.`);
if (!before) process.exit(0);

const differs = paths.filter((path) => JSON.stringify(was[path] ?? null) !== JSON.stringify(now[path]));
for (const path of differs) console.log(`${path}\n  before ${JSON.stringify(was[path] ?? null)}\n  now    ${JSON.stringify(now[path])}`);
console.log(differs.length ? `${differs.length} of ${paths.length} answer differently.` : `All ${paths.length} answer as before.`);
process.exit(differs.length ? 1 : 0);
