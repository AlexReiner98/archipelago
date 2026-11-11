// The server packs of one server, loaded once, each run in a sandboxed process of its own (src/packhost.ts). While
// a call runs, the handler may ask for a server act it declared (ctx.act), for its keys (ctx.store), or for a request
// to a host it declared (ctx.request), which the kernel makes with the secret it holds: nothing else. It reads no map.

import { storeGet, storeList, storePut, storeTake } from './control.ts';
import type { Q } from './db.ts';
import { Sandbox, type Answerer } from './packhost.ts';
import { runAct, type ActPlaces } from './server-acts.ts';
import { publishedAct } from './server-published.ts';
import { signinGate } from './server-gates.ts';
import { standingChanged } from './standing.ts';
import { connectAct, connectionOf, type Connection } from './server-connect.ts';
import { parts } from './manifest.ts';
import { loadServerPacks, PUBLIC_ACTS, type ServerAct, type ServerPack } from './server-packs.ts';
import { hostBase, hostRequest, type HostRequest } from './server-requests.ts';

/** How long a call may take unless its pack says otherwise, and the most it may say. */
const CALL_MS = 10_000;
const MOST_MS = 30_000;
const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
/** The most keys one list of a pack's store answers. */
const LIST_MOST = 1000;
/** The acts done in src/server-connect.ts, on a workspace that connected the pack. */
const CONNECT_ACTS = ['begun.get', 'begun.take', 'connection.make', 'connection.get', 'connection.drop', 'workspace.add', 'workspace.deliver'];

export class ServerPacks {
  readonly packs: ServerPack[];
  readonly refused: { folder: string; why: string[] }[];
  /** The address this server is reached at from outside, which a pack is told (ctx.origin). */
  origin = '';
  private boxes = new Map<string, Sandbox>();
  /** The calls each pack is in the middle of: a gate is not asked of a pack while it is (src/server-gates.ts). */
  private inCall = new Map<string, number>();
  private readonly at: ActPlaces;

  constructor(at: ActPlaces, dirs?: string[]) {
    this.at = at;
    ({ packs: this.packs, refused: this.refused } = loadServerPacks(dirs));
    for (const r of this.refused) console.error(`server pack in ${r.folder} left out: ${r.why.join('; ')}`);
  }

  find(id: string): ServerPack | undefined {
    return this.packs.find((p) => p.file.id === id);
  }

  /** The pack and its route that answer at an address it had before it was a pack. */
  aliased(path: string): string | undefined {
    for (const { file } of this.packs) if (file.reach.server.aliases?.[path]) return `/x/${file.id}/${file.reach.server.aliases[path]}`;
    return undefined;
  }

  /** Where a person with no account begins: the first page a pack marks start, by its address. */
  start(): string | undefined {
    for (const { file } of this.packs) {
      const page = file.reach.server.pages?.find((p) => p.start);
      if (page) return `/x/${file.id}/${page.id}`;
    }
    return undefined;
  }

  /** The control plane: the default workspace's database. */
  async control(): Promise<Q> {
    return (await this.at.get('default')).pelago.db;
  }

  /** A request to a host a pack declares, made by the kernel with what it holds for the pack. */
  async request(id: string, r: HostRequest): Promise<{ status: number; body: unknown }> {
    const pack = this.find(id);
    if (!pack) throw new Error(`No server pack "${id}".`);
    return hostRequest(await this.control(), pack.file, r);
  }

  /** A read a workspace pack makes through a host this pack lends, as that workspace's connection to it. */
  async lent(id: string, host: string, workspace: string, path: string): Promise<{ status: number; body: unknown }> {
    const pack = this.find(id);
    if (!pack?.file.reach.hosts?.some((h) => h.id === host && h.lend)) throw new Error(`The server pack "${id}" lends no host "${host}".`);
    const c = await connectionOf(await this.control(), id, workspace);
    if (!c) throw new Error(`This workspace has not connected ${pack.file.title}.`);
    return this.request(id, { host, path, as: c.id });
  }

  /** The connection a workspace made to a pack, if it has. */
  async connectionOf(id: string, workspace: string): Promise<Connection | undefined> {
    return this.find(id) ? connectionOf(await this.control(), id, workspace) : undefined;
  }

  /** Whether a pack is in the middle of a call. */
  busy(id: string): boolean {
    return (this.inCall.get(id) ?? 0) > 0;
  }

  /** Call one entry of a pack's handler (a public entry, a webhook, a schedule, or a gate the kernel asks at) and give back its answer. */
  async call(id: string, call: 'entry' | 'webhook' | 'schedule', name: string, input: unknown, ms = CALL_MS, gate = false): Promise<unknown> {
    const pack = this.find(id);
    if (!pack) throw new Error(`No server pack "${id}".`);
    const box = this.boxes.get(id) ?? new Sandbox(pack.folder);
    this.boxes.set(id, box);
    let wrote = false;
    const answer: Answerer = async (q) => {
      if (typeof q.act === 'string') {
        const input = (q.input ?? {}) as Record<string, unknown>;
        if (!(pack.file.reach.server.acts ?? []).includes(q.act as never)) throw new Error(`The pack "${id}" did not declare the act "${q.act}".`);
        if (PUBLIC_ACTS.includes(q.act as ServerAct)) return publishedAct(this.at, pack.file, q.act as ServerAct, input);
        if (CONNECT_ACTS.includes(q.act)) return connectAct(this.at, await this.control(), pack.file, q.act, input);
        return runAct(this.at, pack.file, q.act, input, (ask) => signinGate(this, ask, id), this.packs.map((p) => p.file));
      }
      if (q.request && typeof q.request === 'object') return this.request(id, q.request as HostRequest);
      if (q.store === 'list') {
        const prefix = String(q.prefix ?? '');
        if (!KEY.test(prefix)) throw new Error('A prefix is 1 to 200 letters, digits and _.:-');
        return storeList(await this.control(), id, prefix, Math.min(Math.max(Number(q.most) || LIST_MOST, 1), LIST_MOST));
      }
      if (typeof q.store === 'string') {
        const key = String(q.key ?? '');
        if (!KEY.test(key)) throw new Error('A key is 1 to 200 letters, digits and _.:-');
        if (q.store === 'get') return (await storeGet(await this.control(), id, key)) ?? null;
        // What a pack keeps may be what it says at its gates: asked afresh once it has written.
        wrote = q.store === 'take' || q.store === 'put' || wrote;
        if (wrote) standingChanged();
        if (q.store === 'take') return (await storeTake(await this.control(), id, key)) ?? null;
        if (q.store === 'put') return void (await storePut(await this.control(), id, key, q.value, typeof q.ms === 'number' && q.ms > 0 ? q.ms : undefined));
      }
      throw new Error('A server pack asks only for its acts, its hosts and its store: it reads no map.');
    };
    // A gate is asked by the kernel and asks for nothing: it is no call the pack is in the middle of.
    const counted = gate ? 0 : 1;
    this.inCall.set(id, (this.inCall.get(id) ?? 0) + counted);
    const done = await box.call(answer, { call, name, input, actor: { name: `pack:${id}`, kind: 'agent' }, now: new Date().toISOString(), zone: 'UTC', origin: this.origin, hosts: Object.fromEntries((pack.file.reach.hosts ?? []).map((h) => [h.id, hostBase(id, h)])), present: [] }, Math.min(ms, MOST_MS)).finally(() => {
      this.inCall.set(id, this.inCall.get(id)! - counted);
      if (wrote) standingChanged();
    });
    return done.answer ?? null;
  }

  /** Run the schedules of every pack: each once now, then every so many minutes. Answers what stops them. */
  runSchedules(): () => void {
    const timers: NodeJS.Timeout[] = [];
    for (const { file } of this.packs)
      for (const s of parts(file).schedules) {
        const run = () => void this.call(file.id, 'schedule', s.id, {}, s.limit_ms).catch((err) => console.error(`server pack ${file.id} schedule ${s.id}: ${(err as Error).message}`));
        run();
        timers.push(setInterval(run, (s.every_minutes ?? 60) * 60_000).unref());
      }
    return () => timers.forEach(clearInterval);
  }

  stop(): void {
    for (const box of this.boxes.values()) box.stop();
    this.boxes.clear();
  }
}

/** The server packs of a server, by the workspaces it holds: loaded when first asked for. */
const loaded = new WeakMap<object, ServerPacks>();
export function serverPacksOf(at: ActPlaces): ServerPacks {
  let packs = loaded.get(at);
  if (!packs) loaded.set(at, (packs = new ServerPacks(at)));
  return packs;
}
