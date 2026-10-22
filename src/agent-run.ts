// A model run a pack asks for (src/pack-reach.ts): the kernel asks the workspace's model account (or the server's
// model) and answers each tool the model calls, until it has nothing more to ask or has used what a run may. The
// pack's own tools are answered by its handler's entry "tool", which reads the map and answers changes; the map's
// tools it declares are called as they are. Either way what is written goes through the map's tools as the run's
// agent: named for the pack, acting for the workspace's owner, held to what the run is within, and, unless a person
// asked for it, with its changes waiting for the owner. What each run used is recorded as a run where it was held.

import { z } from 'zod';
import { connection, NO_MODEL } from './model-account.ts';
import { ModelError, type Tool, type ToolResultBlock, type ToolUseBlock, type Turn } from './model.ts';
import { holdWorkspace, setRunner, type RunAsk, type RunStart } from './pack-reach.ts';
import type { Done } from './packhost.ts';
import type { PackFile } from './packs.ts';
import { hostFor } from './packtools.ts';
import type { Actor, Archipelago } from './pelago.ts';
import type { StartedBy } from './launcher.ts';
import { recordRun } from './sessions.ts';
import { callTool, TOOLS } from './tools.ts';

/** A run stops when it has taken this many turns or used this many tokens (not counting cached re-reads). */
const MAX_TURNS = 40;
const MAX_TOKENS_USED = 600_000;
/** The most of one tool's answer that is handed back: a whole file or diff can be far more than is needed. */
const MAX_RESULT = 60_000;
/** How long the pack's handler may take over one of its tools. */
const TOOL_MS = 30_000;
/** How long a run taken by its once may go without ending before another may take it: one cut off when its server stopped. */
const ONCE_MINUTES = 30;
/** The map's tools that only read, which a pack's own tool may also call while it answers. */
const READS = ['view', 'search', 'get', 'events', 'schema', 'proposals'];
const NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** What a run is asked to do, checked: the kernel's own limits, and only the map's tools its pack declares. */
function checked(pack: PackFile, r: RunAsk): RunAsk {
  const text = (v: unknown, most: number, what: string) => {
    if (typeof v !== 'string' || !v.trim() || v.length > most) throw new Error(`A run needs ${what}, of ${most} characters at most.`);
    return v;
  };
  const tools = (r.tools ?? []).map((t) => {
    if (!NAME.test(t?.name ?? '') || typeof t.description !== 'string' || t.input_schema?.type !== 'object') throw new Error(`A run's tool is a name, a description and the JSON Schema of an object.`);
    return { name: t.name, description: t.description.slice(0, 2000), input_schema: t.input_schema };
  });
  const map = r.map_tools ?? [];
  for (const name of map) if (!(pack.runs ?? []).includes(name) || !TOOLS[name]) throw new Error(`The ${pack.id} pack may not offer a run the map's tool "${name}": it is not one of the tools it declares in runs.`);
  if (tools.length + map.length > 24 || new Set([...tools.map((t) => t.name), ...map]).size !== tools.length + map.length) throw new Error("A run's tools have names of their own, 24 at most.");
  if (!Array.isArray(r.within) || !r.within.length || r.within.some((id) => typeof id !== 'string')) throw new Error('A run is held to some items of the map (within).');
  if (r.once !== undefined) text(r.once, 200, 'once as a short key');
  return { ...r, title: text(r.title, 200, 'a title'), system: text(r.system, 40_000, 'its instructions'), task: text(r.task, 200_000, 'a task'), tools, map_tools: map };
}

/** Start each run a call asked for: refused when it is not well made or there is no model, else on its way. */
async function startRuns(l: Archipelago, asker: Actor, pack: PackFile, call: string, runs: RunAsk[]): Promise<RunStart[]> {
  if (!pack.runs) return runs.map((r) => ({ started: false, title: String(r.title), reason: `The ${pack.id} pack does not declare that it runs a model.` }));
  const out: RunStart[] = [];
  for (const given of runs) {
    let r: RunAsk;
    try {
      r = checked(pack, given);
    } catch (err) {
      out.push({ started: false, title: String(given?.title), reason: (err as Error).message });
      continue;
    }
    if (!(await connection(l))) {
      out.push({ started: false, title: r.title, reason: NO_MODEL });
      continue;
    }
    if (r.once && !(await takeOnce(l, pack, r.once))) {
      out.push({ started: false, title: r.title, reason: 'It is being run, or has been, already.' });
      continue;
    }
    // A person who asked for it stands behind what it changes; anything else (a push, a schedule) leaves its changes to the owner.
    const byHand = call === 'action' && asker.kind === 'human';
    const by: StartedBy | undefined = byHand ? undefined : { kind: call === 'schedule' ? 'automation' : 'webhook', name: String(r.by ?? `the ${pack.title} pack`).slice(0, 120) };
    const release = holdWorkspace(l.workspace);
    void run(l, pack, r, by)
      .then((done) => console.log(`${pack.id}: ${r.title}: ${done.ok ? 'done' : 'failed'}, ${done.tokens} tokens`))
      .catch((err) => console.error(`${pack.id}: ${r.title}: ${(err as Error).message}`))
      .finally(release);
    out.push({ started: true, title: r.title });
  }
  return out;
}
setRunner(startRuns);

const onceKey = (pack: PackFile, once: string) => `run_once:${pack.id}:${once}`;

/**
 * Take a run's once, kept in the workspace's database so the servers of one deploy share it: free, or taken by a run
 * that has neither ended nor been heard of for ONCE_MINUTES. Those taken more than a month ago are let go.
 */
async function takeOnce(l: Archipelago, pack: PackFile, once: string): Promise<boolean> {
  await l.db.query(`delete from setting where left(key, 9) = 'run_once:' and (value->>'at')::timestamptz < now() - interval '30 days'`);
  const { rows } = await l.db.query(
    `insert into setting (key, value) values ($1, jsonb_build_object('at', now(), 'done', false)) on conflict (key) do update set value = excluded.value
       where (setting.value->>'done')::boolean is not true and (setting.value->>'at')::timestamptz < now() - make_interval(mins => $2::int) returning key`,
    [onceKey(pack, once), ONCE_MINUTES],
  );
  return rows.length > 0;
}

/** Map the tools of a run onto the model's tool definitions. */
function definitions(r: RunAsk): Tool[] {
  return [
    ...(r.tools ?? []),
    ...(r.map_tools ?? []).map((name) => {
      const { $schema: _, ...schema } = z.toJSONSchema(z.object(TOOLS[name].input)) as Record<string, unknown>;
      return { name, description: TOOLS[name].description, input_schema: schema };
    }),
  ];
}

/** Answer one tool the model called: the map's as it is; the pack's by its handler, whose changes go through change. */
async function answerTool(l: Archipelago, actor: Actor, pack: PackFile, r: RunAsk, name: string, input: Record<string, unknown>): Promise<unknown> {
  if (r.map_tools?.includes(name)) return callTool(l, actor, name, input);
  if (!r.tools?.some((t) => t.name === name)) throw new Error(`No tool "${name}". The tools are: ${definitions(r).map((t) => t.name).join(', ')}.`);
  const done: Done = await hostFor(l.registry).call(l, actor, pack.id, 'tool', 'tool', { name, input, context: r.context }, TOOL_MS, async (q, reads) => {
    if (typeof q.tool !== 'string') return reads(q);
    if (!READS.includes(q.tool) || !(pack.runs ?? []).includes(q.tool)) throw new Error(`A tool of a run may call only the map's reads its pack declares, not "${q.tool}".`);
    return callTool(l, actor, q.tool, q.input ?? {});
  });
  const changes = [...(done.ops?.length ? [{ ops: done.ops, reason: done.reason ?? name }] : []), ...(done.changes ?? [])];
  const results = [];
  for (const c of changes) {
    const reason = String(c.reason ?? '').trim() || name;
    results.push(await callTool(l, actor, 'change', { reason, authority: 'authority' in c && c.authority ? c.authority : { of: 'agent', basis: reason }, ...('source' in c && c.source && { source: c.source }), ops: c.ops }));
  }
  return done.answer ?? (results.length === 1 ? results[0] : results);
}

/**
 * One run: the model is asked, what it asks for is done, and so on until it has nothing more to ask, or has used what
 * a run may. What it used is recorded as a run whether it ended well or not, and the pack is told how it ended.
 */
async function run(l: Archipelago, pack: PackFile, r: RunAsk, by: StartedBy | undefined) {
  const model = await connection(l);
  if (!model) return { ok: false, tokens: 0 };
  const me = await l.setting<string>('me');
  // It acts for the workspace's owner, as an agent's token does: it sees what they see, and what it makes is theirs.
  const mine = me ? l.as(me) : l;
  // Held to what it was asked about: what it reads there may be someone else's text, and text that tried to steer it
  // could reach nothing beyond. Started by a push or a schedule, not by the owner asking, what it changes waits for them.
  const actor: Actor = { kind: 'agent', name: pack.id, person: me, within: r.within, ...(by && { may: 'propose' as const }) };
  const tools = definitions(r);
  const messages: Turn[] = [{ role: 'user', content: r.task }];
  const used = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let turns = 0;
  let said = '';
  let failed: string | undefined;
  try {
    for (;;) {
      if (turns >= MAX_TURNS || used.input + used.output + used.cache_write > MAX_TOKENS_USED) {
        failed = `Stopped: it had taken ${turns} turns and ${used.input + used.output + used.cache_write} tokens, which is all one run may.`;
        break;
      }
      turns++;
      const answer = await model.ask({
        model: model.model,
        max_tokens: 16000,
        // The instructions and tools are the same for every run, and the conversation grows by its end: both are cached.
        cache_control: { type: 'ephemeral' },
        system: r.system,
        tools,
        output_config: { effort: 'medium' },
        // If the model declines on a safeguard, Anthropic's recommended substitute takes the request in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages,
      });
      used.input += answer.usage.input_tokens;
      used.output += answer.usage.output_tokens;
      used.cache_read += answer.usage.cache_read_input_tokens ?? 0;
      used.cache_write += answer.usage.cache_creation_input_tokens ?? 0;
      const text = answer.content.flatMap((b) => (b.type === 'text' ? [String(b.text)] : [])).join('\n').trim();
      if (text) said = text;
      if (answer.stop_reason === 'refusal') {
        failed = `The model declined to go on${answer.stop_details?.explanation ? `: ${answer.stop_details.explanation}` : '.'}`;
        break;
      }
      if (answer.stop_reason === 'max_tokens') {
        failed = 'Stopped: one answer ran past its length.';
        break;
      }
      messages.push({ role: 'assistant', content: answer.content });
      if (answer.stop_reason === 'pause_turn') continue;
      const calls = answer.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (answer.stop_reason !== 'tool_use' || !calls.length) break;
      // Every call of a turn is answered in one message, an error as an error: none is dropped.
      const results: ToolResultBlock[] = [];
      for (const call of calls) {
        try {
          const result = await answerTool(mine, actor, pack, r, call.name, (call.input ?? {}) as Record<string, unknown>);
          const out = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: out.length > MAX_RESULT ? `${out.slice(0, MAX_RESULT)}\n… (${out.length - MAX_RESULT} more characters not shown: ask for less at a time)` : out });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: (err as Error).message.slice(0, 4000) });
        }
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    // Said by kind, most particular first: what the owner can do about it differs.
    const who = model.name;
    if (err instanceof ModelError && err.kind === 'auth') failed = `${who} refused the key. ${model.from === 'server' ? 'The server’s model key needs looking at.' : 'Connect the account again on the Workspace page, under Model.'}`;
    else if (err instanceof ModelError && err.kind === 'rate') failed = `${who}’s rate limit was reached and the run gave up.`;
    else if (err instanceof ModelError) failed = `${who} answered ${err.status ?? 'with an error'}: ${err.message.slice(0, 300)}`;
    else failed = `The run broke: ${(err as Error).message.slice(0, 300)}`;
  }
  const tokens = used.input + used.output + used.cache_write;
  // Priced as the model it ran on is (the account's price, in US$ a million tokens); unknown, it is left out, never guessed.
  const price = model.price;
  const cost = price ? (used.input * price.input + used.output * price.output + used.cache_read * price.input * 0.1 + used.cache_write * price.input * 1.25) / 1e6 : undefined;
  const summary = [failed, said].filter(Boolean).join('\n\n');
  if (r.once) await l.db.query(`update setting set value = value || '{"done": true}'::jsonb where key = $1`, [onceKey(pack, r.once)]);
  const recorded = await recordRun(l, actor, { repo: r.within[0], title: r.title, ok: !failed, tokens, cost_usd: cost, turns, link: r.link, summary, surface: 'server', started_by: by });
  if (r.then) await ended(mine, actor, pack, r, { ok: !failed, summary, run: recorded.run, tokens, turns });
  return { ok: !failed, tokens };
}

/** Tell the pack how its run ended; it may answer calls of the map's tools it declares, made as the run's agent. */
async function ended(l: Archipelago, actor: Actor, pack: PackFile, r: RunAsk, outcome: Record<string, unknown>): Promise<void> {
  try {
    const done = await hostFor(l.registry).call(l, actor, pack.id, 'answer', r.then!, { ...outcome, context: r.context }, TOOL_MS);
    for (const c of done.calls ?? []) {
      if (!(pack.runs ?? []).includes(c.tool)) throw new Error(`"${c.tool}" is not one of the tools the ${pack.id} pack declares in runs.`);
      await callTool(l, actor, c.tool, c.input ?? {});
    }
  } catch (err) {
    console.error(`${pack.id}: after ${r.title}: ${(err as Error).message}`);
  }
}
