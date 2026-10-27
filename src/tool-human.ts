// The human's own tools, for the CLI and the web UI: never offered to agents. What the page follows of the log,
// merging a backup in, starting a session, GitHub's secret, the mark that a person looked, deciding a held change.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { merge, parseBackup, parseVault, readable } from './backup.ts';
import { githubStatus, newGithubSecret } from './github.ts';
import { launch } from './launcher.ts';
import { notifyWorkspace, wholeMap } from './outbox.ts';
import type { TypeDef } from './packs.ts';
import { actorId } from './pelago.ts';
import { drew } from './looks.ts';
import { looked, presence } from './presence.ts';
import { backupNow, needAdmin } from './tool-config.ts';
import { op } from './tool-ops.ts';
import type { Tool } from './tools.ts';
import { eventsAfter, factsAfter, HELD_MOST, headPos } from './tail.ts';

/** Moves when any file of the web UI is saved (the projector it runs too), so an open page knows to load itself again. */
const UI_DIR = join(import.meta.dirname, '..', 'ui');
const uiStamp = () => Math.max(...readdirSync(UI_DIR).map((file) => statSync(join(UI_DIR, file)).mtimeMs), statSync(join(import.meta.dirname, 'project.ts')).mtimeMs);

export const HUMAN_TOOLS: Record<string, Tool> = {
  tail: {
    description:
      'What the page follows: the facts after `after` (a position in the fact stream) on the `ids` it holds, as the viewer may see them, for it to project (src/tail.ts); ' +
      'which of them other events touched after `seq` (an event number); and the review queue, the agents and the UI as they stand. Without `after`, only where things stand.',
    humanOnly: true,
    input: {
      after: z.number().int().nonnegative().optional().describe('The `pos` of the last answer: the facts after it are said.'),
      seq: z.number().int().nonnegative().optional().describe('The `seq` of the last answer: what other events after it touched is said.'),
      ids: z.array(z.string()).max(HELD_MOST).optional().describe('The items and links the page holds. Facts are read only on these, the links made touching them, and what those bring.'),
      page: z
        .object({ page: z.string().max(40), on: z.boolean(), muted: z.array(z.string().max(200)).max(50) })
        .optional()
        .describe('The page asking, and what it follows: whether a show moves it, and whose steps it leaves out. An agent’s show says how many pages follow it.'),
      drew: z
        .object({ look: z.string().max(20), data: z.string().max(1_400_000).optional(), content_type: z.string().max(20).optional(), width: z.number().optional(), height: z.number().optional(), why: z.string().max(200).optional() })
        .optional()
        .describe('What the page drew where a show that asked for a look brought it: the picture as base64, or why there is none (src/looks.ts).'),
    },
    run: async (l, _actor, { after, seq, ids = [], page, drew: said }) => {
      if (page) await looked((await wholeMap(l)).db, l, page);
      // A picture the server will not keep is let go: the page's following goes on either way.
      if (said) await drew((await wholeMap(l)).db, l, said).catch(() => {});
      const [queue, { told, ...seen }, pos] = await Promise.all([l.db.query<{ n: number }>(`select count(*)::int as n from proposal where status = 'pending' -- index proposal_status`), presence((await wholeMap(l)).db, l), headPos(l.db)]);
      const stand = { queue: `${queue.rows[0].n}.${told}`, ...seen, ui: uiStamp() };
      const events = await eventsAfter(l.db, { seq, ids });
      if (after === undefined) return { ...stand, pos, seq: events.seq };
      const facts = ids.length ? await factsAfter(l.db, { after, ids }) : { pos, entries: [], gone: [], made: 0 };
      return { ...stand, ...facts, seq: events.seq, events: events.ids };
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
      const whole = await wholeMap(l); // everything in the file goes in, whoever it is private to: this is the map as a whole, as a backup is
      const file = await readable(whole.db, { ...parseBackup(Buffer.from(input.backup, 'base64')), ...(input.vault && { vault: parseVault(Buffer.from(input.vault, 'base64')) }) });
      const defined = ((file.local_pack as { types?: TypeDef[] } | null)?.types ?? []).filter((t) => !whole.registry.types.has(t.id));
      const known = new Set([...whole.registry.types.keys(), ...defined.map((t) => t.id)]);
      const unknown = [...new Set((file.tables?.entity ?? []).map((e) => e.type as string))].filter((t) => !known.has(t));
      if (unknown.length) throw new Error(`The file uses types this server does not have: ${unknown.join(', ')}. Install the pack that defines them first.`);
      const backUp = backupNow();
      const backed_up_first = input.apply ? Boolean(backUp && (await backUp())) : undefined;
      // The file's own types first, in the order they were defined: its entities need them.
      if (input.apply) for (const def of defined) await whole.registry.defineLocal(def);
      // A map brought from elsewhere has its own person for its owner. If that is
      // who owns this workspace too, the two can be made one.
      const theirs = file.tables?.setting?.find((s) => s.key === 'me')?.value as string | undefined;
      const mine = await whole.setting<string>('me');
      const their = theirs && mine && theirs !== mine ? file.tables.entity?.find((e) => e.id === theirs) : undefined;
      const my = their ? await whole.entity(mine!) : undefined;
      const owners = their && my && !my.archived_at ? { here: { id: my.id, title: my.title }, file: { id: theirs!, title: their.title as string }, made_one: false } : undefined;
      const report = await merge(whole.db, file, { workspace: l.workspace, sessionTypes: whole.registry.family('sys.run'), apply: input.apply });
      if (input.apply && input.same_owner && owners) {
        await whole.apply(actorId(actor), { ops: [{ op: 'merge', keep: owners.file.id, drop: owners.here.id }], reason: 'The owner here and the owner in the imported backup are one person' });
        // Who they are goes with them: their tokens, what is private to them, and owning the workspace.
        await whole.db.transaction(async (tx) => {
          await tx.query(`update token set entity_id = $1 where entity_id = $2`, [owners.file.id, owners.here.id]);
          for (const table of ['entity', 'proposal', 'event']) await tx.query(`update ${table} set private_to = $1 where private_to = $2`, [owners.file.id, owners.here.id]);
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
      return { ...report, owners, types_added: defined.map((t) => t.id), backed_up_first };
    },
  },
  launch: {
    description:
      'Start a headless Claude Code session on a task, in the task\u2019s repository, with its brief as the prompt. The session is registered first, so it holds any exclusive resource the task needs, or the launch is refused.',
    humanOnly: true,
    input: {
      task: z.string(),
      mode: z.enum(['plan', 'acceptEdits']).optional().describe('plan (default): read and investigate only. acceptEdits: may edit files in the repository.'),
      instructions: z.string().optional().describe('Anything to add to the brief.'),
    },
    run: async (l, actor, input) => launch(l, actor, input),
  },
  notify_workspace: {
    description: 'Send a notification to another workspace on this server. It arrives only if that workspace\u2019s admin has chosen to accept notifications from this one.',
    humanOnly: true,
    input: {
      workspace: z.string().describe('The other workspace\u2019s id.'),
      title: z.string().min(1),
      body: z.string().optional(),
      level: z.enum(['info', 'warning', 'urgent']).optional(),
    },
    run: async (l, actor, input) => notifyWorkspace(l, actor, input),
  },
  github: {
    description:
      'This workspace and GitHub: whether pushes are being received, the address GitHub is to send them to, and for each repository in the map its GitHub name and when it was last pushed to. ' +
      'With new_secret, makes (or replaces) the secret GitHub signs with and shows it once; put it and the address into the repository\u2019s webhook settings, content type application/json, push events only. Admins only for that.',
    humanOnly: true,
    input: { new_secret: z.boolean().optional() },
    run: async (l, actor, input) => {
      if (!input.new_secret) return githubStatus(l);
      needAdmin(actor, 'connect GitHub');
      const whole = await wholeMap(l);
      const secret = await newGithubSecret(whole);
      return { ...(await githubStatus(whole)), secret, note: 'Keep this secret now: it is shown once. A secret made earlier no longer works.' };
    },
  },
  seen: {
    description: 'Record that you have looked at what agents changed, up to an event. It permits nothing: it is the mark that a human saw.',
    humanOnly: true,
    input: { upto: z.number().int().nonnegative().describe('The seq of the newest event looked at.') },
    run: async (l, actor, input) => {
      await l.log(l.db, { actor: actorId(actor), action: 'changes.seen', reason: 'Looked at what agents changed', detail: { upto: input.upto } });
      await l.record('settings', actorId(actor), [['+', actorId(actor), 'changes.seen', input.upto]]);
      return { seen_upto: input.upto };
    },
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
