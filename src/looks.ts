// What the owner's page drew when an agent showed it something and asked to see it (report show, look: true). The
// picture is made in the owner's own browser, from what it drew there, and comes back with the page's next tail: a
// view is never drawn on the server, so a style's code runs only where it runs for any reader, in the reader's
// sandbox. A look is asked for one screen (a workspace and a person) and is kept there for LOOK_MS, in the transient
// table, so a page that polls one server answers a show made on another. The first page to answer is the one kept.

import { randomBytes } from 'node:crypto';
import type { Q } from './db.ts';
import { PICTURE_MAX } from './pictures.ts';
import { whose, type Whose } from './presence.ts';
import { keep, kept, keptWith } from './transient.ts';

/** How long a look asked for, and the picture that answers it, are kept. */
export const LOOK_MS = 30 * 60_000;
const LOOK = /^l_[0-9a-f]{12}$/;
const TYPES = ['image/png', 'image/jpeg'];

/** What a page says of what it drew: the picture as base64, or why it has none. */
export interface Drew {
  look: string;
  data?: string;
  content_type?: string;
  width?: number;
  height?: number;
  /** Why there is no picture: the page did not go there, or could not make one. */
  why?: string;
}

/** Ask the owner's page for a picture of what the next show puts on it: a name to answer by. */
export async function askLook(db: Q, w: Whose, actor: string): Promise<string> {
  const look = `l_${randomBytes(6).toString('hex')}`;
  await keep(db, `look:${whose(w)}:${look}`, { actor, asked: Date.now() }, LOOK_MS);
  return look;
}

/** A page's answer to a look: kept when the look was asked of this screen and nothing has answered it with a picture. */
export async function drew(db: Q, w: Whose, said: Drew): Promise<boolean> {
  if (!LOOK.test(said.look)) return false;
  const key = `look:${whose(w)}:${said.look}`;
  if (!(await kept(db, key))) return false;
  const had = await keptWith<{ why?: string }>(db, `${key}:drew`);
  if (had && !had.value.why) return false;
  if (!said.data) {
    await keep(db, `${key}:drew`, { why: String(said.why ?? 'The page drew nothing.').slice(0, 200) }, LOOK_MS);
    return true;
  }
  if (!TYPES.includes(String(said.content_type))) throw new Error(`A picture of the page is one of ${TYPES.join(', ')}.`);
  const bytes = Buffer.from(said.data, 'base64');
  if (!bytes.length || bytes.length > PICTURE_MAX) throw new Error(`A picture of the page is 1 to ${PICTURE_MAX} bytes, not ${bytes.length}.`);
  const size = (n: unknown) => (Number.isFinite(n) ? Math.round(Number(n)) : undefined);
  await keep(db, `${key}:drew`, { content_type: said.content_type, width: size(said.width), height: size(said.height), at: Date.now() }, LOOK_MS, bytes);
  return true;
}

/** What answered a look on this screen: the picture as base64, or why there is none; undefined while nothing has. */
export async function lookAt(db: Q, w: Whose, look: string) {
  if (!LOOK.test(look)) throw new Error(`"${look}" is not a look: show with look: true names one.`);
  const key = `look:${whose(w)}:${look}`;
  if (!(await kept(db, key))) throw new Error(`No look "${look}" was asked of this screen in the last ${LOOK_MS / 60_000} minutes.`);
  const got = await keptWith<{ content_type?: string; width?: number; height?: number; why?: string }>(db, `${key}:drew`);
  if (!got) return undefined;
  if (got.value.why || !got.data) return { look, picture: null, why: got.value.why ?? 'The page drew nothing.' };
  return { look, content_type: got.value.content_type, width: got.value.width, height: got.value.height, size: got.data.length, data: got.data.toString('base64') };
}

/** Wait up to `ms` for a look to be answered. */
export async function awaitLook(db: Q, w: Whose, look: string, ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    const got = await lookAt(db, w, look);
    if (got && !got.why) return got;
    if (Date.now() >= until) return got ?? { look, picture: null, why: `No page of theirs answered within ${Math.round(ms / 1000)} s: read it later with query picture, look.` };
    await new Promise((r) => setTimeout(r, 400));
  }
}
