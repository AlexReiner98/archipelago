// Undo: reverse one change set by applying its opposite as a new change.
// Nothing is erased; the log keeps both. An edit that has been changed again
// since is left alone and reported, not overwritten.

import type { Actor, Entity, Archipelago, Op, UpdateOp } from './pelago.ts';

interface LoggedChange {
  seq: number;
  action: string;
  target_id: string | null;
  reason: string;
  detail: Record<string, any>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function undo(l: Archipelago, actor: Actor, input: { changeset: string }) {
  const { rows: events } = await l.db.query<LoggedChange>(
    `select seq::int as seq, action, target_id, reason, detail from event where changeset = $1 and origin = 'pelago' order by seq desc`,
    [input.changeset],
  );
  if (!events.length) throw new Error(`No change set "${input.changeset}"`);
  const { rows: already } = await l.db.query(`select 1 from event where action = 'changeset.undo' and detail->>'undoes' = $1`, [input.changeset]);
  if (already.length) throw new Error(`Change set ${input.changeset} has already been undone`);

  const ops: Op[] = [];
  const skipped: string[] = [];
  const title = async (id: string | null) => (id ? ((await l.entity(id))?.title ?? id) : '?');

  // Newest first, so a create is undone after the links that hang off it.
  for (const ev of events) {
    const d = ev.detail ?? {};
    switch (ev.action) {
      case 'entity.create': {
        const entity = ev.target_id ? await l.entity(ev.target_id) : undefined;
        if (entity && !entity.archived_at) ops.push({ op: 'archive', id: entity.id });
        break;
      }
      case 'entity.update': {
        const entity = ev.target_id ? await l.entity(ev.target_id) : undefined;
        if (!entity) break;
        const op: UpdateOp = { op: 'update', id: entity.id };
        const props: Record<string, unknown> = {};
        for (const [key, change] of Object.entries(d.changes ?? {}) as [string, { from: unknown; to: unknown }][]) {
          const isProp = key.startsWith('props.');
          const field = isProp ? key.slice(6) : key;
          const current = isProp ? entity.props[field] : entity[field as keyof Entity];
          if (typeof change.from === 'string' && change.from.endsWith('…') && change.from.length === 201) {
            skipped.push(`"${entity.title}": the earlier value of ${field} was not kept in full, so it cannot be restored`);
          } else if (!same(current, change.to)) {
            skipped.push(`"${entity.title}": ${field} has changed again since, so it was left as it is`);
          } else if (isProp) {
            props[field] = change.from ?? null;
          } else {
            (op as unknown as Record<string, unknown>)[field] = change.from;
          }
        }
        if (Object.keys(props).length) op.props = props;
        if (Object.keys(op).length > 2) ops.push(op);
        break;
      }
      case 'relation.link': {
        const { rows } = await l.db.query(`select 1 from relation where id = $1 and valid_to is null`, [d.relation]);
        if (rows.length) ops.push({ op: 'unlink', relation: d.relation });
        break;
      }
      case 'relation.unlink': {
        const { rows } = await l.db.query<{ type: string; from_id: string; to_id: string; props: Record<string, unknown> }>(`select type, from_id, to_id, props from relation where id = $1`, [d.relation]);
        if (rows[0]) ops.push({ op: 'link', type: rows[0].type, from: rows[0].from_id, to: rows[0].to_id, props: rows[0].props });
        break;
      }
      case 'entity.archive': {
        const entity = ev.target_id ? await l.entity(ev.target_id) : undefined;
        if (entity?.archived_at) ops.push({ op: 'restore', id: entity.id });
        break;
      }
      case 'entity.merge':
        skipped.push(`merging "${d.absorbed?.title}" into "${await title(ev.target_id)}" cannot be undone automatically: its relations were moved`);
        break;
      case 'type.define':
        skipped.push(`defining type ${d.type?.id} cannot be undone here: remove it from the local pack file`);
        break;
    }
  }
  if (!ops.length) throw new Error(`Nothing to undo.${skipped.length ? `\n- ${skipped.join('\n- ')}` : ' Everything in it has already been reversed or replaced.'}`);

  const original = events.find((e) => e.reason && e.reason !== 'Source of this change')?.reason ?? input.changeset;
  const result = await l.change(actor, { ops, reason: `Undo: ${original}` });
  // An agent's undo is only a proposal; mark it undone when it has really happened.
  if (result.status === 'applied') {
    await l.log(l.db, { actor: `${actor.kind}:${actor.name}`, action: 'changeset.undo', changeset: result.changeset, reason: `Undo: ${original}`, detail: { undoes: input.changeset, skipped } });
  }
  return { ...result, undoes: input.changeset, reversed: ops.length, skipped };
}
