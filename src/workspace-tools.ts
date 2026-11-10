// A workspace's settings: read and changed by a human admin, never by an agent. What agents may do unreviewed here
// (apply their changes, download backups, publish documents) is the owner's to give and take back.

import { z } from 'zod';
import { endedOf, useOf, type Limits } from './standing.ts';
import { limitOf, renameWorkspace } from './members.ts';
import { looksThisHour } from './looks.ts';
import { sessionsAwake } from './sessions.ts';
import { requestsThisMinute, storageOf } from './workspace-use.ts';
import { acceptedSenders, wholeMap } from './outbox.ts';
import { actorId, type Archipelago } from './pelago.ts';
import { askedLately } from './replies.ts';
import { atSetting, AT_MAX, countsTo, isAt, onReply } from './reply-rules.ts';
import { HOLDS_OFF, holdsOff, liftsOn } from './rules.ts';
import type { Tool } from './tools.ts';
import { notKernel } from './head.ts';
import { ISLANDS } from './islands.ts';
import { islandsOn, setIslands } from './packstate.ts';

/** The setting that runs a layout's code with no sandbox: in the page's own origin, with the network, files, fonts and links. */
export const DRAWINGS_OPEN = 'drawings_open';

/** The settings that turn off a rule on a reply's end, one for each such rule the packs here declare. */
const replyLifts = (l: Archipelago) => [...new Set(l.registry.rules.filter(onReply).map((r) => r.lifted!))];

const settings = async (l: Archipelago) => {
  const { agent_backups, agent_publish, agent_code } = await liftsOn(l.db);
  const names = replyLifts(l);
  const ats = l.registry.rules.filter((r) => onReply(r) && countsTo(r)).map(atSetting);
  const { rows } = names.length ? await l.db.query<{ key: string; value: unknown }>(`select key, value from setting where key = any($1::text[])`, [[...names, ...ats]]) : { rows: [] };
  const lifted = Object.fromEntries(names.map((name) => [name, rows.some((r) => r.key === name && r.value === true)]));
  const set = new Map(rows.filter((r) => ats.includes(r.key) && isAt(r.value)).map((r) => [r.key, r.value as number]));
  return { id: l.workspace, default_visibility: await l.defaultVisibility(), agent_changes: await l.agentChanges(), accepts_from: await acceptedSenders(l), agent_backups, agent_publish, agent_code, drawings_open: await drawingsOpen(l), [ISLANDS]: await islandsOn(l), [HOLDS_OFF]: await holdsOff(l.db), ...(names.length && { lifted, reply_rules: await replyRules(l, lifted, set) }) };
};

/** Whether the owner has turned the sandbox off for drawings here: read whole, since every member's page draws by it (ui/style-code.js). */
const drawingsOpen = async (l: Archipelago) => (await (await wholeMap(l)).setting(DRAWINGS_OPEN)) === true;

/**
 * Each rule on a reply's end, for the owner's switch: what it says, the setting that turns it off, how often it asked
 * this week, and for one that counts, what it counts and the number it asks at (the owner's, or its pack's).
 */
async function replyRules(l: Archipelago, lifted: Record<string, boolean>, set: Map<string, number>) {
  const asked = await askedLately((await wholeMap(l)).db, l);
  return l.registry.rules.filter(onReply).map((r) => {
    const rule = `${r.pack}.${r.id ?? ''}`;
    const counts = countsTo(r);
    return { rule, say: r.say ?? '', lifted: r.lifted!, off: lifted[r.lifted!], asked: asked.get(rule) ?? 0, ...(counts && { counts: counts.fact, at: set.get(atSetting(r)) ?? counts.at }) };
  });
}

/** How much of what its limits cap the workspace uses now (src/standing.ts), each said as the Limits card shows it. */
async function planUse(l: Archipelago, limits: Limits) {
  const { db } = await wholeMap(l);
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from member where removed_at is null`);
  return useOf(limits, { members: rows[0].n, storage: await storageOf(l.workspace), requests: requestsThisMinute(l.workspace), sessions: await sessionsAwake(l), looks: looksThisHour(l.workspace) });
}

export const WORKSPACE_TOOLS: Record<string, Tool> = {
  workspace_info: {
    description: 'This workspace’s settings: its id, its owner (null until one is set with init), the default visibility of new things, whether agents’ changes are applied as they are made or held for a human, whether agents may download backups or publish documents, whether a layout’s code runs without the sandbox (drawings_open), whether holds are off (holds_off), whether its packs are held to the island rules (islands), which workspaces it accepts notifications from, and on a workspace the server caps, its limits (member_limit) and how much of each it uses (use).',
    humanOnly: true,
    input: {},
    run: async (l) => {
      const { rows } = await l.db.query<{ id: string; title: string }>(`select id, title from entity where id = $1`, [(await l.setting<string>('me')) ?? '']);
      const limits = await limitOf(l.workspace);
      // Whether anything has been put here yet beyond who is in it and how the app is set up.
      const started = (await l.db.query(`select 1 from entity where type <> all($1::text[]) and ${notKernel(l.registry)} and archived_at is null limit 1`, [l.registry.family('actor')])).rows.length > 0;
      // Whether any agent session has ever been here: until one has, an empty page points at connecting one.
      const agents = (await l.db.query(`select 1 from entity where type = 'run' limit 1 -- index entity_type`)).rows.length > 0;
      return { ...(await settings(l)), started, agents, owner: rows[0] ?? null, member_limit: limits ?? null, ...(limits && { use: await planUse(l, limits) }), ended: (await endedOf(l.workspace)) ?? null };
    },
  },
  workspace_set: {
    description: 'Change workspace settings. default_visibility: whether new things are shared unless they say otherwise (how a new workspace starts) or private to their author. agent_changes: "apply" to have what agents change take effect as they make it, each change logged and undoable, or "hold" to have it wait for a human. With "apply" an agent can also settle a decision or a hypothesis: it must say what was chosen and why, and the human is notified. accepts_from: which other workspaces may send this one notifications. Admins only.',
    humanOnly: true,
    input: {
      default_visibility: z.enum(['private', 'shared']).optional(),
      agent_changes: z.enum(['apply', 'hold']).optional(),
      accepts_from: z.array(z.string()).optional().describe('Ids of the workspaces allowed to send this one notifications. Replaces the list.'),
      agent_backups: z.boolean().optional().describe('Whether agents may download the whole workspace as a backup file (backup_download), private items included.'),
      agent_publish: z.boolean().optional().describe('Whether agents may publish documents here (publish, publish_all), each publish logged with its authority. Taking one down stays a human’s.'),
      agent_code: z.boolean().optional().describe('Whether agents’ changes to the code a drawing or a style runs (modules, code) take effect as they make them, instead of waiting for a human. That code runs in the sandbox unless drawings_open is on; each change is logged and undoable.'),
      drawings_open: z.boolean().optional().describe('Whether a layout’s code runs without the sandbox, for everyone who looks here: in the page’s origin, as the person looking, with the network, files, fonts and links, and its panel in the page where an agent driving the browser can read it. Off unless set.'),
      holds_off: z.boolean().optional().describe('Whether every change applies as it is made, whatever rule would hold it: settling, code, what is public, forget (which cannot be undone) included. A wait the change or its token asked for still holds. Off unless set.'),
      islands: z.boolean().optional().describe('Whether packs here are held to the island rules: a pack is taken only if its file holds vocabulary, views and instructions and it builds on the shared set alone. A new workspace starts with it on. Turned on for a map with work, what is on no island moves onto islands, in one change; refused if a pack in use would be switched off.'),
      name: z.string().trim().min(1).max(60).optional().describe('What this workspace is called. Its id and addresses stay as they are.'),
      lifted: z.record(z.string(), z.boolean()).optional().describe('Turn a rule on a session’s reply ending off (true) or on again (false), by the setting it names (its lifted, such as reply_draw): workspace_info lists them.'),
      asks_at: z.record(z.string(), z.number().int().min(1).max(AT_MAX)).optional().describe('For a rule on a reply’s end that counts (workspace_info: its counts and at), how many the reply must do before it asks, by the rule’s lifted.'),
    },
    run: async (l, actor, input) => {
      if (!actor.admin) throw new Error('Only a workspace admin can change workspace settings.');
      const { lifted, asks_at, name, islands, ...rest } = input as Record<string, unknown> & { lifted?: Record<string, boolean>; asks_at?: Record<string, number>; name?: string; islands?: boolean };
      if (islands !== undefined) await setIslands(l, actor, islands);
      if (name) {
        await renameWorkspace(l.workspace, name);
        await l.record('settings', actorId(actor), [['+', 'setting', 'name', name]]);
      }
      const known = replyLifts(l);
      for (const name of Object.keys(lifted ?? {})) if (!known.includes(name)) throw new Error(`No rule here is turned off by "${name}": ${known.length ? `these are, ${known.join(', ')}` : 'no pack here declares a rule on a reply ending'}.`);
      const counting = l.registry.rules.filter((r) => onReply(r) && countsTo(r));
      const ats = Object.entries(asks_at ?? {}).map(([name, n]) => {
        const rule = counting.find((r) => r.lifted === name);
        if (!rule) throw new Error(`No rule here that counts is turned off by "${name}": ${counting.length ? `these are, ${counting.map((r) => r.lifted).join(', ')}` : 'none here counts'}.`);
        return [atSetting(rule), n] as const;
      });
      for (const [key, value] of [...Object.entries(rest), ...Object.entries(lifted ?? {}), ...ats]) {
        await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
        await l.record('settings', actorId(actor), [['+', 'setting', key, value]]);
      }
      return settings(l);
    },
  },
};
