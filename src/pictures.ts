// The pictures kept for items whose page shows one: a figure (a test result's, a note's, a file's), and the still
// of a lens. What a test run found is the software pack's test_report, which asks for pictures to be dropped.

import { createHash } from 'node:crypto';
import { actorId, type Actor, type Archipelago } from './pelago.ts';

/** The most a kept picture may weigh. A capture of a view at screen size is well under it. */
export const PICTURE_MAX = 1_000_000;
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Keep the picture for an item whose page shows one (a screen of it draws a
 * figure: a test result, a note, a file), or for a lens the picture a link
 * shows in place of the live one. A result's is meant for one that is shown
 * in public: until then the picture stays in the repository it was made in.
 * There is one per item; sent again, it replaces what was kept.
 */
export async function putPicture(l: Archipelago, actor: Actor, input: { result: string; data: string; content_type: string }) {
  const result = await l.entity(input.result);
  if (!result || ![...l.registry.drawnWith('figure'), ...l.registry.family('lens')].includes(result.type)) throw new Error(`picture_put: "${input.result}" is not a test result, a note, a file or a lens: nothing whose page shows a picture.`);
  if (!PICTURE_TYPES.includes(input.content_type)) throw new Error(`picture_put: the picture must be one of ${PICTURE_TYPES.join(', ')}, not ${input.content_type}.`);
  const bytes = Buffer.from(input.data, 'base64');
  if (!bytes.length) throw new Error('picture_put: "data" is empty. Send the file as base64.');
  if (bytes.length > PICTURE_MAX) throw new Error(`picture_put: the picture is ${bytes.length} bytes; the most kept is ${PICTURE_MAX}. Make it smaller.`);
  await l.db.query(
    `insert into picture (entity_id, content_type, bytes, size) values ($1, $2, decode($3, 'base64'), $4)
     on conflict (entity_id) do update set content_type = excluded.content_type, bytes = excluded.bytes, size = excluded.size, created_at = now()`,
    [result.id, input.content_type, bytes.toString('base64'), bytes.length],
  );
  await l.record('observations', actorId(actor), [['+', result.id, 'picture', { $blob: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, type: input.content_type }]]);
  await l.log(l.db, { actor: actorId(actor), action: 'picture.stored', target: result.id, reason: `Picture kept for "${result.title}"`, detail: { size: bytes.length, content_type: input.content_type } });
  return { result: result.id, size: bytes.length, content_type: input.content_type };
}

/** The picture kept for a result, as base64, or null when none is. */
export async function getPicture(l: Archipelago, input: { result: string }) {
  const { rows } = await l.db.query<{ content_type: string; data: string; size: number }>(`select content_type, encode(bytes, 'base64') as data, size from picture where entity_id = $1`, [input.result]);
  return rows[0] ? { result: input.result, content_type: rows[0].content_type, size: rows[0].size, data: rows[0].data.replaceAll('\n', '') } : null;
}
