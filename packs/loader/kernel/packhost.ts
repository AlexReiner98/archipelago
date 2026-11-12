// The pack host: each pack's handler runs in a process of its own under node --permission, with an empty
// environment, read access to its own folder and nothing else, and limits on memory and time. One process per pack
// per workspace, taking calls one at a time, killed when a call overruns and started again for the next. The handler
// never writes: it reads the map as the actor (under row-level security, like any of the actor's reads) and answers
// with ops, which the kernel applies as one change set naming the action, under the workspace's policy.

import { spawn, type ChildProcess } from 'node:child_process';
import { parts } from './manifest.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { notify } from '../../../src/notify.ts';
import { mailHeard, type NotificationMail } from '../../../src/notify-mail.ts';
import { handleRequests, type OutsideRequest } from '../../../src/outside.ts';
import { launchHeard, type LaunchAsked } from './pack-launch.ts';
import { launchesAsked, launchesRefused, type LaunchesAsked } from './pack-action-launch.ts';
import { answerBeyond, holdWorkspace, NOT_BEYOND } from './pack-reach.ts';
import type { PackFile } from './packs.ts';
import type { Read } from '../../surface/kernel/packreads.ts';
import { actorId, type Actor, type Archipelago, type Op, type SourceSpec } from '../../../src/pelago.ts';
// Anyone with no login cannot read the workspace's settings: a public page is counted in the default zone.
import { DEFAULT_ZONE, zoneOf } from '../../../src/timeaxis.ts';

/**
 * The slot `loader.reads` (docs/kernel-packs.md, "Slots"): the reads API is surface's (packs/surface/kernel/packreads.ts),
 * which fills this when it loads, so a sandboxed pack's reads are answered without the loader importing above it.
 */
let reads: ((l: Archipelago, read: Read) => Promise<unknown>) | undefined;
export const fillReads = (answer: (l: Archipelago, read: Read) => Promise<unknown>): void => void (reads = answer);
const answerRead = async (l: Archipelago, read: Read): Promise<unknown> => {
  if (!reads) throw new Error('No reads API is loaded: the loader slot loader.reads is filled by surface (src/packreads.ts).');
  return reads(l, read);
};

const RUNNER = join(import.meta.dirname, 'pack-runner.ts');
/** How long a call may take unless its pack says otherwise, and the most it may say. */
export const CALL_MS = 2000;
const MAX_MS = 30_000;
const MEMORY_MB = 64;

export interface Done {
  ops?: Op[];
  answer?: unknown;
  reason?: string;
  /** What it asks to have done outside the map, by the kernel. */
  requests?: OutsideRequest[];
  /** Items whose kept pictures no longer show what they are, removed once its ops are applied. */
  drop_pictures?: string[];
  /** Further changes, each a change set of its own with its reason, authority and source: each is held or applied on its own. */
  changes?: { ops: Op[]; reason: string; authority?: { of: 'human' | 'agent'; basis: string }; source?: SourceSpec }[];
  /**
   * What it records in the log beside its changes: only the kinds of event its pack declares. A {ref} in its detail is
   * the id of the notification of that ref; when that notification could not be made, `otherwise` is recorded in its
   * place (its reason and detail over the entry's, {error} in either the reason it failed).
   */
  log?: LogEntry[];
  /** What the owner is told; a notification with a ref is named by it in what is logged. */
  notify?: { title: string; body?: string; level?: 'info' | 'warning' | 'urgent'; about?: string; ref?: string }[];
  /** On hearing a notification made: one mail about it, to its person (src/notify-mail.ts). */
  mail?: NotificationMail[];
  /** On hearing an automation come due: the session it says to start, started by the kernel (src/pack-launch.ts). */
  launch?: LaunchAsked;
  /** On a person calling its action, where its manifest asks for reach.launch: the sessions to start, ten at most (src/pack-action-launch.ts). */
  launches?: LaunchesAsked[];
}

export interface LogEntry {
  action: string;
  target?: string;
  reason?: string;
  detail?: Record<string, unknown>;
  otherwise?: { reason?: string; detail?: Record<string, unknown> };
}

/** What is asked of an action's ops before they are applied: a token limited to some work is held to it. */
export type Check = (done: Done) => Promise<void>;

export type Call = 'action' | 'view' | 'answer' | 'webhook' | 'schedule' | 'event';

/** One pack's process, started when first called. */
/** A running process, with the calls waiting on it: they end with it. */
interface Proc {
  child: ChildProcess;
  waiting: Map<number, (line: Record<string, unknown>) => void>;
  stderr: string;
  /** Settled once its handler is loaded: a call's clock starts then, so a slow start on a busy machine is not its time. */
  ready: Promise<void>;
}

/**
 * A call's clock: it runs while the handler has the call and stops while the kernel answers what it read, so a
 * limit is the handler's own time, not the kernel's under load. A handler that hangs still runs out of it, and one
 * that reads without end runs out of the most any call may take, read time and all.
 */
function clock(ms: number, out: () => void) {
  let left = ms;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
    left -= Date.now() - since;
  };
  const whole = setTimeout(() => (pause(), out()), Math.max(ms, MAX_MS));
  const run = () => {
    if (timer) return;
    since = Date.now();
    timer = setTimeout(() => (clearTimeout(whole), out()), Math.max(0, left));
  };
  const stop = () => (pause(), clearTimeout(whole));
  return { run, pause, stop };
}

/** What a call may ask the kernel while it runs: a workspace pack reads the map; a server pack asks for acts and its store. */
export type Answerer = (query: Record<string, unknown>) => Promise<unknown>;

export class Sandbox {
  private proc?: Proc;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;

  readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
  }

  private start(): Proc {
    const handler = join(this.folder, 'handler.js');
    const child = spawn(
      process.execPath,
      ['--permission', `--allow-fs-read=${this.folder}`, `--allow-fs-read=${RUNNER}`, `--max-old-space-size=${MEMORY_MB}`, RUNNER, handler],
      { env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    // An idle pack's process does not keep the kernel running: a call waiting on it does, by its timer.
    child.unref();
    for (const pipe of [child.stdin, child.stdout, child.stderr]) (pipe as unknown as { unref?: () => void } | null)?.unref?.();
    let loaded!: () => void;
    let failed!: (err: Error) => void;
    const ready = new Promise<void>((resolve, reject) => ((loaded = resolve), (failed = reject)));
    ready.catch(() => undefined);
    // A handler that never finishes loading is stopped all the same, at the most any call may take.
    const starting = setTimeout(() => (failed(new Error(`The pack's handler did not load in ${MAX_MS} ms.`)), child.kill()), MAX_MS);
    const proc: Proc = { child, waiting: new Map(), stderr: '', ready };
    child.stderr!.on('data', (chunk) => (proc.stderr = (proc.stderr + chunk).slice(-2000)));
    createInterface({ input: child.stdout! }).on('line', (text) => {
      let line: Record<string, unknown>;
      try {
        line = JSON.parse(text);
      } catch {
        return;
      }
      if (line.ready === true) return (clearTimeout(starting), loaded());
      proc.waiting.get(line.id as number)?.(line);
    });
    child.on('exit', () => {
      clearTimeout(starting);
      failed(new Error(`The pack's process ended${proc.stderr ? `: ${proc.stderr.trim().split('\n').at(-1)}` : ''}`));
      if (this.proc === proc) this.proc = undefined;
      for (const settle of proc.waiting.values()) settle({ error: `The pack's process ended${proc.stderr ? `: ${proc.stderr.trim().split('\n').at(-1)}` : ''}` });
      proc.waiting.clear();
    });
    return proc;
  }

  stop(): void {
    this.proc?.child.kill();
    this.proc = undefined;
  }

  /** Make one call; calls to one pack are taken one at a time. */
  call(l: Archipelago | Answerer, message: Record<string, unknown>, ms: number): Promise<Done> {
    const answer: Answerer = typeof l === 'function' ? l : (query) => answerRead(l, query as Read);
    const run = async (): Promise<Done> => {
      const { child, waiting, ready } = (this.proc ??= this.start());
      await ready;
      const id = ++this.seq;
      return new Promise<Done>((resolve, reject) => {
        const timer = clock(ms, () => {
          waiting.delete(id);
          this.stop();
          reject(new Error(`"${message.name}" took longer than ${ms} ms and was stopped.`));
        });
        const finish = (fn: () => void) => {
          timer.stop();
          waiting.delete(id);
          fn();
        };
        // Reads asked at once are answered side by side: the clock runs again when none is left to answer.
        let reading = 0;
        const answered = (line: Record<string, unknown>) => {
          if (!waiting.has(id)) return; // stopped meanwhile
          child.stdin!.write(JSON.stringify(line) + '\n');
          if (--reading === 0) timer.run();
        };
        waiting.set(id, (line) => {
          if (line.error !== undefined && line.read === undefined) return finish(() => reject(new Error(String(line.error))));
          if (line.done !== undefined) return finish(() => resolve(line.done as Done));
          if (typeof line.read === 'number') {
            const { id: _, read, ...query } = line;
            if (reading++ === 0) timer.pause();
            answer(query).then(
              (result) => answered({ id, read, result }),
              (err) => answered({ id, read, error: (err as Error).message }),
            );
          }
        });
        child.stdin!.write(JSON.stringify({ id, ...message }) + '\n');
        timer.run();
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/** The processes of one workspace's packs. */
export class PackHost {
  private boxes = new Map<string, Sandbox>();

  private readonly folderOf: (pack: string) => string;

  constructor(folderOf: (pack: string) => string) {
    this.folderOf = folderOf;
  }

  /**
   * Call one entry of a pack's handler and give back what it answered, writing nothing. While it runs it reads the map
   * and what its pack reads through (src/pack-reach.ts); `answer` may answer some questions first (a run's tools).
   */
  async call(l: Archipelago, actor: Actor, pack: string, call: Call, name: string, input: unknown, ms = CALL_MS, answer?: (query: Record<string, unknown>, reads: Answerer) => Promise<unknown>): Promise<Done> {
    // A root or service pack's code runs in the server's process (src/kernel-context.ts), never here.
    if (l.registry.internal.has(pack)) throw new Error(`Pack "${pack}" runs in the server's process, not the sandbox.`);
    const folder = this.folderOf(pack);
    if (!existsSync(join(folder, 'handler.js'))) throw new Error(`Pack "${pack}" has no handler.`);
    const box = this.boxes.get(pack) ?? new Sandbox(folder);
    this.boxes.set(pack, box);
    const present = l.registry.packs.map((p) => p.id);
    const file = l.registry.packs.find((p) => p.id === pack);
    const reads: Answerer = async (q) => {
      const beyond = file ? await answerBeyond(l, file, q) : NOT_BEYOND;
      return beyond === NOT_BEYOND ? answerRead(l, q as Read) : beyond;
    };
    const ask: Answerer = answer ? async (q) => answer(q, reads) : reads;
    return box.call(ask, { call, name, input, actor: { name: actor.name, kind: actor.kind }, now: new Date().toISOString(), zone: await zoneOf(l).catch(() => DEFAULT_ZONE), present }, Math.min(ms, MAX_MS));
  }

  /**
   * Run a handler entry that may write: its ops are applied as one change set naming it, and what it asks of the
   * world outside is made, held or refused. Only an action may act; a webhook or a schedule may only read. A {ref}
   * in its answer is the id of what its change made.
   */
  async act(l: Archipelago, actor: Actor, pack: string, name: string, input: unknown, ms?: number, call: 'action' | 'webhook' | 'schedule' | 'event' = 'action', check?: Check) {
    const done = await this.call(l, actor, pack, call, name, input, ms);
    await check?.(done);
    const file = l.registry.packs.find((p) => p.id === pack)!;
    // Refused whole, before anything is written: an event of a kind its pack does not declare.
    for (const e of done.log ?? []) if (!parts(file).events.includes(e.action)) throw new Error(`The ${pack} pack declares no event "${e.action}"`);
    const action = call === 'action' ? parts(file).actions.find((a) => a.id === name) : undefined;
    const refused = done.launches !== undefined ? launchesRefused(file, actor, action, done.launches) : undefined;
    if (refused) throw new Error(refused);
    const mailed = done.mail?.length ? await mailHeard(l, pack, call === 'event' ? input : undefined, done.mail) : undefined;
    const launched = done.launch ? await launchHeard(l, pack, call === 'event' ? input : undefined, done.launch) : undefined;
    const launches = done.launches !== undefined ? await launchesAsked(l, file, actor, action, done.launches) : undefined;
    const changed = done.ops?.length ? await l.change(actor, { ops: done.ops, reason: done.reason?.trim() || `${name}`, action: name, pack, ...islandIn(input) }) : undefined;
    const outside = done.requests?.length ? await handleRequests(this, l, actor, file, action, done.requests, (changed as { changeset?: string } | undefined)?.changeset) : undefined;
    const made = (changed as { created?: Record<string, string> } | undefined)?.created ?? {};
    const answer = done.answer === undefined ? null : JSON.parse(JSON.stringify(done.answer).replace(/\{([^{}\s"]+)\}/g, (whole, ref: string) => made[ref] ?? whole));
    const dropped = changed?.status === 'applied' && done.drop_pictures?.length ? await dropPictures(l, actor, done.drop_pictures, done.reason?.trim() || name) : undefined;
    // What it logged may name the run it launched as {run}; one not started is the failure of what names it.
    const ran = launched ? (launched.run ? { made: { run: launched.run } } : { failed: { run: launched.why ?? 'not started' } }) : {};
    const { logged, others } = await further(l, actor, file, name, done, input, ran);
    for (const e of logged) this.tell(l, file.id, e);
    return { answer, ...changed, ...(mailed && { mailed }), ...(launched && { launched }), ...(launches && { launches }), ...(outside && { requests: outside }), ...(dropped !== undefined && { pictures_removed: dropped }), ...(others.length && { changes: others }) };
  }

  /**
   * Tell the packs that hear a kind of event that another pack recorded one (or the kernel, from "kernel": an item.due
   * from its clock, src/due.ts, or a notification.made, src/notify.ts), each at its entry of that name, as
   * itself. Not waited for: what records it (a webhook) answers its sender now. What each answers is applied like
   * any of its calls; it may only read beyond the map.
   */
  tell(l: Archipelago, from: string, e: Omit<LogEntry, 'otherwise'> & { seq?: number }): void {
    for (const pack of l.registry.packs) {
      const hears = pack.id !== from && parts(pack).hears.find((h) => h.event === e.action);
      if (!hears) continue;
      const release = holdWorkspace(l.workspace);
      void this.act(l, { kind: 'agent', name: `pack:${pack.id}` }, pack.id, e.action, { event: { ...e, pack: from } }, hears.limit_ms, 'event')
        .catch((err) => console.error(`${pack.id} hearing ${e.action}: ${(err as Error).message}`))
        .finally(release);
    }
  }

  stop(): void {
    for (const box of this.boxes.values()) box.stop();
    this.boxes.clear();
  }
}

/**
 * What a call answered beyond its own ops: the events it records (of the kinds its pack declares, checked first), what the owner is
 * told, and further change sets, each with its own reason, so a person approves or declines each on its own.
 */
async function further(l: Archipelago, actor: Actor, file: PackFile, name: string, done: Done, input: unknown, ran: { made?: Record<string, string>; failed?: Record<string, string> } = {}) {
  // Made first, so what is logged can name them: one with a ref that fails is the failure of what names it, not the call's.
  const made: Record<string, string> = { ...ran.made };
  const failed: Record<string, string> = { ...ran.failed };
  for (const { ref, ...n } of done.notify ?? []) {
    if (!ref) await notify(l, actor, n);
    else await notify(l, actor, n).then((r) => (made[ref] = r.notification), (err: Error) => (failed[ref] = err.message));
  }
  const logged = (done.log ?? []).map((e) => resolved(e, made, failed));
  for (const e of logged) {
    await l.log(l.db, { actor: actorId(actor), action: e.action, target: e.target, reason: e.reason, detail: { ...e.detail, pack: file.id } });
  }
  const others = [];
  for (const c of done.changes ?? []) {
    const result = await l.change(actor, { ops: c.ops, reason: c.reason?.trim() || name, action: name, pack: file.id, ...islandIn(input), ...(c.authority && { authority: c.authority }), ...(c.source && { source: c.source }) });
    others.push({ status: result.status, ...('changeset' in result && { changeset: result.changeset }), ...('proposal' in result && { proposal: result.proposal }) });
  }
  return { logged, others };
}

const REF = /\{([^{}\s"]+)\}/g;

/**
 * A logged event as recorded: each {ref} in it the id of what was made of that ref, or, when a ref it names failed,
 * its `otherwise` in place, {error} the reason, and what failed named in no list. Exported for its test.
 */
export function resolved(e: LogEntry, made: Record<string, string>, failed: Record<string, string>): Omit<LogEntry, 'otherwise'> {
  const { otherwise, ...entry } = e;
  const text = JSON.stringify(entry);
  const error = [...text.matchAll(REF)].map((m) => failed[m[1]]).find((x) => x !== undefined);
  const fill = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(REF, (whole, ref: string) => made[ref] ?? (ref === 'error' && error !== undefined ? JSON.stringify(error).slice(1, -1) : whole)));
  if (error === undefined) return fill(entry);
  const drop = (v: unknown): unknown => (Array.isArray(v) ? v.filter((x) => !(typeof x === 'string' && [...x.matchAll(REF)].some((m) => m[1] in failed))).map(drop) : v);
  const detail = Object.fromEntries(Object.entries({ ...entry.detail, ...otherwise?.detail }).map(([k, v]) => [k, drop(v)]));
  return fill({ ...entry, reason: otherwise?.reason ?? entry.reason, detail });
}

/** The island an action was given, as its input `island`: where what it makes goes, on a map of islands, when nothing it is tied to says. */
const islandIn = (input: unknown): { island?: string } => {
  const island = (input as { island?: unknown } | null)?.island;
  return typeof island === 'string' && island ? { island } : {};
};

/** Remove the kept pictures of these items, those the actor can see, each logged. */
async function dropPictures(l: Archipelago, actor: Actor, ids: string[], reason: string): Promise<number> {
  const { rows } = await l.db.query<{ entity_id: string }>(`delete from picture where entity_id = any($1::text[]) and entity_id in (select id from entity) returning entity_id`, [ids]);
  for (const row of rows) await l.log(l.db, { actor: actorId(actor), action: 'picture.removed', target: row.entity_id, reason });
  return rows.length;
}
