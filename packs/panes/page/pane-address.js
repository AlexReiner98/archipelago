// What an address of the page draws in a pane (packs/surface/page/app.js gives the pane in focus the page's address).
// The browser's back and forward are the runtime's, told to the panes part (packs/surface/page/part-page.js).

import { readAddress } from './query.js';

/** What an address draws in a pane (`v`, `v?…`, a web page's `w?…`), or undefined where it names a page and no lens. */
export function atOf(hash) {
  const [where, query = ''] = (hash || '#/').split('?');
  const [, name = '', arg] = where.split('/');
  if (name === '') return 'v';
  if (name === 'v') return query ? `v?${query}` : 'v';
  if (name === 'w') return query ? `w?${query}` : 'v';
  if (name === 'e' && arg && readAddress(query).lens) return `v?${query}`;
  return undefined;
}
