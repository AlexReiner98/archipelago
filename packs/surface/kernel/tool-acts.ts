// The kernel's actions: what an agent does besides changing facts, each one of the six verbs (KERNEL_VERBS in
// src/declared.ts): a session registered, reporting in and ending, the story it tells, a resource taken and given
// back, the owner's screen pointed, a notification sent, the owner's word
// recorded, a backup taken.

import { z } from 'zod';
import { importAudit } from '../../../src/audit.ts';
import { callAs } from '../../loader/kernel/kernel-context.ts';
import { keepRunsWith, stopLaunched } from '../../../src/launcher.ts';
import { itemLink } from '../../../src/members.ts';
import { actorId } from '../../../src/pelago.ts';
import { recordRun, recordUsage, sessionEnd, sessionStart, sessionUpdate, tell } from '../../../src/sessions.ts';
import { point, sessionOpened, sessionTookUp, whose } from './tool-change.ts';
import { slotted } from './surface-slots.ts';
import { backupNow, restartNow } from './tool-config.ts';
import { BRANCH } from './tool-ops.ts';
import type { Tool } from './tools.ts';
import { VIEW_INPUT, viewAddress, WEB_URL, webAddress } from './view-address.ts';
import { withdraw } from '../../../src/withdraw.ts';

// What an act asks of the packs above the surface it asks by their service names (docs/kernel-packs.md, "Service
// names"), answered as the map that asks: the owner's screen (presence), a look (look_draw), a picture (publish), a
// notification (notifications), what a session is told (agents) and where it stands (runs), what the owner is to
// confirm (attention) and what no longer waits on them (waits).

/** The kinds of picture picture_put keeps: the publish pack's (act.capture.picture), which checks them again. */
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

/** Who acts, as a pack's service is told it: only what the log names it by. */
const sender = (actor: { kind: string; name: string }) => ({ kind: actor.kind, name: actor.name });

// A launched session's run is kept with the same writes as the session acts here (src/launcher.ts, the surface's).
keepRunsWith({ sessionStart, sessionUpdate, sessionEnd, tell, recordUsage });

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
      'Answer the human with a view on their canvas: a kept view (entity: a view (type lens), a saved canvas) or a query and layout of your own, or open an item\'s page or the workspace. ' +
      'Or frame a web page in a pane (url: a dev server\'s build, a sketch, a page), so they watch it beside the map: it reloads only when you show it again. A site that refuses to be framed (X-Frame-Options or frame-ancestors, as most sign-in pages and large sites do) stays blank, and the pane\'s ↗ opens it in a window of its own; a plain http address frames only on localhost or 127.0.0.1, and this server\'s own pages are shown by entity, not url. ' +
      'It lands within a couple of seconds in a pane of your session’s own on each page of theirs that is open, beside the pane they are in, which it never takes, and their page brings that tab into sight (focus: false leaves it out of sight, marked). The answer says how many of their pages are open and how many take your shows (pages), and whether it lands in the tab they are looking at (sight: looking, and where, in a line); when it does not, tell them where to look. Add a short note saying what they are looking at. ' +
      'A change moves nothing on their page: show what is worth watching. ' +
      'With look: true, the answer also carries the picture of it, as an image: drawn by the server as you see the map, whether or not a page of theirs is open (query look takes one without moving their page). ' +
      'For the person reading a chat, call draw.',
    input: {
      ...VIEW_INPUT,
      screen: z.enum(['workspace', 'you']).optional().describe('The workspace sheet, or what waits for them.'),
      url: WEB_URL.optional().describe('A web page to frame in a pane, in place of a view: http or https (plain http on localhost only).'),
      // A show takes the owner to it (the owner, 4 Nov 2026: "the tab you open should automatically take focus").
      focus: z.boolean().optional().describe('false to leave the tab it lands in out of sight, marked (for a show they did not ask to watch). Left out, their page brings that tab into sight.'),
      note: z.string().max(200).optional().describe('One line, kept on your pane as its tooltip.'),
      watch: z.boolean().optional().describe('true once the owner has approved the plan you show and its sessions are starting: the tab it lands in watches it, so each session working on anything in it is drawn there on its step and shows its work in that tab, not a tab of its own. Show a view that walks works_on< from the plan’s steps and leaves out no run (not: []), so its sessions are drawn on it.'),
      look: z.boolean().optional().describe('Also answer with a picture of it, drawn by the server (as query look draws it).'),
      width: z.number().int().min(320).max(1920).optional().describe('With look: the picture’s width in pixels (1200).'),
      height: z.number().int().min(240).max(1600).optional().describe('With look: its height (750).'),
      scheme: z.enum(['dark', 'light']).optional().describe('With look: the theme it is drawn in (dark).'),
      fresh: z.boolean().optional().describe('With look: draw it again, never the picture already taken.'),
      pane: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,23}$/, 'pane is a side (left, right, above, below), main, alone, or a short lower-case name of your own')
        .optional()
        .describe(
          'Which pane of their page it goes to. A name of your own ("map", "review") is a pane of your session’s: opened beside their main canvas the first time, drawn in again each time you name it, so you can keep two things in sight at once. ' +
            'A side (left, right, above, below) puts your session’s pane there; main is the main canvas; alone closes the other panes first. ' +
            'Left out, it goes to the pane that follows your session, else to one of your own beside the pane they are in, opened the first time. The owner picks whom each tab follows, and a pane following someone else, or the one they are in, is not yours to move. Only a canvas, an item or a url goes to a pane.',
        ),
      run: z.string().optional().describe('Your session’s run id, so the pane that follows your session is the one it goes to. Left out, the one you last named in a session_update or tell.'),
    },
    run: async (l, actor, input) => {
      // Where it pointed, and whether a page of theirs is there to follow it; with a look, the picture of what is there.
      if (input.url && input.look) throw new Error('look draws the map: a url is framed on their page, never drawn by the server.');
      const hash = input.url ? webAddress(input.url) : await viewAddress(l, input);
      const focus = input.focus ?? true;
      const at = await point(l, actor, 'show', hash, input.note, input.pane, input.run, focus, input.watch);
      // Whether the owner sees it: the tab in sight is the one this session's shows go to; brought there, it is asked
      // until their page has looked again (the presence pack's answer.sight).
      const { pages, sight } = await callAs<{ pages: unknown; sight: unknown }>(l, 'answer.sight', { whose: whose(l), actor: actor.name, run: input.run, focus });
      const size = { width: input.width, height: input.height, scheme: input.scheme, fresh: input.fresh };
      return { ...at, pages, sight, ...(input.look && (await callAs<Record<string, unknown>>(l, 'answer.look', { whose: whose(l), actor: actor.name, hash, size }))) };
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
  withdraw: {
    description:
      'Take back a held change you proposed yourself, e.g. one a newer change of yours covers (proposals lists covers and covered_by). It leaves the queue as withdrawn. Never another’s, and it decides nothing: approving or declining one stays a person’s.',
    input: { proposal: z.string().describe('The held change’s id (p_...).'), reason: z.string().min(1).optional().describe('Why, shown on it. Left out, what covers it.') },
    run: async (l, actor, input) => withdraw(l, actor, input),
  },
  session_start: {
    begins: true,
    within: { task: 'take it on' },
    description: 'Register this agent session in the map so the human can see it: their page opens it a tab of its own, named by your chat’s title, and closes it when the chat ends (report session_end with reason; a chat that goes quiet for 12 hours is ended for it). Safe to call again on resume: the same session_id takes up the same session. Give the task you are working on if there is one: any exclusive resource that task needs is claimed for you, or you are told who holds it, and how to say in a commit that you finished it. Give the git branch you work on, so a push to it is read against your task. Its answer names the workspace your token acts in (workspace: id and name): check it is the one you mean before you write. Takes effect at once.',
    input: {
      title: z.string().optional().describe('What your chat is called, as your client shows it; else a few words on what this session is for. Renamed later: report session_update with title.'),
      task: z.string().optional().describe('Id of the item being worked on.'),
      surface: z.string().optional().describe('Where you are running, e.g. claude-code, claude-desktop.'),
      cwd: z.string().optional().describe('Your working directory. Used to find the repository.'),
      remote: z.string().optional().describe('The address the checkout was cloned from (git remote origin). Finds the repository on any machine; the directory is used when this is not given or not known.'),
      session_id: z.string().optional().describe('The id your surface gave this session, if you know it. Makes this call safe to repeat.'),
      branch: BRANCH,
      parent: z.string().optional().describe('The session that started this one: run or session id.'),
      source: z.enum(['startup', 'resume', 'clear', 'compact']).optional().describe('Why your client started it, if it says: after clear, the chat goes on, and this session takes over the tab of the one the clear ended in the same folder.'),
    },
    run: async (l, actor, input) => {
      const started = await sessionStart(l, actor, input);
      // A new session, or one taken up again after it ended, gets its tab; one still open has it.
      if (!started.resumed || started.reopened) await sessionOpened(l, actor, started.run, input.task, started.took_over);
      // What every session is told (instructions for the act that begins one, BEGINS_AT) is said in the answer too, so a session its hook
      // registered and that joins that run hears it as a new one does (issue e_sm2sa75h). A resume was told at first.
      if (started.resumed) return { ...started, link: itemLink(l.workspace) };
      // A session on a task is told what its task's island says: the version of its pack the island runs (src/island-pin.ts).
      const island = input.task ? (await l.entity(input.task))?.props.island : undefined;
      const told = await callAs<{ text: string }[]>(l, 'answer.instructions', { where: BEGINS_AT, about: started.repo?.id, ...(typeof island === 'string' && { island }), fill: { run: started.run } });
      // And where it stands: what the sessions before it here worked on that needs attention now (the runs pack's answer.frontier).
      const here = await callAs(l, 'answer.frontier', { run: started.run, cwd: input.cwd, remote: input.remote });
      return { ...started, link: itemLink(l.workspace), frontier: here, ...(told.length && { instructions: told.map((one) => one.text) }) };
    },
  },
  session_update: {
    quiet: (input) => !input.task && !input.note,
    within: { task: 'take it on' },
    description: 'Report in from a registered session: a note worth keeping, a change to waiting or running, a task you have picked up, or the git branch you moved to. With only the run, it is a heartbeat.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      status: z.enum(['running', 'waiting']).optional(),
      note: z.string().optional().describe('What happened, what you found, or what you are blocked on.'),
      task: z.string().optional(), branch: BRANCH,
      title: z.string().optional().describe('What your chat is called now, when it was renamed: the tab on the owner’s page follows.'),
      parent: z.string().optional().describe('Its parent, learnt later.'),
    },
    run: async (l, actor, input) => {
      const updated = await sessionUpdate(l, actor, input);
      // What it takes on is what its tab draws, so the owner sees the work as it is taken up.
      if (input.task) await sessionTookUp(l, actor, updated.run, input.task);
      return updated;
    },
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
      await callAs(l, 'act.report.took', { whose: whose(l), told: true, step: { kind: 'story', actor: actor.name, did: input.said, hash: `e/${answer.run}`, run: answer.run } });
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
      tokens: z.number().optional().describe('Tokens it used, one number: input and output together, not counting cached re-reads.'),
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
      'Keep an image for one item: the screenshot a test drew, for its test result, or a figure for a note or file, which a document that brings the note in shows above its text, or a still of a query, which a link to a document shows where the app draws the query live. A test result\u2019s only when the result is shown in public: until then the image stays in the repository it was made in, and the result says where (its `picture` field). One image per item, PNG, JPEG or WebP, 1 MB at most; sent again it replaces what was kept, and when a test is run again (test_report) what was kept for its result is removed. Takes effect at once.',
    input: {
      result: z.string().describe('The id of the test result, or of the note or file the figure belongs to.'),
      data: z.string().min(1).describe('The file, as base64.'),
      content_type: z.enum(PICTURE_TYPES).describe('An SVG is kept only when it is drawing alone: shapes, fills, strokes and text, with no script, style, link or fetch.'),
    },
    run: async (l, actor, input) => callAs(l, 'act.capture.picture', { ...input, actor: sender(actor) }),
  },
  session_end: {
    within: { still_true: 'vouch for it' },
    description:
      'Say a registered session is done, with its outcome and a summary. Everything it held is released. A session a chat keeps stays open until the chat ends. A session that finishes in a repository is first shown that repository\'s open work nobody has changed since it began (answer: ended false, with the list): change what is done or no longer as written, name what you checked and found still true in still_true, name what this session had nothing to do with and cannot check in cannot_tell (cannot_tell_rest: true for all the rest), and call again. What waits on a person’s answer (waits_on), or has a change of its own waiting for the human, is not asked about.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      outcome: z.enum(['finished', 'failed', 'cancelled', 'done', 'success']).optional().describe('finished, failed or cancelled; done and success are read as finished.'),
      reason: z.string().max(40).optional().describe('Only when the chat itself has ended, as your client says it (closed, archived, deleted, exit): the session then ends, its tab on the owner’s page closes. Without it, a session a chat keeps stays open until the chat ends.'),
      summary: z.string().optional().describe('What was done and what is left.'),
      still_true: z.array(z.string()).optional().describe('Ids of open items you have checked and found still true as written.'),
      cannot_tell: z.array(z.string()).optional().describe('Ids of open items this session had nothing to do with and cannot check from where it is. They are left as they were, and the session says it did not check them.'),
      cannot_tell_rest: z.boolean().optional().describe('true when every open item you have not changed or named is one this session had nothing to do with: all of them are left as they were, and the session says how many it did not look at.'),
    },
    run: async (l, actor, input) => {
      // An agent says where the repository's work stands; the human ending a session from the UI is not asked.
      const outcome = input.outcome === 'done' || input.outcome === 'success' ? 'finished' : input.outcome;
      const result = await sessionEnd(l, actor, { ...input, outcome, reconcile: actor.kind === 'agent', chat_goes_on: actor.kind === 'agent' && !input.reason });
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
    run: async (l, actor, input) => callAs(l, 'act.report.notify', { ...input, actor: sender(actor) }),
  },
  check_connections: {
    description: 'Ping every connection (external tool) and record whether it is reachable. Work that needs an unreachable connection shows as blocked.',
    input: {},
    run: slotted('surface.act', 'check_connections'), // what it does is the connect pack's filling (src/check-connections.ts)
  },
  rechecked: {
    description:
      'Say that the scheduled re-check of a repository has been done: each project (or feature living there on its own) that was waiting for one starts its interval again (its recheck_days). Call it once, after you have changed or confirmed the items the recheck view gave you. Takes effect at once.',
    input: {
      repo: z.string().describe('The repository: its id, its GitHub name "owner/name", or its title.'),
      summary: z.string().optional().describe('What was checked and what was found.'),
    },
    run: slotted('surface.act', 'rechecked'), // what it does is a filling (src/recheck.ts)
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
      const asked = await callAs<{ questions: { id: string; seq: number }[] }>(l, 'answer.to_confirm', { limit: 500 });
      const answered = asked.questions.filter((q) => q.seq <= input.upto).map((q) => q.id);
      const authority = actor.kind === 'human' ? { of: 'human' as const, who: actorId(actor) } : { of: 'human' as const, basis: input.basis, stated_by: actorId(actor) };
      // The owner's word on what agents settled: something done, on whose authority, kept in the activity stream.
      await l.log(l.db, { actor: actorId(actor), action: 'questions.confirmed', reason: input.basis, detail: { upto: input.upto, questions: answered.length, authority } });
      // The notices that said each one was settled have been answered with them.
      const { rows } = await l.db.query<{ id: string }>(
        `select n.id from entity n join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
         where r.to_id = any($1::text[]) and n.type = 'notification' and n.is_open and n.archived_at is null and n.title like '% settled "%'`,
        [answered],
      );
      if (rows.length) await l.apply('agent:pelago', { ops: rows.map((n) => ({ op: 'update' as const, id: n.id, status: 'read' })), reason: 'Put to the owner and answered in chat' });
      // Answered on the owner's word, they no longer wait on the owner (the waits pack's answer.waiting_on).
      const { person, waits } = await callAs<{ person: string | null; waits: { id: string; from_id: string }[] }>(l, 'answer.waiting_on', { items: answered, authority });
      if (waits.length) await l.apply(actorId(actor), { ops: waits.map((w) => ({ op: 'unlink' as const, relation: w.id })), reason: 'Answered on their word: no longer waits on them' }, { authority });
      return { confirmed_upto: input.upto, questions: answered.length, left: (await callAs<{ count: number }>(l, 'answer.to_confirm', {})).count, ...(waits.length && { unwaited: waits.map((w) => ({ item: w.from_id, person, relation: w.id })) }) };
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

/**
 * Where what every session is told at its start is said (an instruction's for): the name of the act that begins a
 * session (begins), so no other name of it is written down.
 */
export const BEGINS_AT = Object.keys(ACT_TOOLS).find((name) => ACT_TOOLS[name].begins)!;
