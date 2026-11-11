// A site's front page as its home view baked (task e_ufafh5dd; decision e_btxq2nzq): where the public view at /home is
// drawn by the rails, / is that view as one page (./bake.js), each stop has an address of its own, an agent asking for
// JSON at / is given the stops and the install line, and arrivals at each stop and presses of the main button are
// counted under the tag the reader came by. Counts only (./visit.js): no address, no browser string.
//
// A stop's address is /<its id>: a path and not a #fragment, so a link to one stop, posted, shows that stop's title and
// words in its card and is indexed as a page of its own; an id (e_ and eight letters or digits) is never an address
// word (lowercase and dashes only), so no page's address can be taken by it. In the page, #s-<id> still leads to it.

import { readFileSync } from 'node:fs';
import { bakedPage, lookCss, stopOf, stopsOf } from './bake.js';
import { publicHead } from './head.js';
import { isVisit, tagOf } from './visit.js';

const HOME = 'home';
const ID = /^e_[a-z0-9]{8}$/;
const KEPT = 300;
/** The page's own files, read once: rails.js walks it, baked.js counts arrivals and gives each stop its address. */
const FILES = Object.fromEntries(
  [['/rails.js', 'rails.js', 'text/javascript'], ['/rails.css', 'rails.css', 'text/css'], ['/baked.js', 'baked.js', 'text/javascript'], ['/baked.css', 'baked.css', 'text/css']].map(([at, file, type]) => [at, { text: readFileSync(new URL(`./public/${file}`, import.meta.url), 'utf8'), type }]),
);
/** The tag a count is kept under when the reader came by none. */
export const DIRECT = 'direct';

/** A count's key: what happened, and the tag, cut to the 40 a key may have. */
export const keyOf = (what, tag) => `${what}-${tag ?? DIRECT}`.slice(0, 40);

/** Whether the request asks for JSON before a page. */
const wantsJson = (accept = '') => /application\/json/.test(accept) && !/text\/html/.test(accept);

/** The line an agent is handed to set Archipelago up for a person. */
export const installLine = (app) => `To set it up for a person, connect to the hosted service at ${app}: fetch ${app}/connect/install and follow the section for your client.`;

/**
 * Answer `pathname` on a site whose home view is baked, or null when it is not one of its addresses (the site answers
 * it as any other). `act` asks the kernel; `count(key)` counts on the site's map.
 */
export async function bakedSite(parts, act, count) {
  const { workspace, path: pathname = '/', host, name, app, start } = parts;
  if (FILES[pathname]) return { ...FILES[pathname], cache: KEPT };
  const steps = pathname.split('/').filter(Boolean);
  const ours = steps.length === 0 || (steps.length === 1 && (ID.test(steps[0]) || steps[0] === 'look.css')) || steps[0] === 'go';
  if (!ours) return null;
  const baked = await act('public.baked', { workspace, path: HOME }).catch(() => null);
  if (!baked) return null;
  const request = parts.request ?? {};
  const tag = tagOf(request, host);
  const visit = isVisit(request);
  if (steps[0] === 'look.css') return { text: lookCss(baked, (await act('public.at', { workspace, path: HOME })) ?? {}), type: 'text/css', cache: KEPT };
  // The main button: counted, then on to where a person with no account begins, carrying the tag.
  if (steps[0] === 'go' && steps[1] === 'start' && steps.length === 2) {
    if (visit) await count(keyOf('start', tag));
    const to = `${app ?? ''}${start ?? '/'}`;
    return { redirect: tag ? `${to}${to.includes('?') ? '&' : '?'}ref=${encodeURIComponent(tag)}` : to, status: 302 };
  }
  // A reader arrived at a stop (baked.js asks once a stop, as the walk reaches it).
  if (steps[0] === 'go' && steps[1] === 'seen' && steps.length === 3) {
    const stop = ID.test(steps[2]) && stopOf(baked, steps[2]);
    if (!stop) return { status: 404, text: 'No such stop.', type: 'text/plain' };
    if (visit) await count(keyOf(`stop-${stop.id.slice(2)}`, tag));
    return { text: '', type: 'text/plain' };
  }
  if (steps[0] === 'go') return null;
  const doc = await act('public.at', { workspace, path: HOME });
  if (!doc) return null;
  const origin = `https://${host}`;
  const startAt = start || app ? `/go/start${tag ? `?ref=${encodeURIComponent(tag)}` : ''}` : undefined;
  if (steps.length === 0 && wantsJson(request.accept)) {
    return { json: { title: doc.title, stops: stopsOf(baked, origin), ...(app && { install: installLine(app), start: `${app}${start ?? '/'}` }) } };
  }
  const stop = steps.length === 1 ? stopOf(baked, steps[0]) : undefined;
  if (steps.length === 1 && !stop) return null;
  const site = { name: name ?? workspace, footer: footerOf(await act('public.at', { workspace, path: 'footer' }).catch(() => null)) };
  // Its head says the stop it opens at, else the view; the picture a link shows is the view's own (page.share).
  const own = typeof doc.share === 'string' && doc.parts?.some((p) => p.section?.id === doc.share && p.section.picture) ? doc.share : undefined;
  const image = own ? `${origin}/picture/${own}` : undefined;
  const said = stop ? { title: `${stop.title} · ${site.name}`, parts: [{ text: stop.note }] } : { title: doc.title, parts: baked.scene.stops[0]?.note ? [{ text: baked.scene.stops[0].note }] : doc.parts ?? [] };
  const canonical = `${origin}${stop ? `/${stop.id}` : '/'}`;
  const head = publicHead('<meta name="robots" content="noindex" />', said, canonical, site.name, image);
  const look = `/look.css?v=${encodeURIComponent(baked.key)}`;
  return { html: bakedPage(baked, doc, { title: said.title, head, site, start: startAt, look, stop, ref: tag }) };
}

const footerOf = (foot) => (foot?.parts ?? []).flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join('\n\n');
