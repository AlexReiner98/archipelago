// What a view looks like, for an agent: drawn by the server, in its headless Chrome (look-draw.ts), from the
// app's own page, as the agent sees the map, whatever page of the owner's is open or not (decision e_wsz3wdzp). The
// page reads with a look pass (packs/walls/kernel/look-pass.ts, the trusted half, kept in the walls): a token for one look, minted
// for the asking agent's own person (never an admin), good for one drawing and for the reads a canvas makes
// (LOOK_READS) and nothing else. So private items are drawn exactly as query shows them to that agent. The picture
// is kept in the transient table for LOOK_MS, under the screen it was asked for, and read again with query picture;
// the same view at the same size, the map, the UI's files and this process unchanged since, is that kept picture
// again rather than a second drawing, and says when it was drawn.

import { createHash, randomBytes } from 'node:crypto';
import type { KernelContext } from '#pelago/kernel';
import { drawLook, type Marks } from './look-draw.ts';
import { keep, kept, keptWith } from './store.ts';

// What the roots do for a look (root.look, packs/surface): the UI's version, the pass the drawing reads with (minted by
// the walls, packs/walls/kernel/look-pass.ts, where the server's gate reads it) and the room the workspace has for another look.
type Look = { ui: string } & { pass: string } & { most: number; refused?: string };
const ofRoots = (ctx: KernelContext, ask: Record<string, unknown>) => ctx.call<Record<string, unknown>, Look>('root.look', ask);

/** Whose screen: per workspace and per person (as presence keys it). */
export type Whose = { workspace: string; viewer?: string };
const whose = (w: Whose) => `${w.workspace}:${w.viewer ?? ''}`;
const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** How long a look's picture is kept. */
export const LOOK_MS = 30 * 60_000;
/** The most looks drawn for one workspace in an hour, by this process. */
const PER_HOUR = 60;
const LOOK = /^l_[0-9a-f]{12}$/;
/** When this process began: a picture kept by another process (the server restarted on new code) is not taken again. */
const BEGAN = new Date().toISOString();

/** Where the server's Chrome opens the app: this server, or the name another container knows it by. */
let origin = 'http://127.0.0.1:3100';
export const setLookOrigin = (url: string) => void (origin = url.replace(/\/$/, ''));
export const lookOrigin = () => origin;

const drawn = new Map<string, { t: number; by: string }[]>();
const lastHour = (workspace: string, now = Date.now()) => (drawn.get(workspace) ?? []).filter((x) => x.t > now - 3_600_000);
/** The looks drawn for a workspace in the last hour, by this process. */
export const looksThisHour = (workspace: string) => lastHour(workspace).length;
/** The looks drawn for a workspace in the last hour, by who asked (the person whose view it was, else the agent). */
export function looksBy(workspace: string): Map<string, number> {
  const by = new Map<string, number>();
  for (const x of lastHour(workspace)) by.set(x.by, (by.get(x.by) ?? 0) + 1);
  return by;
}
/** Another look for this workspace, asked by `by`, unless it has had its limit (else PER_HOUR) in the last hour. */
export async function countLook(ctx: KernelContext, by = '') {
  const workspace = ctx.workspace;
  const now = Date.now(), had = lastHour(workspace, now);
  const { most, refused } = await ofRoots(ctx, { room: { had: had.length, otherwise: PER_HOUR } });
  if (had.length >= most) throw new Error(refused ?? `This workspace has had ${most} looks in the last hour: read one again with query picture, or wait.`);
  drawn.set(workspace, [...had, { t: now, by }]);
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
  /** When it was drawn. */
  at: string;
  workspace: string;
  marks?: Marks;
  fell_back?: { asked: string; drawn: string }[];
}

/** What a look answers: what was drawn and how it stood, with the picture as an image (packs/surface/kernel/mcp.ts sends it as one), or the drawing's marks where they were asked for and it has them. */
const answer = (look: string, k: Kept, data: Buffer, again = false) => ({
  look,
  view: k.hash,
  workspace: k.workspace,
  drawn_at: k.at,
  scheme: k.scheme,
  state: k.state,
  settled: k.settled,
  ...(k.why && { why: k.why }),
  ...(k.fell_back && { fell_back: k.fell_back }),
  width: k.width,
  height: k.height,
  bytes: data.length,
  ...(again ? { again: true } : { ms: k.ms }),
  ...(k.marks ? { marks: k.marks } : { image: { data: data.toString('base64'), content_type: k.content_type } }),
});

/**
 * Draw the page at `hash` (as the UI addresses it: v?canvas=<id>, v?<lens>, e/<id>; or preview/<id>, a document as it
 * would publish) for the asking agent and keep the picture. `fresh` draws it again whatever has changed or not.
 */
export async function takeLook(ctx: KernelContext, w: Whose, actor: string, hash: string, size: { width?: number; height?: number; scheme?: 'dark' | 'light'; fresh?: boolean; marks?: boolean } = {}) {
  const width = Math.min(1920, Math.max(320, Math.round(size.width ?? 1200)));
  const height = Math.min(1600, Math.max(240, Math.round(size.height ?? 750)));
  const scheme = size.scheme ?? 'dark';
  // Marks are a canvas's: an item's page is a page, and is a picture.
  const marks = Boolean(size.marks) && hash.startsWith('v');
  const pos = await ctx.reads({ log_head: true });
  const same = `lookof:${whose(w)}:${sha256Hex(JSON.stringify([hash, width, height, scheme, pos, marks, (await ofRoots(ctx, { ui: true })).ui, BEGAN])).slice(0, 32)}`;
  if (!size.fresh) {
    const was = await kept<{ look: string }>(ctx, same);
    const had = was && (await keptWith<Kept>(ctx, `look:${whose(w)}:${was.look}`));
    if (was && had?.data) return answer(was.look, had.value, had.data, true);
  }
  await countLook(ctx, w.viewer || actor);
  const { pass } = await ofRoots(ctx, { pass: { actor } });
  const address = hash.startsWith('preview/') ? `${origin}/${hash}?look` : `${origin}/?look#/${hash}`;
  const got = await drawLook(address, pass, width, height, scheme, marks);
  const look = `l_${randomBytes(6).toString('hex')}`;
  const k: Kept = { scheme, content_type: got.content_type, width: got.width, height: got.height, state: got.state, settled: got.settled, ...(got.why && { why: got.why }), hash, ms: got.ms, at: new Date().toISOString(), workspace: w.workspace, ...(got.marks && { marks: got.marks }), ...(got.fell_back && { fell_back: got.fell_back }) };
  await keep(ctx, `look:${whose(w)}:${look}`, k, LOOK_MS, got.data);
  await keep(ctx, same, { look }, LOOK_MS);
  return answer(look, k, got.data);
}

/** A look taken on this screen in the last LOOK_MS, again. */
export async function lookAt(ctx: KernelContext, w: Whose, look: string) {
  if (!LOOK.test(look)) throw new Error(`"${look}" is not a look: query look or show with look: true names one.`);
  const got = await keptWith<Kept>(ctx, `look:${whose(w)}:${look}`);
  if (!got?.data) throw new Error(`No look "${look}" was taken on this screen in the last ${LOOK_MS / 60_000} minutes.`);
  return answer(look, got.value, got.data, true);
}

/** answer.look: a look taken for the tool surface (a show with look: true), on the screen it names (`whose`). */
export const lookAnswer = (ctx: KernelContext, input: { whose: Whose; actor: string; hash: string; size?: Parameters<typeof takeLook>[4] }) => takeLook(ctx, input.whose, input.actor, input.hash, input.size);

/** answer.look_at: a look taken on the screen it names (`whose`) in the last LOOK_MS, again. */
export const lookAtAnswer = (ctx: KernelContext, input: { whose: Whose; look: string }) => lookAt(ctx, input.whose, input.look);

/** answer.looks_counted: the looks drawn for the asking map's workspace in the last hour, all and by who asked, by this process. */
export const looksCounted = (ctx: KernelContext) => ({ hour: looksThisHour(ctx.workspace), by: [...looksBy(ctx.workspace)] });
