// The server packs of one server, loaded once, each run in a sandboxed process of its own (src/packhost.ts). While
// a call runs, the handler may ask for a server act it declared (ctx.act) or for its keys (ctx.store): nothing else.
// It reads no map.

import { agreementsFrom, type Agreement } from './agreements.ts';
import { storeGet, storePut, storeTake } from './control.ts';
import { Sandbox, type Answerer } from './packhost.ts';
import { runAct, type ActPlaces } from './server-acts.ts';
import { loadServerPacks, type ServerPack } from './server-packs.ts';

/** How long a call may take unless its pack says otherwise, and the most it may say. */
const CALL_MS = 10_000;
const MOST_MS = 30_000;
const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
/** How long the documents in force are taken as they were last answered. */
const AGREEMENTS_MS = 60_000;

export class ServerPacks {
  readonly packs: ServerPack[];
  readonly refused: { folder: string; why: string[] }[];
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

  /** Call one entry of a pack's handler (a public entry or a webhook) and give back its answer. */
  async call(id: string, call: 'entry' | 'webhook', name: string, input: unknown, ms = CALL_MS): Promise<unknown> {
    const pack = this.find(id);
    if (!pack) throw new Error(`No server pack "${id}".`);
    const box = this.boxes.get(id) ?? new Sandbox(pack.folder);
    this.boxes.set(id, box);
    const control = async () => (await this.at.get('default')).pelago.db;
    const answer: Answerer = async (q) => {
      if (typeof q.act === 'string') return runAct(this.at, pack.file, q.act, (q.input ?? {}) as Record<string, unknown>, () => this.agreements());
      if (typeof q.store === 'string') {
        const key = String(q.key ?? '');
        if (!KEY.test(key)) throw new Error('A key is 1 to 200 letters, digits and _.:-');
        if (q.store === 'get') return (await storeGet(await control(), id, key)) ?? null;
        if (q.store === 'take') return (await storeTake(await control(), id, key)) ?? null;
        if (q.store === 'put') return void (await storePut(await control(), id, key, q.value, typeof q.ms === 'number' && q.ms > 0 ? q.ms : undefined));
      }
      throw new Error('A server pack asks only for its acts and its store: it reads no map.');
    };
    const done = await box.call(answer, { call, name, input, actor: { name: `pack:${id}`, kind: 'agent' }, now: new Date().toISOString(), zone: 'UTC', present: [] }, Math.min(ms, MOST_MS));
    return done.answer ?? null;
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
