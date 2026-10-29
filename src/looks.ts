// What a view looks like, for an agent: drawn by the server, in its headless Chrome (src/look-draw.ts), from the
// app's own page, as the agent sees the map, whatever page of the owner's is open or not (decision e_wsz3wdzp). The
// page reads with a look pass: a token for one look, minted here for the asking agent's own person (never an admin),
// good for LOOK_PASS_MS and for the reads a canvas makes (LOOK_READS) and nothing else. So private items are drawn
// exactly as query shows them to that agent. The picture is kept in the transient table for LOOK_MS, under the
// screen it was asked for, and read again with query picture; the same view at the same size, the map unchanged
// since, is that kept picture again rather than a second drawing.

import { createHash, randomBytes } from 'node:crypto';
import type { Q } from './db.ts';
import { drawLook } from './look-draw.ts';
import { whose, type Whose } from './presence.ts';
import { looksAllowed, overLimit } from './plan.ts';
import { headPos } from './tail.ts';
import { keep, kept, keptWith } from './transient.ts';

/** How long a look's picture is kept. */
export const LOOK_MS = 30 * 60_000;
/** How long a look pass reads for: one drawing. */
const LOOK_PASS_MS = 90_000;
/** The most looks drawn for one workspace in an hour, by this process. */
const PER_HOUR = 60;
const LOOK = /^l_[0-9a-f]{12}$/;
const PASS = /^look_([a-z0-9][a-z0-9-]{0,39})_[0-9a-f]{40}$/;

/** What a look pass may call through /api: what the canvas reads to draw a view, and nothing that writes. */
export const LOOK_READS = new Set(['view', 'places', 'schema', 'get', 'proposals', 'search', 'picture', 'document', 'events']);

/** Where the server's Chrome opens the app: this server, or the name another container knows it by. */
let origin = 'http://127.0.0.1:3100';
export const setLookOrigin = (url: string) => void (origin = url.replace(/\/$/, ''));
export const lookOrigin = () => origin;

/** Who a pass reads as: the person whose view it is (null: the map unscoped, as a server with no tokens has it). */
export interface Pass {
  viewer: string | null;
  actor: string;
}

const hashOf = (pass: string) => createHash('sha256').update(pass).digest('hex');

/** The workspace a look pass is for, when the token is one. Says nothing about whether it is good. */
export const passWorkspace = (token: string | undefined) => (token ? PASS.exec(token)?.[1] : undefined);

/** Whom a look pass reads as, while it is good. */
export const readPass = (db: Q, token: string) => kept<Pass>(db, `lookpass:${hashOf(token)}`);

/** A look pass for this screen's person, made for `actor`: what the server's Chrome reads with, for one drawing. */
export async function passFor(db: Q, w: Whose, actor: string): Promise<string> {
  const pass = `look_${w.workspace}_${randomBytes(20).toString('hex')}`;
  await keep(db, `lookpass:${hashOf(pass)}`, { viewer: w.viewer ?? null, actor } satisfies Pass, LOOK_PASS_MS);
  return pass;
}

const drawn = new Map<string, number[]>();
/** The looks drawn for a workspace in the last hour, by this process. */
export const looksThisHour = (workspace: string) => (drawn.get(workspace) ?? []).filter((t) => t > Date.now() - 3_600_000).length;
/** Another look for this workspace, unless it has had its plan's (else PER_HOUR) in the last hour. */
export async function countLook(workspace: string) {
  const { most, limits } = await looksAllowed(workspace, PER_HOUR);
  const now = Date.now(), had = (drawn.get(workspace) ?? []).filter((t) => t > now - 3_600_000);
  if (had.length >= most) throw limits ? await overLimit(workspace, limits, 'looks', had.length, 'read one again with query picture, or wait') : new Error(`This workspace has had ${most} looks in the last hour: read one again with query picture, or wait.`);
  drawn.set(workspace, [...had, now]);
}

interface Kept {
  scheme: 'dark' | 'light';
  content_type: string;
  width: number;
  height: number;
  state: string;
  settled: boolean;
  why?: string;
  hash: string;
  ms: number;
}

/** What a look answers: what was drawn and how it stood, with the picture as an image (src/mcp.ts sends it as one). */
const answer = (look: string, k: Kept, data: Buffer, again = false) => ({
  look,
  view: k.hash,
  scheme: k.scheme,
  state: k.state,
  settled: k.settled,
  ...(k.why && { why: k.why }),
  width: k.width,
  height: k.height,
  bytes: data.length,
  ...(again ? { again: true } : { ms: k.ms }),
  image: { data: data.toString('base64'), content_type: k.content_type },
});

/**
 * Draw the page at `hash` (as the UI addresses it: v?canvas=<id>, v?<lens>, e/<id>) for the asking agent and keep the
 * picture. `fresh` draws it again even when the map has not changed since the last look at it.
 */
export async function takeLook(db: Q, mapDb: Q, w: Whose, actor: string, hash: string, size: { width?: number; height?: number; scheme?: 'dark' | 'light'; fresh?: boolean } = {}) {
  const width = Math.min(1920, Math.max(320, Math.round(size.width ?? 1200)));
  const height = Math.min(1600, Math.max(240, Math.round(size.height ?? 750)));
  const scheme = size.scheme ?? 'dark';
  const pos = await headPos(mapDb);
  const same = `lookof:${whose(w)}:${createHash('sha256').update(JSON.stringify([hash, width, height, scheme, pos])).digest('hex').slice(0, 32)}`;
  if (!size.fresh) {
    const was = await kept<{ look: string }>(db, same);
    const had = was && (await keptWith<Kept>(db, `look:${whose(w)}:${was.look}`));
    if (was && had?.data) return answer(was.look, had.value, had.data, true);
  }
  await countLook(w.workspace);
  const pass = await passFor(db, w, actor);
  const got = await drawLook(`${origin}/?look#/${hash}`, pass, width, height, scheme);
  const look = `l_${randomBytes(6).toString('hex')}`;
  const k: Kept = { scheme, content_type: got.content_type, width: got.width, height: got.height, state: got.state, settled: got.settled, ...(got.why && { why: got.why }), hash, ms: got.ms };
  await keep(db, `look:${whose(w)}:${look}`, k, LOOK_MS, got.data);
  await keep(db, same, { look }, LOOK_MS);
  return answer(look, k, got.data);
}

/** A look taken on this screen in the last LOOK_MS, again. */
export async function lookAt(db: Q, w: Whose, look: string) {
  if (!LOOK.test(look)) throw new Error(`"${look}" is not a look: query look or show with look: true names one.`);
  const got = await keptWith<Kept>(db, `look:${whose(w)}:${look}`);
  if (!got?.data) throw new Error(`No look "${look}" was taken on this screen in the last ${LOOK_MS / 60_000} minutes.`);
  return answer(look, got.value, got.data, true);
}
