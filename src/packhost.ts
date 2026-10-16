// The pack host: each pack's handler runs in a process of its own under node --permission, with an empty
// environment, read access to its own folder and nothing else, and limits on memory and time. One process per pack
// per workspace, taking calls one at a time, killed when a call overruns and started again for the next. The handler
// never writes: it reads the map as the actor (under row-level security, like any of the actor's reads) and answers
// with ops, which the kernel applies as one change set naming the action, under the workspace's policy.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Actor, Archipelago, Op } from './pelago.ts';
import { VIEWS } from './views.ts';

const RUNNER = join(import.meta.dirname, 'pack-runner.ts');
/** How long a call may take unless its pack says otherwise, and the most it may say. */
export const CALL_MS = 2000;
const MAX_MS = 30_000;
const MEMORY_MB = 64;
/** The most items one read gives back. */
const READ_LIMIT = 500;

export interface Done {
  ops?: Op[];
  answer?: unknown;
  reason?: string;
}

type Read = { get?: string; items?: { type: string; status?: string; where?: Record<string, unknown> }; related?: string; relation?: string; direction?: 'out' | 'in'; view?: string; params?: Record<string, unknown> };

/** Answer one read from a handler, as the actor the call is made for. */
async function answerRead(l: Archipelago, q: Read): Promise<unknown> {
  if (q.get !== undefined) return (await l.entity(q.get)) ?? null;
  if (q.items) {
    const { type, status, where } = q.items;
    const { rows } = await l.db.query(
      `select * from entity where type = any($1::text[]) and archived_at is null and ($2::text is null or status = $2) and props @> $3::jsonb order by created_at limit ${READ_LIMIT}`,
      [l.registry.family(type), status ?? null, JSON.stringify(where ?? {})],
    );
    return rows;
  }
  if (q.related !== undefined) {
    const [near, far] = q.direction === 'in' ? ['to_id', 'from_id'] : ['from_id', 'to_id'];
    const { rows } = await l.db.query(
      `select e.* from relation r join entity e on e.id = r.${far} where r.${near} = $1 and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null limit ${READ_LIMIT}`,
      [q.related, l.registry.relationFamily(q.relation ?? 'relates_to')],
    );
    return rows;
  }
  if (q.view !== undefined) {
    const view = VIEWS[q.view];
    if (!view) throw new Error(`No view "${q.view}"`);
    return view.run(l, q.params ?? {});
  }
  throw new Error('A read is one of: get, items, related, view.');
}

/** One pack's process, started when first called. */
/** A running process, with the calls waiting on it: they end with it. */
interface Proc {
  child: ChildProcess;
  waiting: Map<number, (line: Record<string, unknown>) => void>;
  stderr: string;
}

class Sandbox {
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
    const proc: Proc = { child, waiting: new Map(), stderr: '' };
    child.stderr!.on('data', (chunk) => (proc.stderr = (proc.stderr + chunk).slice(-2000)));
    createInterface({ input: child.stdout! }).on('line', (text) => {
      let line: Record<string, unknown>;
      try {
        line = JSON.parse(text);
      } catch {
        return;
      }
      proc.waiting.get(line.id as number)?.(line);
    });
    child.on('exit', () => {
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
  call(l: Archipelago, message: Record<string, unknown>, ms: number): Promise<Done> {
    const run = async (): Promise<Done> => {
      const { child, waiting } = (this.proc ??= this.start());
      const id = ++this.seq;
      return new Promise<Done>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          this.stop();
          reject(new Error(`"${message.name}" took longer than ${ms} ms and was stopped.`));
        }, ms);
        const finish = (fn: () => void) => {
          clearTimeout(timer);
          waiting.delete(id);
          fn();
        };
        waiting.set(id, (line) => {
          if (line.error !== undefined && line.read === undefined) return finish(() => reject(new Error(String(line.error))));
          if (line.done !== undefined) return finish(() => resolve(line.done as Done));
          if (typeof line.read === 'number') {
            const { id: _, read, ...query } = line;
            answerRead(l, query as Read).then(
              (result) => child.stdin!.write(JSON.stringify({ id, read, result }) + '\n'),
              (err) => child.stdin!.write(JSON.stringify({ id, read, error: (err as Error).message }) + '\n'),
            );
          }
        });
        child.stdin!.write(JSON.stringify({ id, ...message }) + '\n');
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

  /** Call one entry of a pack's handler and give back what it answered, writing nothing. */
  async call(l: Archipelago, actor: Actor, pack: string, call: 'action' | 'view', name: string, input: unknown, ms = CALL_MS): Promise<Done> {
    const folder = this.folderOf(pack);
    if (!existsSync(join(folder, 'handler.js'))) throw new Error(`Pack "${pack}" has no handler.`);
    const box = this.boxes.get(pack) ?? new Sandbox(folder);
    this.boxes.set(pack, box);
    const present = l.registry.packs.map((p) => p.id);
    return box.call(l, { call, name, input, actor: { name: actor.name, kind: actor.kind }, now: new Date().toISOString(), present }, Math.min(ms, MAX_MS));
  }

  /** Run an action: its handler answers ops, and the kernel applies them as one change set with the action's name. */
  async act(l: Archipelago, actor: Actor, pack: string, name: string, input: unknown, ms?: number) {
    const done = await this.call(l, actor, pack, 'action', name, input, ms);
    if (!done.ops?.length) return { answer: done.answer ?? null };
    const changed = await l.change(actor, { ops: done.ops, reason: done.reason?.trim() || `${name}`, action: name });
    return { answer: done.answer ?? null, ...changed };
  }

  stop(): void {
    for (const box of this.boxes.values()) box.stop();
    this.boxes.clear();
  }
}
