// Rules on a push (task e_jmysk8td; the owner, 18 Nov 2026: a lane's push is stopped, not only flagged). A rule in a
// pack's rules with on "push" decides about a command a session is about to run that sends work out: git push, gh pr
// create, gh pr merge. Claude Code's PreToolUse hook sends the command and where the checkout stands, before it runs
// (scripts/pelago-hook.mjs, push); the server reads what it would do (readPush) and asks each rule on a push whether
// it holds of it and of the session: what the session works on (by type, its lineage counted) and what it holds (by
// the resource's title or id). A rule that holds refuses, with its one-line say, and the refusal is kept as a beat of
// the session's story (`refused`, ./beats.ts), where the owner sees it. A rule on a push names no type of the kernel's
// own: a pack that has lanes says which type a lane is (the build pack's rule, e_warf3rd2), and which resource is
// main (e_8wk8mde5). What a rule is and when it holds is read with nothing of the map; pushAnswer asks the map.

import type { KernelContext } from '#pelago/kernel';
import { befell } from './beats.ts';
import { resolveRun } from './chat-run.ts';
import type { Item } from './types.ts';

/** A rule as a pack declares it (packs/rules/kernel/rules.ts): the fields a rule on a push is read by. */
export interface RuleDef {
  id?: string;
  on?: string;
  then?: unknown;
  when?: { push?: Record<string, unknown>; [key: string]: unknown };
  say?: string;
  lifted?: string;
  pack?: string;
}

/** The event a push rule is on. */
export const PUSH = 'push';
/** What a command sends out: a branch pushed, a pull request made, one merged. */
export const PUSH_COMMANDS = ['push', 'pr_create', 'pr_merge'] as const;
export type PushCommand = (typeof PUSH_COMMANDS)[number];
/** What a rule on a push may read: which command, the branch it goes to, a type the session works on, a resource it does not hold. */
export const PUSH_WHEN = ['command', 'to', 'works_on', 'lacks'] as const;
/** A pull request's base, when the command does not name one: the branch a repository's work lands on. */
export const DEFAULT_BRANCH = 'main';
/** A reason is one line, short enough to be read in passing and kept as a beat. */
const SAY_MAX = 200;

/** Whether a rule is on a push, rather than on a change. */
export const onPush = (rule: RuleDef) => rule.on === PUSH;

const word = (v: unknown) => typeof v === 'string' && /^[\w.:/-]+$/.test(v);

/** Problems with a push rule, as checkRules reports them. */
export function checkPushRule(rule: RuleDef, at: string, known: (type: string) => boolean = () => true): string[] {
  const problems: string[] = [];
  if (!rule.id) problems.push(`${at}: a rule on a push has an id, so its refusal names it`);
  if (rule.on !== PUSH) problems.push(`${at}: on is "${PUSH}"`);
  if (rule.then !== 'refuse') problems.push(`${at}: a rule on a push refuses (then: "refuse")`);
  if (rule.lifted !== undefined) problems.push(`${at}: nothing lifts a rule on a push: a pack that does not want it leaves it out`);
  const when = rule.when ?? {};
  for (const key of Object.keys(when)) if (key !== 'push') problems.push(`${at}: a rule on a push reads only when.push`);
  const push = when.push ?? {};
  if (!Object.keys(push).length) problems.push(`${at}: when.push says which of ${PUSH_WHEN.join(', ')} it holds of`);
  for (const [key, v] of Object.entries(push)) {
    if (!(PUSH_WHEN as readonly string[]).includes(key)) problems.push(`${at}: no fact "${key}" about a push (${PUSH_WHEN.join(', ')})`);
    else if (key === 'command') {
      const cmds = [v].flat();
      if (!cmds.length || cmds.some((c) => !(PUSH_COMMANDS as readonly unknown[]).includes(c))) problems.push(`${at}: when.push.command is one or more of ${PUSH_COMMANDS.join(', ')}`);
    } else if (!word(v)) problems.push(`${at}: when.push.${key} is a name`);
    else if (key === 'works_on' && !known(v as string)) problems.push(`${at}: no type "${v}"`);
  }
  if (!rule.say || rule.say.length > SAY_MAX || /\n/.test(rule.say)) problems.push(`${at}: say is the one line it refuses with, ${SAY_MAX} characters at most`);
  return problems;
}

/** One thing a command would send out: what kind, and the branch it goes to. */
export interface Sent { command: PushCommand; to: string }

/** A command's words, quotes taken off: rough, as a shell would split them, enough to read a push by. */
const words = (part: string) => [...part.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
/** A git option that takes the next word as its value, before or after the subcommand. */
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '-o', '--push-option', '--repo', '--receive-pack', '--exec']);

/**
 * What a command would send out, read from its words: each git push (the branch its refspecs go to, or the checkout's
 * branch when it names none), gh pr create (its --base, else the default branch) and gh pr merge (the default branch:
 * the pull request's base is not in the command). The checkout's branch comes from the hook (stands.branch).
 */
export function readPush(command: string, branch?: string): Sent[] {
  const sent: Sent[] = [];
  for (const part of command.split(/&&|\|\||[;|&\n()]/)) {
    const w = words(part.trim());
    const g = w.indexOf('git');
    if (g >= 0) {
      let i = g + 1;
      while (i < w.length && w[i].startsWith('-')) i += GIT_VALUED.has(w[i]) ? 2 : 1;
      if (w[i] === 'push') {
        const args: string[] = [];
        for (let j = i + 1; j < w.length; j++) {
          if (w[j].startsWith('-')) { if (GIT_VALUED.has(w[j])) j++; continue; }
          args.push(w[j]);
        }
        const refspecs = args.slice(1);
        const tos = refspecs.length ? refspecs.map((r) => r.replace(/^\+/, '').split(':').at(-1)!) : [branch ?? ''];
        for (const to of tos) sent.push({ command: 'push', to: (to === 'HEAD' ? branch ?? '' : to).replace(/^refs\/heads\//, '') });
      }
      continue;
    }
    const h = w.indexOf('gh');
    if (h >= 0 && w[h + 1] === 'pr' && (w[h + 2] === 'create' || w[h + 2] === 'merge')) {
      const rest = w.slice(h + 3);
      const b = rest.findIndex((x) => x === '--base' || x === '-B');
      const eq = rest.find((x) => x.startsWith('--base='));
      const base = b >= 0 ? rest[b + 1] : eq?.slice('--base='.length);
      sent.push({ command: w[h + 2] === 'create' ? 'pr_create' : 'pr_merge', to: (w[h + 2] === 'create' && base) || DEFAULT_BRANCH });
    }
  }
  return sent;
}

/** What a session is, as a push rule reads it: the types of what it works on (each with its lineage) and the titles and ids of what it holds. */
export interface PushSession { works_on: string[]; holds: string[] }

/** Whether a push rule's when holds of one thing sent, by a session: every fact it names. */
export function pushHolds(rule: RuleDef, sent: Sent, session: PushSession): boolean {
  const push = rule.when?.push ?? {};
  return Object.entries(push).every(([key, v]) => {
    if (key === 'command') return [v].flat().includes(sent.command);
    if (key === 'to') return sent.to === v;
    if (key === 'works_on') return session.works_on.includes(v as string);
    if (key === 'lacks') return !session.holds.includes(String(v).toLowerCase());
    return false;
  });
}

/** What the rules refuse of a command, one rule a line, each with what it refused: none when nothing holds. */
export function refusals(rules: RuleDef[], sent: Sent[], session: PushSession): { rule: RuleDef; sent: Sent }[] {
  const out: { rule: RuleDef; sent: Sent }[] = [];
  for (const rule of rules.filter(onPush)) {
    const hit = sent.find((s) => pushHolds(rule, s, session));
    if (hit) out.push({ rule, sent: hit });
  }
  return out;
}

const said = (s: Sent) => (s.command === 'push' ? `git push to ${s.to || 'its branch'}` : `gh pr ${s.command === 'pr_create' ? 'create' : 'merge'} into ${s.to}`);

/** The hook's body at a push: the command, and where the checkout stands. */
export interface PushBody { session_id?: string; command?: unknown; stands?: unknown }

/**
 * The answer to a push: the rules on it that hold refuse it, their says one a line, and each refusal is told on the
 * session's story as `refused`. Undefined, letting it through, for a command that sends nothing out, a session that is
 * not registered, or no rule that holds.
 */
export async function pushAnswer(ctx: KernelContext, body: PushBody): Promise<{ refuse: string } | undefined> {
  if (typeof body.command !== 'string' || !body.session_id) return undefined;
  const branch = (body.stands as { branch?: unknown } | undefined)?.branch;
  const sent = readPush(body.command, typeof branch === 'string' ? branch : undefined);
  const rules = (ctx.registry.rules as (RuleDef & { pack: string })[]).filter(onPush);
  if (!sent.length || !rules.length) return undefined;
  const run = await resolveRun(ctx, body.session_id, true);
  if (!run) return undefined;
  const link = async (type: string) => (await ctx.reads({ links: { from: [run.id], types: [type] } })) as { to_id: string }[];
  const ids = async (type: string) => (await link(type)).map((l) => l.to_id);
  const items = async (list: string[]) => (list.length ? ((await ctx.reads({ ids: list })) as Item[]) : []);
  const working = await items(await ids('works_on'));
  const held = await items(await ids('holds'));
  const session: PushSession = {
    works_on: [...new Set(working.flatMap((w) => ctx.registry.types.get(w.type)?.lineage ?? [w.type]))],
    holds: held.flatMap((h) => [h.id, h.title.toLowerCase()]),
  };
  const refused = refusals(rules, sent, session);
  if (!refused.length) return undefined;
  for (const { rule, sent: s } of refused) {
    await befell(ctx, { run: run.id, did: 'refused', said: `Refused ${said(s)}: ${rule.say}`, about: working.map((w) => w.id), by: rule.pack ?? 'sessions' });
  }
  return { refuse: refused.map((r) => r.rule.say!).join('\n') };
}
