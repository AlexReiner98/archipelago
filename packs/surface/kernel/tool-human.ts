// The human's own tools, for the CLI and the web UI: never offered to agents. What the page follows of the log,
// merging a backup in, starting a session, the mark that a person looked, deciding a held change.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseBackup, parseVault, readable } from '../../log/kernel/backup.ts';
import { callAs } from '../../loader/kernel/kernel-context.ts';
import { pressGrant } from '../../loader/kernel/part-calls.ts';
import { launch } from './launcher.ts';
import { bypassingRls } from '../../identity/kernel/outbox.ts';
import type { TypeDef } from '../../loader/kernel/packs.ts';
import { actorId } from '../../write/kernel/pelago.ts';
import { whose } from './tool-change.ts';
import { triesAfter } from './tool-preview.ts';
import { UI_DIRS } from './ui-files.ts';
import { backupNow, needAdmin } from './tool-config.ts';
import { op } from './tool-ops.ts';
import type { Tool } from './tools.ts';
import { eventsAfter, factsAfter, factsUpTo, HELD_MOST, headPos, ISLANDS_MOST, madeAfter } from '../../log/kernel/tail.ts';
import { typeItemsIn, typesTaken } from '../../loader/kernel/type-items.ts';
import { movesAgain, syncTypes } from '../../loader/kernel/typetable.ts';

/** Moves when any file of the web UI is saved (the projector it runs too), so an open page knows to load itself again. */
const uiStamp = () => Math.max(...UI_DIRS.flatMap((dir) => readdirSync(dir).map((file) => statSync(join(dir, file)).mtimeMs)), statSync(join(import.meta.dirname, '..', '..', 'log', 'kernel', 'project.ts')).mtimeMs);

export const HUMAN_TOOLS: Record<string, Tool> = {
  tail: {
    description:
      'What the page follows: the facts after `after` (a position in the fact stream) on the `ids` it holds and on what lives on the `islands` its views touch, as the viewer may see them, for it to project (packs/log/kernel/tail.ts); ' +
      'which of them other events touched after `seq` (an event number); and the review queue, the agents and the UI as they stand. Without `after`, only where things stand.',
    humanOnly: true,
    input: {
      after: z.number().int().nonnegative().optional().describe('The `pos` of the last answer: the facts after it are said.'),
      seq: z.number().int().nonnegative().optional().describe('The `seq` of the last answer: what other events after it touched is said.'),
      ids: z.array(z.string()).max(HELD_MOST).optional().describe('The items and links the page holds. Facts are read only on these, the links made touching them, and what those bring.'),
      islands: z.array(z.string()).max(ISLANDS_MOST).optional().describe('The islands the page’s views touch, by id: facts on what lives on them are read too, so a view hears what may change what its query finds.'),
      was: z.number().int().nonnegative().optional().describe('A position: every fact said of the `ids` up to it, for the page to fold into what they were then (`was`), where its reader last looked.'),
      page: z
        .object({ page: z.string().max(40), on: z.boolean(), where: z.string().max(2000).optional(), tab: z.object({ chat: z.string().max(40), own: z.boolean() }).optional(), lands: z.array(z.string().max(60)).max(24).optional() })
        .optional()
        .describe('The page asking, whether a show can land in it, and where it stands (its address after "#/"): an agent’s show says how many pages can take it, and an agent is told what the owner is looking at, and whether its show lands in the tab in sight (lands: the sessions whose shows go there).'),
      tries: z.number().int().nonnegative().optional().describe('The `at` of the last tries heard (0 for none): answered with only the tries of code the person looking sent (packs/surface/kernel/tool-preview.ts), once they move after it.'),
      wait: z.number().int().min(0).max(25).optional().describe('With tries: seconds to wait for them to move.'),
    },
    run: async (l, _actor, { after, seq, ids = [], islands = [], page, was, tries, wait }) => {
      // The tries a page waits for, apart from the rest: one call held open until they move.
      if (tries !== undefined) return { tries: await triesAfter(l, tries, wait) };
      // The page says it is open and where it stands, and is given what its screen shows (the presence pack's act.report.screen).
      const screen = callAs<{ told: number } & Record<string, unknown>>(l, 'act.report.screen', { whose: whose(l), ...(page && { page }) });
      const [queue, { told, ...seen }, pos] = await Promise.all([l.db.query<{ n: number }>(`select count(*)::int as n from proposal where status = 'pending' -- index proposal_status`), screen, headPos(l.db)]);
      const stand = { queue: `${queue.rows[0].n}.${told}`, ...seen, ui: uiStamp() };
      const events = await eventsAfter(l.db, { seq, ids });
      const then = was === undefined ? {} : { was: await factsUpTo(l.db, { pos: was, ids }) };
      if (after === undefined) return { ...stand, pos, seq: events.seq, ...then };
      // Holding nothing, the page is still told how many items were made: a view of a type on an empty map asks again.
      const facts = ids.length ? await factsAfter(l.db, { after, ids, islands }) : { pos, entries: [], gone: [], made: await madeAfter(l.db, after, pos) };
      return { ...stand, ...facts, seq: events.seq, events: events.ids, ...then };
    },
  },
  import_backup: {
    description:
      'Merge a backup file into this workspace, matching by id. Nothing is deleted: what the file has and this map lacks is added; an item on both sides keeps whichever was edited later; ' +
      'a link ended or a proposal decided on either side is ended or decided; the file’s history is added to the activity log. Tokens and settings are not touched, and sessions still open in the file are left out. ' +
      'Without `apply` nothing changes and the answer says what would. With it, the server backs up first. Admins only.' +
      ' If the file\u2019s owner and this workspace\u2019s are different people, the answer names both as `owners`; see `same_owner`.',
    humanOnly: true,
    input: {
      backup: z.string().min(1).describe('The backup file (.json.gz) in base64.'),
      vault: z.string().optional().describe('The backup of the key vault taken with it (.json.gz) in base64: a sealed file is read with it.'),
      apply: z.boolean().optional().describe('Do it. Leave out to see what it would do.'),
      same_owner: z
        .boolean()
        .optional()
        .describe('When the answer names two `owners`: they are one person. This workspace\u2019s owner becomes the person in the file, with their tokens and everything private to them, so later imports of the same map line up.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'import a backup');
      const whole = await bypassingRls(l); // everything in the file goes in, whoever it is private to: this is the map as a whole, as a backup is
      const file = await readable(whole.db, { ...parseBackup(Buffer.from(input.backup, 'base64')), ...(input.vault && { vault: parseVault(Buffer.from(input.vault, 'base64')) }) });
      const defined = ((file.local_pack as { types?: TypeDef[] } | null)?.types ?? []).filter((t) => !whole.registry.types.has(t.id));
      // Its own types, kept as type items, are taken in with it.
      const kept = typeItemsIn(file.tables?.entity ?? []);
      const named = kept.flatMap((i) => (typeof i.props.name === 'string' && !i.props.preset && !whole.registry.types.has(i.props.name) && !whole.registry.relations.has(i.props.name) ? [i.props.name] : []));
      const known = new Set([...whole.registry.types.keys(), ...defined.map((t) => t.id), ...named]);
      const unknown = [...new Set((file.tables?.entity ?? []).map((e) => e.type as string))].filter((t) => !known.has(t));
      if (unknown.length) throw new Error(`The file uses types this server does not have: ${unknown.join(', ')}. Install the pack that defines them first.`);
      const backUp = backupNow();
      const backed_up_first = input.apply ? Boolean(backUp && (await backUp())) : undefined;
      // The file's own types first, in the order they were defined: its entities need them.
      if (input.apply) for (const def of defined) await whole.registry.defineLocal(def);
      if (input.apply && named.length) await typesTaken(whole, kept);
      // A map brought from elsewhere has its own person for its owner. If that is
      // who owns this workspace too, the two can be made one.
      const theirs = file.tables?.setting?.find((s) => s.key === 'me')?.value as string | undefined;
      const mine = await whole.setting<string>('me');
      const their = theirs && mine && theirs !== mine ? file.tables.entity?.find((e) => e.id === theirs) : undefined;
      const my = their ? await whole.entity(mine!) : undefined;
      const owners = their && my && !my.archived_at ? { here: { id: my.id, title: my.title }, file: { id: theirs!, title: their.title as string }, made_one: false } : undefined;
      // Merged by the backup pack, on the whole map (act.capture.backup_merge).
      const report = await callAs<{ events: { first_seq: number; last_seq: number }; entities: unknown; relations: unknown } & Record<string, unknown>>(whole, 'act.capture.backup_merge', { dump: file, session_types: whole.registry.family('run'), apply: input.apply });
      // What the file brought may be in the shapes from before the migrations a workspace runs once: they run again.
      if (input.apply) (await movesAgain(whole), await syncTypes(whole));
      if (input.apply && named.length) await typesTaken(whole);
      if (input.apply && input.same_owner && owners) {
        await whole.apply(actorId(actor), { ops: [{ op: 'merge', keep: owners.file.id, drop: owners.here.id }], reason: 'The owner here and the owner in the imported backup are one person' });
        // Who they are goes with them: their tokens, what is private to them, and owning the workspace.
        await whole.db.transaction(async (tx) => {
          await tx.query(`update token set entity_id = $1 where entity_id = $2`, [owners.file.id, owners.here.id]);
          for (const table of ['entity', 'proposal']) await tx.query(`update ${table} set private_to = $1 where private_to = $2`, [owners.file.id, owners.here.id]);
          await tx.query(`update setting set value = to_jsonb($1::text) where key = 'me'`, [owners.file.id]);
        });
        owners.made_one = true;
      }
      if (input.apply) {
        await whole.log(whole.db, {
          actor: actorId(actor),
          action: 'workspace.import',
          reason: `Merged the backup of "${file.workspace?.name}" taken ${file.taken}`,
          detail: { from: file.workspace, taken: file.taken, first_seq: report.events.first_seq, last_seq: report.events.last_seq, entities: report.entities, relations: report.relations },
        });
      }
      return { ...report, owners, types_added: [...defined.map((t) => t.id), ...named], backed_up_first };
    },
  },
  launch: {
    description:
      'Start a headless Claude Code session on a task, in the task\u2019s repository, with its brief as the prompt, on this machine. The session is registered first, so it holds any exclusive resource the task needs, or the launch is refused.',
    humanOnly: true,
    input: {
      task: z.string(),
      mode: z.enum(['plan', 'acceptEdits']).optional().describe('plan (default): read and investigate only. acceptEdits: may edit files in the repository.'),
      instructions: z.string().optional().describe('Anything to add to the brief.'),
    },
    run: async (l, actor, input) => launch(l, actor, input),
  },
  seen: {
    description: 'Record that you have looked at what agents changed, up to an event. It permits nothing: it is the mark that a human saw.',
    humanOnly: true,
    input: { upto: z.number().int().nonnegative().describe('The seq of the newest event looked at.') },
    run: async (l, actor, input) => {
      await l.record('settings', actorId(actor), [['+', actorId(actor), 'changes.seen', input.upto]]);
      return { seen_upto: input.upto };
    },
  },
  press_grant: {
    description:
      'A grant for an admin’s press on a part of the page, minted the moment the person presses it (decision e_ssrawn4v): the one admin action the part sends just after goes with it, once. ' +
      'Only for a person whose session is an admin; the page asks it, and keeps the grant from the part.',
    humanOnly: true,
    input: {
      part: z.object({ id: z.string().max(200), hash: z.string().max(64), island: z.string().max(40).optional() }).describe('The part pressed: its id, the hash of its code, and the island it is drawn on, if any.'),
    },
    run: async (l, actor, input: { part: { id: string; hash: string; island?: string } }) => ({ grant: await pressGrant(l, actor, input.part.island, input.part) }),
  },
  decide: {
    description: 'Apply a held change (approve: true) or decline it, with a note for whoever made it.',
    humanOnly: true,
    input: {
      proposal: z.string(),
      approve: z.boolean(),
      except: z.array(z.string()).optional().describe('Refs or "#n" op numbers to leave out when approving.'),
      note: z.string().optional(),
      ops: z.array(op).min(1).optional().describe('The reviewer’s corrected ops, replacing the proposed ones. Same order, so "#n" still lines up.'),
    },
    run: async (l, actor, input) => l.decide(actor, input),
  },
  init: {
    description: 'Set the workspace owner, creating their person item if needed.',
    humanOnly: true,
    input: { name: z.string().min(1), email: z.string().optional() },
    run: async (l, actor, input) => {
      const result = await l.init(actor, input);
      // From now on this token is that person: their view, their private things.
      if (actor.token) await l.db.query(`update token set entity_id = $2 where id = $1 and entity_id is null`, [actor.token, result.me]);
      return result;
    },
  },
};
