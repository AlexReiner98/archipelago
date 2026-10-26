// The kernel's actions: what an agent does besides changing facts, each one of the six verbs (KERNEL_VERBS in
// src/declared.ts): a session registered, reporting in and ending, the story it tells, a resource taken and given
// back, things put where they stand on a canvas, the owner's screen pointed, a notification sent, the owner's word
// recorded, a backup taken.

import { z } from 'zod';
import { askView } from './askview.ts';
import { putPlaces } from './canvas-places.ts';
import { importAudit } from './audit.ts';
import { toConfirm } from './confirm.ts';
import { stopLaunched } from './launcher.ts';
import { readFlat } from './lens-flat.ts';
import { notify } from './notify.ts';
import { wholeMap } from './outbox.ts';
import { actorId } from './pelago.ts';
import { putPicture } from './pictures.ts';
import { tellStamp, took } from './presence.ts';
import { recordRun, sessionEnd, sessionStart, sessionUpdate, tell } from './sessions.ts';
import { point } from './tool-change.ts';
import { backupNow, restartNow } from './tool-config.ts';
import { BRANCH } from './tool-ops.ts';
import type { Tool } from './tools.ts';

export const ACT_TOOLS: Record<string, Tool> = {
  backup: {
    description: 'Back every workspace up now, without waiting for the schedule. Do this before anything that changes the database schema. Answers with what was written.',
    input: {},
    run: async () => {
      const backUp = backupNow();
      if (!backUp) throw new Error('Backups are turned off on this server.');
      return backUp();
    },
  },
  show: {
    description:
      'Point the human\'s web UI at something, so they can follow what you are doing: an item, a screen (optionally "of" one item: the graph around it, or a project\'s roadmap), or what their canvas draws (a flat lens, the one query flat reads, with a style). ' +
      'Their page goes there within a couple of seconds if they have "Follow agents" on. Add a short note saying what they are looking at. ' +
      'An applied or proposed change already points the UI at what it touched; use this for everything else, and before a step worth watching.',
    input: {
      entity: z.string().optional().describe('An item id: open its page; a view kept on the map (type lens, a saved canvas) is opened as their canvas, its lens in their query bar.'),
      screen: z.enum(['today', 'review', 'map', 'graph', 'roadmap', 'questions', 'automations', 'activity', 'workspace']).optional(),
      of: z.string().optional().describe('With screen graph, roadmap or questions: the item (for the last two, a project) it is drawn for.'),
      lens: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('What their canvas draws: a flat lens, as query flat takes it ({ filter: { text, types, ids, links, only, within, exclude }, walk: { over, steps }, limit }), shown in their query bar as if they had written it. With entity, under that item\'s page. {} is the canvas as it opens.'),
      style: z
        .object({
          lit: z.enum(['all', 'you', 'blocked']).optional().describe('What stays lit: everything, only what waits on the person looking, or only what is blocked.'),
          shape: z.enum(['list', 'flow', 'grid', 'time', 'architecture']).optional().describe('One of the built-in drawings. list: each thing one line, what holds others a box that folds. flow: a process map, top down, wires at right angles. grid: rows by what the start holds, columns by lane, each thing a card. time: along the lens\x27s time axis, a calendar or bars. architecture: a system, each part a box inside a box for where it runs, wires down to what it calls, each part and wire marked with its health.'),
          id: z.string().optional().describe('A style kept on the map (an item of type style), drawn with for this one look.'),
        })
        .optional()
        .describe('How the view is drawn, for this one look. The style a view opens in is kept on the map: an item of type style, about the project or item it is for, or about nothing for the whole workspace; change it with change.'),
      note: z.string().max(200).optional().describe('One line shown beside the page.'),
    },
    run: async (l, actor, input) => {
      // A saved canvas is opened as what their canvas draws: the page reads its lens and style from the map.
      const kept = input.entity && (await l.entity(input.entity));
      if (kept && !input.lens && !input.style && l.registry.isA(kept.type, 'lens')) return point(l, actor, 'show', `v?canvas=${input.entity}`, input.note);
      if (input.lens || input.style) {
        // Read as the flat lens reads it, so a lens the canvas could not draw is refused here and not on the owner's screen.
        const asked = (input.lens ?? {}) as { filter?: { exclude?: unknown }; limit?: unknown };
        const lens = Object.keys(asked).length ? readFlat(l, asked) : undefined;
        for (const id of [...(lens?.include.ids ?? []), ...(input.entity ? [input.entity] : [])]) if (!(await l.entity(id))) throw new Error(`No item "${id}"`);
        // The address says the lens as the page reads it (ui/lens.js, readFlatLens): each term of the filter, the walk, the limit.
        const query = new URLSearchParams();
        if (lens) {
          const { text, types, ids, links } = lens.include;
          const walked = lens.walk.over === 'all' || lens.walk.over.length > 0;
          if (text) query.set('text', text);
          if (types?.length) query.set('types', types.join(','));
          if (ids?.length) query.set('ids', ids.join(','));
          for (const t of links ?? []) query.append('link', `${t.link} ${t.to ?? t.from}`);
          if (asked.filter?.exclude !== undefined) query.set('exclude', lens.exclude.join(','));
          if (walked) query.set('over', lens.walk.over === 'all' ? 'all' : (lens.walk.over as string[]).join(','));
          if (walked) query.set('steps', String(lens.walk.steps));
          if (asked.limit !== undefined) query.set('limit', String(lens.limit));
        }
        if (input.style?.lit) query.set('lit', input.style.lit);
        if (input.style?.shape) query.set('shape', input.style.shape);
        if (input.style?.id) query.set('style', input.style.id);
        // Their canvas draws it, under the item's page when one is named.
        return point(l, actor, 'show', `${input.entity ? `e/${input.entity}` : 'v'}${query.size ? `?${query}` : ''}`, input.note);
      }
      if (!input.entity && !input.screen) throw new Error('show needs "entity", "screen" or "lens".');
      return point(l, actor, 'show', input.entity ? `e/${input.entity}` : input.of ? `${input.screen}/${input.of}` : input.screen, input.note);
    },
  },
  claim: {
    description:
      'Take a resource before using it, e.g. the one live app session. Fails, naming the current holder, if an exclusive resource is already held. Takes effect at once.',
    input: {
      resource: z.string(),
      holder: z.string().describe('Id of the run, agent or person taking it.'),
      for: z.string().optional().describe('Id of the task it is being held for; that task is then not shown as blocked.'),
      reason: z.string().min(1),
    },
    run: async (l, actor, input) => l.claim(actor, input),
  },
  release: {
    description: 'Give a resource back when done. Takes effect at once.',
    input: {
      resource: z.string(),
      holder: z.string().optional().describe('Release only this holder\'s claim. Omit to release all.'),
      reason: z.string().min(1),
    },
    run: async (l, actor, input) => l.release(actor, input),
  },
  places_put: {
    description: 'Put things where they stand on one canvas, a batch of moves in one call: each item’s middle as [x, y] in the picture’s own units, or null to let the drawing lay it again; clear: true forgets every place on the canvas first. Never a fact about the work: kept in the places stream, newest per canvas and item. Takes effect at once.',
    input: {
      canvas: z.string().optional().describe("The canvas: the id of the item it is drawn from; the workspace's (or nothing) for the whole map."),
      moves: z.record(z.string(), z.tuple([z.number(), z.number()]).nullable()).optional().describe('By item id: where its middle now is, or null.'),
      clear: z.boolean().optional().describe('Forget every place on this canvas first: it is laid out again.'),
    },
    run: async (l, actor, input) => putPlaces(l, actor, input),
  },
  session_start: {
    description: 'Register this agent session in the map so the human can see it. Give the task you are working on if there is one: any exclusive resource that task needs is claimed for you, or you are told who holds it, and how to say in a commit that you finished it. Give the git branch you work on, so a push to it is read against your task. Takes effect at once.',
    input: {
      title: z.string().optional().describe('A few words on what this session is for.'),
      task: z.string().optional().describe('Id of the item being worked on.'),
      surface: z.string().optional().describe('Where you are running, e.g. claude-code, claude-desktop.'),
      cwd: z.string().optional().describe('Your working directory. Used to find the repository.'),
      remote: z.string().optional().describe('The address the checkout was cloned from (git remote origin). Finds the repository on any machine; the directory is used when this is not given or not known.'),
      session_id: z.string().optional().describe('The id your surface gave this session, if you know it. Makes this call safe to repeat.'),
      branch: BRANCH,
    },
    run: async (l, actor, input) => sessionStart(l, actor, input),
  },
  session_update: {
    description: 'Report in from a registered session: a note worth keeping, a change to waiting or running, a task you have picked up, or the git branch you moved to. With only the run, it is a heartbeat.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      status: z.enum(['running', 'waiting']).optional(),
      note: z.string().optional().describe('What happened, what you found, or what you are blocked on.'),
      task: z.string().optional(), branch: BRANCH,
    },
    run: async (l, actor, input) => sessionUpdate(l, actor, input),
  },
  tell: {
    description:
      'Tell the story of your session as you work, so the owner sees what you see: one beat at a time, what you have concluded and why, in a sentence (said), the items it is about, and the ties between them you want seen (links, each saying in a few words what ties the two: "blocks", "is why", "same fault as"). Tell what matters, not every step: a cause, a choice and its reason, what stands in the way. Your session’s page opens on your finding: send finding: true with what you have found so far, said whole for someone who has read nothing else (a few plain sentences: the point, what it rests on, what is left; item ids in it are shown as their names), its items and the ties between them, which are what it draws. Send a new finding whenever what you have found changes; the beats are the history under it. When you change your mind, take the old beat back with replaces (its number) and say what you think now. Takes effect at once.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      said: z.string().min(1).describe('What you concluded and why, in a sentence or two: 280 characters at most.'),
      about: z.array(z.string()).optional().describe('Ids of the items it is about; the ends of links are added for you.'),
      links: z
        .array(z.object({ from: z.string(), to: z.string(), says: z.string().describe('What ties them, in a few words.') }))
        .optional()
        .describe('Ties to draw between items, as you see them; the map’s own links between the items are drawn too.'),
      replaces: z.number().int().positive().optional().describe('The number of an earlier beat this one takes back.'),
      finding: z.boolean().optional().describe('true: this is what the session has found, said whole (600 characters at most); its page opens on the latest.'),
    },
    run: async (l, actor, input) => {
      const answer = await tell(l, actor, input);
      const { db } = await wholeMap(l);
      await tellStamp(db, l.workspace);
      await took(db, l, { kind: 'story', actor: actor.name, did: input.said, hash: `e/${answer.run}` }, true);
      return answer;
    },
  },
  run_report: {
    description:
      'Record a run that happened where Archipelago cannot watch it, once it is over: the agent in GitHub Actions that read a push or re-checked the map says what it was, how it ended and what it used. Kept as a run that has ended, in its repository. Takes effect at once.',
    input: {
      repo: z.string().describe('The repository it ran for: its id or its GitHub name "owner/name".'),
      title: z.string().min(1).describe('What the run was, in a few words.'),
      ok: z.boolean().optional().describe('false when it failed.'),
      tokens: z.number().optional().describe('Tokens it used: input and output, not counting cached re-reads.'),
      cost_usd: z.number().optional(),
      turns: z.number().optional(),
      link: z.string().optional().describe('Where the run can be looked at.'),
      summary: z.string().optional().describe('What it said it did.'),
      surface: z.string().optional().describe('Where it ran. Left out: github-actions.'),
    },
    run: async (l, actor, input) => recordRun(l, actor, input),
  },
  picture_put: {
    description:
      'Keep an image for one item: the screenshot a test drew, for its test result, or a figure for a note or file, which a document that brings the note in shows above its text, or a still of a lens, which a link to a document shows where the app draws the lens live. A test result\u2019s only when the result is shown in public: until then the image stays in the repository it was made in, and the result says where (its `picture` field). One image per item, PNG, JPEG or WebP, 1 MB at most; sent again it replaces what was kept, and when a test is run again (test_report) what was kept for its result is removed. Takes effect at once.',
    input: {
      result: z.string().describe('The id of the test result, or of the note or file the figure belongs to.'),
      data: z.string().min(1).describe('The file, as base64.'),
      content_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    },
    run: async (l, actor, input) => putPicture(l, actor, input),
  },
  session_end: {
    description:
      'Close a registered session with its outcome and a summary. Everything it held is released. A session that finishes in a repository is first shown that repository\'s open work nobody has changed since it began (answer: ended false, with the list): change what is done or no longer as written, name what you checked and found still true in still_true, name what this session had nothing to do with and cannot check in cannot_tell (cannot_tell_rest: true for all the rest), and call again. What waits on a person’s answer (waits_on), or has a change of its own waiting for the human, is not asked about.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      outcome: z.enum(['finished', 'failed', 'cancelled']).optional(),
      summary: z.string().optional().describe('What was done and what is left.'),
      still_true: z.array(z.string()).optional().describe('Ids of open items you have checked and found still true as written.'),
      cannot_tell: z.array(z.string()).optional().describe('Ids of open items this session had nothing to do with and cannot check from where it is. They are left as they were, and the session says it did not check them.'),
      cannot_tell_rest: z.boolean().optional().describe('true when every open item you have not changed or named is one this session had nothing to do with: all of them are left as they were, and the session says how many it did not look at.'),
    },
    run: async (l, actor, input) => {
      // An agent says where the repository's work stands; the human ending a session from the UI is not asked.
      const result = await sessionEnd(l, actor, { ...input, reconcile: actor.kind === 'agent' });
      if ('ended' in result) return result;
      // If this server started the session's process, stop that too.
      return { ...result, process_stopped: stopLaunched(result.run) };
    },
  },
  notify: {
    description: 'Send the human a notification: something they should know or act on that is not itself a change to the map. Shown on their Home screen until read. Use sparingly.',
    input: {
      title: z.string().min(1).describe('The whole message in one line if possible.'),
      body: z.string().optional(),
      level: z.enum(['info', 'warning', 'urgent']).optional(),
      about: z.string().optional().describe('Id of the item it concerns.'),
    },
    run: async (l, actor, input) => notify(l, actor, input),
  },
  check_connections: {
    description: 'Ping every connection (external tool) and record whether it is reachable. Work that needs an unreachable connection shows as blocked.',
    input: {},
    run: async (l, actor) => l.checkConnections(actor),
  },
  rechecked: {
    description:
      'Say that the scheduled re-check of a repository has been done: each project (or feature living there on its own) that was waiting for one starts its interval again (its recheck_days). Call it once, after you have changed or confirmed the items the recheck view gave you. Takes effect at once.',
    input: {
      repo: z.string().describe('The repository: its id, its GitHub name "owner/name", or its title.'),
      summary: z.string().optional().describe('What was checked and what was found.'),
    },
    run: async (l, actor, input) => {
      const projects = ((await askView(l, actor, 'recheck', { repo: input.repo, limit: 0 })) as { projects: { id: string; title: string; waited: boolean }[] }).projects.filter((p) => p.waited);
      const at = new Date().toISOString();
      for (const p of projects) {
        // Bookkeeping stays out of the project's history; the re-check itself is the event.
        await l.operational(p.id, { props: { rechecked_at: at } }, { actor: actorId(actor), action: 'recheck.done', reason: input.summary ?? 'Scheduled re-check of the oldest open items' });
      }
      return { rechecked: projects.map((p) => ({ id: p.id, title: p.title })), at };
    },
  },
  import_audit: {
    description: 'Copy new entries from a connection\'s tool-call log into the activity log, so actions taken in that tool are visible here.',
    input: { connection: z.string() },
    run: async (l, actor, input) => importAudit(l, actor, input),
  },
  confirmed: {
    description:
      'Record what the owner said, in chat, about the questions agents settled (query attention with reason to_confirm, or for_owner in the handoff): that they have been put to the owner and answered, up to an event. It is the owner\u2019s word as you report it, logged as that, and never the mark that a human looked. Change or reopen what they corrected with change, on their authority, before or after.',
    input: {
      upto: z.number().int().nonnegative().describe('The upto the list gave: the newest settling the owner was shown.'),
      basis: z.string().min(1).describe('What the owner said and where, in their words: "Owner in chat, 12 Oct: all fine but the pricing one".'),
    },
    run: async (l, actor, input) => {
      const asked = await toConfirm(l, { limit: 500 });
      const answered = asked.questions.filter((q) => q.seq <= input.upto).map((q) => q.id);
      await l.log(l.db, { actor: actorId(actor), action: 'questions.confirmed', reason: input.basis, detail: { upto: input.upto, questions: answered.length, authority: actor.kind === 'human' ? { of: 'human', who: actorId(actor) } : { of: 'human', basis: input.basis, stated_by: actorId(actor) } } });
      await l.record('settings', actorId(actor), [['+', actorId(actor), 'questions.confirmed', input.upto]], input.basis);
      // The notices that said each one was settled have been answered with them.
      const { rows } = await l.db.query<{ id: string }>(
        `select n.id from entity n join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
         where r.to_id = any($1::text[]) and n.type = 'sys.notification' and n.is_open and n.archived_at is null and n.title like '% settled "%'`,
        [answered],
      );
      if (rows.length) await l.apply('agent:pelago', { ops: rows.map((n) => ({ op: 'update' as const, id: n.id, status: 'read' })), reason: 'Put to the owner and answered in chat' });
      return { confirmed_upto: input.upto, questions: answered.length, left: (await toConfirm(l)).count };
    },
  },
  restart: {
    description:
      'Dev mode only. Restart the server so it runs the code now on disk; use it after changing anything under src/ or packs/. ' +
      'Answers at once, then the server is away for a few seconds: wait for GET /health before the next call. Sessions it launched are stopped. ' +
      'If the new code does not start, the server comes back when a file under src/ or packs/ next changes; the reason is in runs/dev-server.log.',
    devOnly: true,
    input: {},
    run: async () => {
      restartNow();
      return { restarting: true, log: 'runs/dev-server.log' };
    },
  },
};
