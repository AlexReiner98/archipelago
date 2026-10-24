// A held change decided (docs/log.md, section 3). Its record in the pending stream says what it asked (ops), what it
// would have done (facts) and on which position of the map (base). Approving it appends it to the fact stream: as it
// was when nothing it sets has moved since, planned again when something has, and refused as overtaken when a field it
// sets outright has since been set to something else. Rejecting it, or finding it moot, appends an entry with no facts.

import type { Actor, Archipelago, Op, Proposal } from './pelago.ts';
import { append, entry, factAt, type Decision } from './log.ts';
import { ITEM_COLUMNS } from './facts.ts';
import { projectDecision, stamp } from './replay.ts';
import { dropExcepted } from './ops.ts';
import { overtaken } from './merge.ts';
import { newId, type Q } from './db.ts';

const UNSAID = new Map(ITEM_COLUMNS.map(([, field, unsaid]) => [field, unsaid]));
const said = (field: string, v: unknown) => JSON.stringify(v ?? UNSAID.get(field) ?? null);
const show = (field: string, v: unknown) => {
  const text = said(field, v);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

/**
 * Each field an update sets outright that someone has set since the base, to a value other than the one it asks for:
 * what was there, what is there now, and what it would make it. A note added to or a passage replaced is planned on
 * the note as it is now, and a link only if missing is checked again by the write path, so neither is here.
 */
export async function overtakenFields(l: Archipelago, base: number, ops: Op[]): Promise<string[]> {
  const problems: string[] = [];
  for (const op of ops) {
    if (op.op !== 'update') continue;
    const set: [string, unknown][] = (['title', 'status', 'owner', 'visibility', 'confidence', 'body'] as const).filter((f) => op[f] !== undefined).map((f) => [f, f === 'title' ? op.title!.trim() : op[f]]);
    set.push(...Object.entries(op.props ?? {}));
    for (const [field, proposed] of set) {
      const now = await factAt(l.db, op.id, field);
      if (!now || now.pos <= base || said(field, now.op === '+' ? now.value : null) === said(field, proposed)) continue;
      const then = await factAt(l.db, op.id, field, base);
      const title = (await l.entity(op.id))?.title ?? op.id;
      problems.push(`"${title}": ${field} was ${show(field, then?.op === '+' ? then.value : null)} when this was held, is ${show(field, now.op === '+' ? now.value : null)} now, and this would make it ${show(field, proposed)}`);
    }
  }
  return problems;
}

/**
 * An entry with no facts, for a held change that was declined, or made moot by a change that did what it asked; the
 * queue's row says so from it. Only while it is pending: false when something else decided it first.
 */
export async function rejection(tx: Q, ws: string, proposal: string, d: { outcome: 'rejected' | 'superseded'; actor: string; by: string; reason: string }): Promise<boolean> {
  await stamp(tx); // the fact stream's lock: one decision at a time
  if ((await tx.query(`select 1 from proposal where id = $1 and status = 'pending'`, [proposal])).rows.length === 0) return false;
  const record = await entry(tx, proposal);
  const held = record?.held_by as { rule: string; pack: string } | null | undefined;
  const rule: Decision = { outcome: d.outcome, held_by: held ? { rule: held.rule, pack: held.pack } : null, proposal, proposal_hash: record?.hash ?? '', by: d.by };
  await projectDecision(tx, await append(tx, ws, 'facts', { id: newId('c'), actor: { id: d.actor }, authority: null, rule, reason: d.reason, source: null, action: null, undoes: null, keys: [] }, []));
  return true;
}

/** Approve or reject a held change. `ops`, when given, is the reviewer's corrected version, planned on the map as it is. */
export async function decideProposal(l: Archipelago, actor: Actor, input: { proposal: string; approve: boolean; except?: string[]; note?: string; ops?: Op[] }) {
  if (actor.kind !== 'human') throw new Error('Only a human can approve or reject proposals.');
  const { rows } = await l.db.query<Proposal>(`select * from proposal where id = $1`, [input.proposal]);
  const proposal = rows[0];
  if (!proposal) throw new Error(`No proposal "${input.proposal}"`);
  if (proposal.status !== 'pending') throw new Error(`Proposal ${proposal.id} is already ${proposal.status}`);
  const me = `${actor.kind}:${actor.name}`;
  const record = await entry(l.db, proposal.id);

  let result: Awaited<ReturnType<Archipelago['apply']>> | undefined;
  if (input.approve) {
    const revised = Boolean(input.ops);
    const ops = input.ops ?? proposal.ops;
    if (!revised && record) {
      const problems = await overtakenFields(l, record.base as number, dropExcepted(ops, input.except ?? []));
      if (problems.length) throw overtaken(proposal.id, new Error(`Change rejected:\n- ${problems.join('\n- ')}`));
    }
    const held = record?.held_by as { rule: string; pack: string } | null | undefined;
    result = await l.apply(
      proposal.actor,
      { ops, reason: proposal.reason, source: proposal.source ?? undefined, action: (record?.action as string | null) ?? undefined, undoes: (record?.undoes as string | null) ?? undefined },
      // Held and then applied by a human: it rests on that human, whatever the agent thought it rested on.
      {
        except: input.except, approvedBy: me, revised, authority: { of: 'human', who: me },
        // The ids it would have made when it was held: with nothing moved since, the facts it appends are the ones it showed.
        ids: revised ? undefined : (record?.ids as Record<string, string> | undefined),
        rule: { outcome: 'approved', held_by: held ? { rule: held.rule, pack: held.pack } : null, proposal: proposal.id, proposal_hash: record?.hash ?? '', by: me, revised, except: input.except ?? [], ...(input.note && { note: input.note }) },
      },
    ).catch((err: Error) => { throw err.message.startsWith('Change rejected') ? overtaken(proposal.id, err) : err; });
  }
  // The queue's row is the projection of what was appended: approved by the change set, declined by its own entry.
  const status = input.approve ? 'approved' : 'rejected';
  if (!input.approve) await l.db.transaction((tx) => rejection(tx, l.workspace, proposal.id, { outcome: 'rejected', actor: me, by: me, reason: input.note ?? '' }));
  await l.log(l.db, {
    actor: me,
    action: `proposal.${input.approve ? 'approve' : 'reject'}`,
    changeset: result?.changeset,
    reason: input.note ?? '',
    detail: { proposal: proposal.id, proposed_by: proposal.actor, except: input.except ?? [], revised: Boolean(input.ops) },
  });
  return { ...result, proposal: proposal.id, status };
}

/**
 * A held change that asks only for what is now so (each thing it would settle already has that status) has been
 * overtaken: it leaves the queue as superseded, and the log says by which change. Nobody decided it, so it is neither
 * applied nor declined.
 */
export async function supersede(l: Archipelago, changeset: string): Promise<void> {
  const { rows } = await l.db.query<Proposal>(`select * from proposal where status = 'pending'`);
  for (const p of rows) {
    let moot = p.ops.length > 0;
    for (const op of p.ops) {
      if (op.op !== 'update' || !op.status || Object.keys(op).some((key) => !['op', 'id', 'status', 'props'].includes(key))) moot = false;
      else moot = (await l.entity(op.id))?.status === op.status;
      if (!moot) break;
    }
    if (!moot) continue;
    const done = await l.db.transaction((tx) => rejection(tx, l.workspace, p.id, { outcome: 'superseded', actor: 'system', by: changeset, reason: p.reason }));
    if (done) await l.log(l.db, { actor: 'agent:pelago', action: 'proposal.supersede', reason: p.reason, detail: { proposal: p.id, proposed_by: p.actor, by: changeset } });
  }
}
