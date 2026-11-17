// Lets node import the page's modules as the browser does. A page module names another by its name alone
// (`./base.js`), and the server serves it from whichever root pack's page/ holds it (packs/surface/kernel/ui-files.ts),
// so the file is often not beside the one that imports it. This hook resolves such a name the same way, for tests only:
// nothing is built and nothing changes in the browser.
//
//   import { pageModule } from './page-loader.ts';
//   const { pageIsA } = await pageModule('page-schema.js');

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { servedFrom } from '../packs/surface/kernel/ui-files.ts';

type Next = (specifier: string, context: { parentURL?: string }) => Promise<{ url: string }>;

/** A module of the page asking for another by its bare name: resolved to where the server serves that name from. */
export async function resolve(specifier: string, context: { parentURL?: string }, next: Next) {
  const name = /^\.\/([\w.-]+\.js)$/.exec(specifier)?.[1];
  if (name && context.parentURL && /\/packs\/[\w-]+\/page\/[\w.-]+\.(js|ts)$/.test(context.parentURL.replace(/\\/g, '/'))) {
    const from = servedFrom(name);
    if (from) return { url: pathToFileURL(from).href, shortCircuit: true };
  }
  return next(specifier, context);
}

let on = false;
/** Turn the hook on (once) and import a page module by the name the page serves it at. */
export async function pageModule(name: string) {
  if (!on) register(import.meta.url);
  on = true;
  const from = servedFrom(name);
  if (!from) throw new Error(`${name} is not a module of the page`);
  return import(pathToFileURL(from).href);
}
