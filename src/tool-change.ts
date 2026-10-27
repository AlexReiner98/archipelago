// The two tools that write facts: change, the one write path, and undo, which takes a change set back. And where an
// agent's change points the owner's screen.

import { z } from 'zod';
import { bodyAfter } from './ops.ts';
import { pictureOf } from './lens-kept.ts';
import { wholeMap } from './outbox.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { type Focus, point as setFocus, took } from './presence.ts';
import { op, source, TITLE_MAX } from './tool-ops.ts';
import type { Tool } from './tools.ts';
import { keep, kept as keptFor, take } from './transient.ts';
import { undo } from './undo.ts';

// Where an agent pointed the screen and the steps it took are kept for any server to read (src/presence.ts).
export async function point(l: Archipelago, actor: Actor, kind: 'show' | 'change', hash: string, note?: string, pane?: string, run?: string): Promise<Focus> {
  const next = { at: Date.now(), hash, actor: actor.name, note };
  const { db } = await wholeMap(l);
  await setFocus(db, l, next);
  await took(db, l, { kind, actor: actor.name, did: note, hash, ...(pane && { pane }), ...(run && { run }) }, true);
  return next;
}

/**
 * Changes an agent sent that were refused, kept for a few minutes so that correcting one op does not mean writing
 * seventy out again. Kept in the workspace's database, so the retry may reach another server than the change did.
 */
const REFUSED_MINUTES = 10;
type Refused = { who: string; input: Record<string, unknown> & { ops: unknown[] } };

export const WRITE_TOOLS: Record<string, Tool> = {
  change: {
    description:
      'The only way to change the map. Send a list of ops (create, update, link, unlink, archive, restore, merge, define_type, forget) with the reason. ' +
      'Creates can carry a ref so later ops in the same change can link to them, and a title or note in the same change can name what it makes: write {ref} and it becomes that item\u2019s id. Give the source the facts came from. ' +
      'To add to a note or change one passage of it, send append or replace on the update, not the whole body again. ' +
      'An update that changes nothing (only the id) says you checked the item and it is still true as written: it records when it was last known true. ' +
      'The change is validated as a whole; depending on policy it is applied at once or held as a proposal for a human. ' +
      'A change that is refused is kept for a few minutes under a name the refusal gives: correct it with retry and fixes (the ops that were wrong, by number) instead of sending it all again. ' +
      'Closing a decision or a hypothesis is held for the human to confirm, unless the workspace applies agents\u2019 changes: then a decision must carry what was chosen (props.outcome) and why (props.rationale), and is put to the owner later (attention, reason to_confirm).',
    input: {
      ops: z.array(op).min(1).optional().describe('What to change. Needed, except with retry.'),
      reason: z.string().min(1).optional().describe('Why this change is being made. Shown in the activity log. Needed, except with retry.'),
      retry: z.string().optional().describe('The name a refused change was kept under (the refusal gives it). The change is sent again as it was, with fixes put in: send only retry and fixes.'),
      fixes: z
        .array(z.object({ at: z.number().int().positive().describe('The op’s number as the refusal counted it, from 1.'), op: op.nullable().describe('The whole op as it should be; null to leave it out.') }))
        .optional()
        .describe('With retry: the ops to put in place of the ones that were wrong.'),
      source: source.optional().describe('Where these facts came from. Individual ops can override it.'),
      authority: z
        .object({
          of: z.enum(['human', 'agent']).describe('"human" when a person told you to make this change or decided what it records; "agent" when it is your own judgment of the work.'),
          basis: z.string().optional().describe('For "human": what they said and where (required). For "agent": what you saw that it rests on.'),
        })
        .optional()
        .describe('On whose authority this change is made. Kept on every event it logs. Left out, it is recorded as your own judgment; settling a decision or hypothesis needs it said.'),
      hold: z.boolean().optional().describe('true to have this change wait for the human even where agents\u2019 changes are applied as made: for something you want looked at before it takes effect.'),
      drawing: z.string().optional().describe('Sent by the page alone: the style whose code asked for this change, as the person looking.'),
    },
    run: async (l, actor, { retry, fixes, ...given }) => {
      // Whose it is: the token's, not the name a session gives itself, which it may leave out the second time.
      const who = `${l.workspace}:${actor.token ?? ''}`;
      let input = given;
      if (retry) {
        const kept = await keptFor<Refused>((await wholeMap(l)).db, `refused:${retry}`);
        if (!kept || kept.who !== who) throw new Error(`No refused change is kept as "${retry}": one is kept for ${REFUSED_MINUTES} minutes. Send the change whole.`);
        const ops = [...kept.input.ops];
        for (const fix of fixes ?? []) {
          if (fix.at > ops.length) throw new Error(`Change rejected:\n- fixes: the change kept as "${retry}" has ${ops.length} ops, so there is no op ${fix.at}.`);
          ops[fix.at - 1] = fix.op;
        }
        // What is said again (a reason, an authority) stands in for what was kept.
        input = { ...kept.input, ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)), ops: ops.filter(Boolean) };
      }
      if (!input.ops?.length) throw new Error('A change needs ops, or retry with the name a refused change was kept under.');
      if (!input.reason) throw new Error('Every change needs a reason.');
      let result;
      try {
        // Agents write sentences where a name is wanted, and every row and box then has to cut them. Held to a length here,
        // where an agent names things; a person may name a thing as they like, and an undo puts back what was there.
        if (actor.kind === 'agent') {
          const long = (input.ops as { op: string; title?: string }[]).flatMap((o, i) =>
            (o.op === 'create' || o.op === 'update') && o.title && o.title.trim().length > TITLE_MAX
              ? [`op ${i + 1} (${o.op}): the title is ${o.title.trim().length} characters. A title is a name, not a sentence: ${TITLE_MAX} at most. Name the thing in a few words and put the rest in its note.`]
              : [],
          );
          // A note every session adds to (a handoff) is read whole by every session after it. Its type may hold it to a length
          // an agent can only keep by rewriting it (note_max); one that is already over may always be made shorter.
          for (const [i, o] of (input.ops as { op: string; type?: string; id?: string; body?: string; append?: string; replace?: { find: string; with: string } }[]).entries()) {
            let before = 0;
            let after = 0;
            let type = o.op === 'create' ? l.registry.type(o.type ?? '') : undefined;
            if (o.op === 'create') after = o.body?.length ?? 0;
            else if (o.op === 'update' && (o.body !== undefined || o.append !== undefined || o.replace)) {
              const target = await l.entity(o.id!);
              if (!target || !(type = l.registry.type(target.type))) continue;
              before = target.body.length;
              try {
                after = bodyAfter(target.body, o as Parameters<typeof bodyAfter>[1]).length;
              } catch {
                continue; // what is wrong with the op is said by the change itself
              }
            }
            if (type?.noteMax && after > type.noteMax.chars && after > before) long.push(`op ${i + 1} (${o.op}): the ${type.title.toLowerCase()} note would be ${after} characters: ${type.noteMax.chars} at most.${type.noteMax.say ? ` ${type.noteMax.say}` : ''}`);
          }
          if (long.length) throw new Error(`Change rejected:\n- ${long.join('\n- ')}`);
        }
        result = await l.change(actor, input);
      } catch (err) {
        const message = (err as Error).message;
        if (actor.kind !== 'agent' || !message.startsWith('Change rejected')) throw err;
        // A refused change is kept, so that what is wrong with one op is all that has to be sent again.
        const name = retry ?? `k_${Math.random().toString(36).slice(2, 10)}`;
        await keep((await wholeMap(l)).db, `refused:${name}`, { who, input } satisfies Refused, REFUSED_MINUTES * 60_000);
        throw new Error(
          `${message}\nNothing was changed. The change is kept for ${REFUSED_MINUTES} minutes as "${name}": to correct it, send change with only retry: "${name}" and fixes: [{ at: <the op’s number>, op: <the whole op as it should be> }]. Every other op is sent as it was.`,
        );
      }
      if (retry) await take((await wholeMap(l)).db, `refused:${retry}`);
      // A question an agent settled is not left for the human to come across: it is put to them by the next session
      // they talk to (attention, reason to_confirm, and the handoff), all of them in one list, not a notification for each.
      // The human's screen follows an agent's change: to Review when it waits
      // there, otherwise to the first thing it made or touched.
      if (actor.kind === 'agent') {
        const made = 'created' in result ? Object.values(result.created as Record<string, string>)[0] : undefined;
        const touched = (input.ops as { id?: string }[]).find((o) => o.id)?.id;
        const target = made ?? touched;
        // A lens or a style that was changed is seen in the picture it changes, not on its own page.
        const picture = result.status !== 'proposed' && target ? await pictureOf(l, target) : undefined;
        await point(l, actor, 'change', result.status === 'proposed' ? 'review' : (picture ?? (target ? `e/${target}` : 'activity')), input.reason).catch(() => {});
      }
      return result;
    },
  },
  undo: {
    description:
      'Reverse one change set (its id is on every event it logged) by applying the opposite as a new change: created items are archived, edits put back, links removed or restored. An edit changed again since is left alone and reported. Subject to the same policy as any change.',
    input: { changeset: z.string() },
    run: async (l, actor, input) => undo(l, actor, input),
  },
};
