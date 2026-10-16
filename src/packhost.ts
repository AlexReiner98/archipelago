// The pack host: each pack's handler runs in a process of its own under node --permission, with an empty
// environment, read access to its own folder and nothing else, and limits on memory and time. One process per pack
// per workspace, taking calls one at a time, killed when a call overruns and started again for the next. The handler
// never writes: it reads the map as the actor (under row-level security, like any of the actor's reads) and answers
// with ops, which the kernel applies as one change set naming the action, under the workspace's policy.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { handleRequests, type OutsideRequest } from './outside.ts';
import { answerRead, type Read } from './packreads.ts';
import type { Actor, Archipelago, Op } from './pelago.ts';
// Anyone with no login cannot read the workspace's settings: a public page is counted in the default zone.
import { DEFAULT_ZONE, zoneOf } from './timeaxis.ts';

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
}

export type Call = 'action' | 'view' | 'answer' | 'webhook' | 'schedule';

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
    // An idle pack's process does not keep the kernel running: a call waiting on it does, by its timer.
    child.unref();
    for (const pipe of [child.stdin, child.stdout, child.stderr]) (pipe as unknown as { unref?: () => void } | null)?.unref?.();
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
  async call(l: Archipelago, actor: Actor, pack: string, call: Call, name: string, input: unknown, ms = CALL_MS): Promise<Done> {
    const folder = this.folderOf(pack);
    if (!existsSync(join(folder, 'handler.js'))) throw new Error(`Pack "${pack}" has no handler.`);
    const box = this.boxes.get(pack) ?? new Sandbox(folder);
    this.boxes.set(pack, box);
    const present = l.registry.packs.map((p) => p.id);
    return box.call(l, { call, name, input, actor: { name: actor.name, kind: actor.kind }, now: new Date().toISOString(), zone: await zoneOf(l).catch(() => DEFAULT_ZONE), present }, Math.min(ms, MAX_MS));
  }

  /**
   * Run a handler entry that may write: its ops are applied as one change set naming it, and what it asks of the
   * world outside is made, held or refused. Only an action may act; a webhook or a schedule may only read.
   */
  async act(l: Archipelago, actor: Actor, pack: string, name: string, input: unknown, ms?: number, call: 'action' | 'webhook' | 'schedule' = 'action') {
    const done = await this.call(l, actor, pack, call, name, input, ms);
    const changed = done.ops?.length ? await l.change(actor, { ops: done.ops, reason: done.reason?.trim() || `${name}`, action: name }) : undefined;
    const file = l.registry.packs.find((p) => p.id === pack)!;
    const action = call === 'action' ? file.actions?.find((a) => a.id === name) : undefined;
    const outside = done.requests?.length ? await handleRequests(this, l, actor, file, action, done.requests, (changed as { changeset?: string } | undefined)?.changeset) : undefined;
    return { answer: done.answer ?? null, ...changed, ...(outside && { requests: outside }) };
  }

  stop(): void {
    for (const box of this.boxes.values()) box.stop();
    this.boxes.clear();
  }
}
