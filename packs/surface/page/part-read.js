// Live reads (task e_rfjwstnu): a part asks a read it declared `live` (`views` entries with `live: true`) when it
// needs it, as find asks for what typed words could be, with `tools.read(name, params)`. Asked as the person looking,
// so it never gets what they may not see; only a read it declared, a few at a time, and its words checked here.

import { api } from './base.js';

/** The kernel's reads a part may declare live without a pack answering them: search, by words, as anyone signed in may. */
const KERNEL_READS = { search: (params) => api('search', params) };
/** How many reads one mounted part may have out at once: one more is answered nothing, as an action is while one goes out. */
const outstandingMost = 4;
/** How many characters a read's params may be. */
const paramsMost = 20000;

/** Answer one `read { asked, name, params }` from the part mounted as `m`, through `answer(message)` on its port. */
export async function readFor(m, said, answer) {
  const name = String(said?.name ?? '');
  const done = (value) => answer({ type: 'readed', asked: said?.asked, value: value ?? null });
  if (!(m.part.views ?? []).some((v) => v.name === name && v.live)) return done(null);
  if ((m.reading ?? 0) >= outstandingMost) return done(null);
  const params = said?.params;
  if (!params || typeof params !== 'object' || Array.isArray(params) || JSON.stringify(params).length > paramsMost) return done(null);
  m.reading = (m.reading ?? 0) + 1;
  try {
    done(await (KERNEL_READS[name] ? KERNEL_READS[name](params) : api('view', { name, params })));
  } catch {
    done(null);
  } finally {
    m.reading--;
  }
}
