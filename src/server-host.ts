// The server packs of one server, loaded once, each run in a sandboxed process of its own (src/packhost.ts). While
// a call runs, the handler may ask for a server act it declared (ctx.act), for its keys (ctx.store), or for a request
// to a host it declared (ctx.request), which the kernel makes with the secret it holds: nothing else. It reads no map.

import { agreementsFrom, type Agreement } from './agreements.ts';
import { storeGet, storePut, storeTake } from './control.ts';
import type { Q } from './db.ts';
import { Sandbox, type Answerer } from './packhost.ts';
import { runAct, type ActPlaces } from './server-acts.ts';
import { connectAct, connectionOf, type Connection, type Delivered } from './server-connect.ts';
import { loadServerPacks, type ServerPack } from './server-packs.ts';
import { hostBase, hostRequest, type HostRequest } from './server-requests.ts';

/** How long a call may take unless its pack says otherwise, and the most it may say. */
const CALL_MS = 10_000;
const MOST_MS = 30_000;
const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
/** How long the documents in force are taken as they were last answered. */
const AGREEMENTS_MS = 60_000;
/** The acts done in src/server-connect.ts, on a workspace that connected the pack. */
const CONNECT_ACTS = ['begun.get', 'begun.take', 'connection.make', 'connection.get', 'connection.drop', 'workspace.add', 'workspace.deliver'];

export class ServerPacks {
  readonly packs: ServerPack[];
  readonly refused: { folder: string; why: string[] }[];
  /** Told of each delivery a pack hands to a connected workspace, once a pack there has taken it in. */
  readonly delivered: Delivered[] = [];
  /** The address this server is reached at from outside, which a pack is told (ctx.origin). */
  origin = '';
  private boxes = new Map<string, Sandbox>();
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
    for (const { file } of this.packs) if (file.aliases?.[path]) return `/x/${file.id}/${file.aliases[path]}`;
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

  /** The connection a workspace made to a pack, if it has. */
  async connectionOf(id: string, workspace: string): Promise<Connection | undefined> {
    return this.find(id) ? connectionOf(await this.control(), id, workspace) : undefined;
  }

  private agreed?: { at: number; documents: Promise<Agreement[]> };
  /**
   * The documents a person agrees to before they are signed in, from every pack that declares them, asked again after
   * a minute so a new version is in force soon after it is put in place. A pack that fails to answer adds none, and
   * is said in the server's log.
   */
  agreements(): Promise<Agreement[]> {
    if (this.agreed && Date.now() - this.agreed.at < AGREEMENTS_MS) return this.agreed.documents;
    const documents = Promise.all(
      this.packs
        .filter((p) => p.file.agreements)
        .map((p) =>
          this.call(p.file.id, 'entry', p.file.agreements!, {}).then(agreementsFrom, (err) => {
            console.error(`server pack ${p.file.id}: its agreements did not answer: ${(err as Error).message}`);
            return [];
          }),
        ),
    ).then((each) => each.flat());
    this.agreed = { at: Date.now(), documents };
    return documents;
  }

  /** Call one entry of a pack's handler (a public entry, a webhook, a schedule, or one the kernel calls) and give back its answer. */
  async call(id: string, call: 'entry' | 'webhook' | 'schedule', name: string, input: unknown, ms = CALL_MS): Promise<unknown> {
    const pack = this.find(id);
    if (!pack) throw new Error(`No server pack "${id}".`);
    const box = this.boxes.get(id) ?? new Sandbox(pack.folder);
    this.boxes.set(id, box);
    const answer: Answerer = async (q) => {
      if (typeof q.act === 'string') {
        const input = (q.input ?? {}) as Record<string, unknown>;
        if (!(pack.file.acts ?? []).includes(q.act as never)) throw new Error(`The pack "${id}" did not declare the act "${q.act}".`);
        if (CONNECT_ACTS.includes(q.act)) return connectAct(this.at, await this.control(), pack.file, q.act, input, this.delivered);
        return runAct(this.at, pack.file, q.act, input, () => this.agreements());
      }
      if (q.request && typeof q.request === 'object') return this.request(id, q.request as HostRequest);
      if (typeof q.store === 'string') {
        const key = String(q.key ?? '');
        if (!KEY.test(key)) throw new Error('A key is 1 to 200 letters, digits and _.:-');
        if (q.store === 'get') return (await storeGet(await this.control(), id, key)) ?? null;
        if (q.store === 'take') return (await storeTake(await this.control(), id, key)) ?? null;
        if (q.store === 'put') return void (await storePut(await this.control(), id, key, q.value, typeof q.ms === 'number' && q.ms > 0 ? q.ms : undefined));
      }
      throw new Error('A server pack asks only for its acts, its hosts and its store: it reads no map.');
    };
    const done = await box.call(answer, { call, name, input, actor: { name: `pack:${id}`, kind: 'agent' }, now: new Date().toISOString(), zone: 'UTC', origin: this.origin, hosts: Object.fromEntries((pack.file.hosts ?? []).map((h) => [h.id, hostBase(id, h)])), present: [] }, Math.min(ms, MOST_MS));
    return done.answer ?? null;
  }

  /** Run the schedules of every pack: each once now, then every so many minutes. Answers what stops them. */
  runSchedules(): () => void {
    const timers: NodeJS.Timeout[] = [];
    for (const { file } of this.packs)
      for (const s of file.schedules ?? []) {
        const run = () => void this.call(file.id, 'schedule', s.id, {}).catch((err) => console.error(`server pack ${file.id} schedule ${s.id}: ${(err as Error).message}`));
        run();
        timers.push(setInterval(run, s.every_minutes * 60_000).unref());
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
