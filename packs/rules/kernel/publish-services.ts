// The rules root's services for the publish pack (docs/kernel-packs.md, "Root services"), called only by the packs
// packs/roots.json names: whether this actor may publish or take down (root.may, core's agent_publish and
// agent_unpublish, as decide judges them), and a picture kept for an item (root.picture): checked at the walls, held to
// what the workspace may store, written with the observation that says it, as the one who sent it. Values in, values out.

import { createHash } from 'node:crypto';
import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { svgRefused } from '../../walls/kernel/svg-figure.ts';
import { mayDo } from './rules.ts';
import { roomToStore } from '../../identity/kernel/standing.ts';

/** The acts root.may answers: publishing's, and no more. */
const ACTS = ['publish', 'unpublish'];

/** root.may: refused, saying why, unless a rule lets this kind of actor do the act here. */
export async function may(call: RootCall, input: { act: string; human: boolean }): Promise<true> {
  const l = call.map;
  if (!l) throw new Error('root.may asks of a map: a server duty has none');
  if (!ACTS.includes(input?.act)) throw new Error(`root.may answers ${ACTS.join(' and ')}, not ${String(input?.act)}`);
  await mayDo(l.db, l.registry, input.human === true, input.act);
  return true;
}

/** root.picture: keep the picture for an item, in place of any before it, as `actor` sent it. The type and size are the caller's to check first. */
export async function picture(call: RootCall, input: { id: string; actor: string; content_type: string; data: string }) {
  const l = call.map;
  if (!l) throw new Error('root.picture writes a map: a server duty has none');
  const bytes = Buffer.from(String(input.data), 'base64');
  // An SVG is kept only when it is drawing alone (the walls' check, ../../walls/kernel/svg-figure.ts).
  const refused = input.content_type === 'image/svg+xml' ? svgRefused(bytes.toString('utf8')) : null;
  if (refused) throw new Error(`picture_put: an SVG is kept only when it is drawing alone, and ${refused}.`);
  await roomToStore(l.workspace);
  await l.db.query(
    `insert into picture (entity_id, content_type, bytes, size) values ($1, $2, decode($3, 'base64'), $4)
     on conflict (entity_id) do update set content_type = excluded.content_type, bytes = excluded.bytes, size = excluded.size, created_at = now()`,
    [input.id, input.content_type, bytes.toString('base64'), bytes.length],
  );
  await l.record('observations', input.actor, [['+', input.id, 'picture', { $blob: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, type: input.content_type }]]);
  return { size: bytes.length };
}
