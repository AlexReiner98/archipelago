// The hook point log.project (docs/kernel-packs.md, "Write-path hooks"): after the root projection has written an
// entry's facts into entity and relation, each internal pack that declares it is handed the facts and writes the
// rows of its own tables (`kernel.tables`), in the same transaction, in the write path and in every rebuild alike
// (src/replay.ts, projectFacts). What names an item (the mentions pack) is the first.
//
// A projector reads only the facts and the rows it is handed: its context answers nothing else, as it runs inside
// the append's transaction. Its rows are written as the tables' owner, as the projections' own are (a person writes
// what they may not read), and only into the tables its pack declares. When an item is forgotten, every row of every
// declared table that names it in an id column goes, whatever the pack does.

import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Manifest } from '../../loader/kernel/manifest.ts';
import { isLink, type TypesRead } from './project.ts';
import type { Db, Q } from '../../database/kernel/db.ts';
import type { Fact } from './log.ts';
import type { KernelContext } from '../../loader/kernel/kernel-context.ts';
import type { Registry } from '../../loader/kernel/packs.ts';

type Row = Record<string, unknown>;

/** An internal pack: one whose code runs in-process (the loader's isInternal, read here as data: the log sits below the loader). */
const isInternal = (m: Pick<Manifest, 'kernel'>): boolean => m.kernel?.internal === true;

/** An item as the root projection left it in this transaction. */
export interface ProjectedItem { id: string; type: string; title: string; body: string; props: Row }

/** What a projector writes with: its own tables only. */
export interface ProjectRows {
  /** An item as the root projection left it, read whole whoever is writing. */
  item(id: string): Promise<ProjectedItem | undefined>;
  /** The rows of one of its tables that name `id` in `column`, replaced by these. */
  replace(table: string, column: string, id: string, rows: Row[]): Promise<void>;
}

type Run = (ctx: KernelContext, facts: Fact[], rows: ProjectRows) => unknown;
interface Projector { pack: Manifest; tables: Record<string, Record<string, string>>; run: Run }

const NAME = /^[a-z_][a-z0-9_]*$/;
const isRegistry = (reg: TypesRead): reg is Registry => Array.isArray((reg as Partial<Registry>).packs) && typeof (reg as Partial<Registry>).folderOf === 'function';

/** The tables the internal packs of these types declare: what a rebuild empties beside the root's. */
export const declaredTables = (reg: TypesRead): string[] =>
  isRegistry(reg) ? reg.packs.filter(isInternal).flatMap((p) => Object.keys(p.kernel?.tables ?? {})).filter((t) => NAME.test(t)) : [];

const modules = new Map<string, Promise<Record<string, unknown>>>();
const found = new WeakMap<object, Promise<Projector[]>>();

/** The projectors of a registry's internal packs, loaded once: a function of its modules, never a file outside them. */
function projectorsOf(reg: TypesRead): Promise<Projector[]> {
  if (!isRegistry(reg)) return Promise.resolve([]);
  if (!found.has(reg)) found.set(reg, (async () => {
    const out: Projector[] = [];
    for (const pack of reg.packs.filter(isInternal)) {
      for (const ref of [pack.kernel?.hooks?.['log.project'] ?? []].flat()) {
        const [file, name] = ref.split('#');
        const dir = resolve(reg.folderOf(pack.id), pack.kernel?.modules ?? 'kernel/');
        const path = resolve(dir, file);
        const inside = relative(dir, path);
        if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`The ${pack.id} pack names ${ref}, outside its modules`);
        if (!modules.has(path)) modules.set(path, import(pathToFileURL(path).href) as Promise<Record<string, unknown>>);
        const run = (await modules.get(path)!)[name];
        if (typeof run !== 'function') throw new Error(`The ${pack.id} pack names ${ref}, which it does not export as a function`);
        out.push({ pack, tables: pack.kernel?.tables ?? {}, run: run as Run });
      }
    }
    return out;
  })());
  return found.get(reg)!;
}

/** The context a projector is handed: who it is and the types, and nothing that reaches outside the transaction. */
function projectorContext(reg: Registry, pack: Manifest, at: string): KernelContext {
  const none = (what: string) => () => { throw new Error(`The ${pack.id} pack's projector ${what}: a projector reads only its facts and its own rows`); };
  return {
    pack: { id: pack.id, version: pack.version, hash: reg.hashes.get(pack.id) ?? '' },
    workspace: '',
    reads: none('reads the map'),
    registry: reg,
    call: none('calls a service'),
    provided: none('reads the names of a family'),
    island: none('reads an island'),
    change: none('makes a change'),
    move: none('moves what it keeps'),
    record: none('records on a stream'),
    secret: none('asks for a secret'),
    fetch: none('calls out'),
    now: () => new Date(at),
    said: (message) => console.error(`${pack.id}: ${message}`),
  };
}

/** Run as the tables' owner from the first write on, and back as whoever it was at the end (as src/forget.ts asOwner). */
function owner(tx: Q) {
  let was: string | undefined, checked = false;
  return {
    async become() {
      if (checked) return;
      checked = true;
      const { rows } = await tx.query<{ now: string; was: string }>(`select current_user as now, session_user as was`);
      if (rows[0].now !== rows[0].was) { was = rows[0].now; await tx.query(`reset role`); }
    },
    async back() { if (was) await tx.query(`select set_config('role', $1, true)`, [was]); },
  };
}

function rowsFor(tx: Q, p: Projector, as: ReturnType<typeof owner>): ProjectRows {
  const table = (t: string, column: string) => {
    const cols = p.tables[t];
    if (!cols || !NAME.test(t)) throw new Error(`The ${p.pack.id} pack writes ${t}, a table it does not declare`);
    if (!(column in cols)) throw new Error(`The ${p.pack.id} pack's table ${t} has no column ${column}`);
    return Object.keys(cols).filter((c) => NAME.test(c));
  };
  return {
    async item(id) {
      await as.become();
      const { rows } = await tx.query<ProjectedItem>(`select id, type, title, body, props from entity where id = $1`, [id]);
      return rows[0];
    },
    async replace(t, column, id, rows) {
      const cols = table(t, column);
      await as.become();
      await tx.query(`delete from ${t} where ${column} = $1`, [id]);
      if (rows.length) await tx.query(`insert into ${t} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_recordset(null::${t}, $1::jsonb) on conflict do nothing`, [JSON.stringify(rows)]);
    },
  };
}

/** How many items one call of the projectors is handed when their tables are made again whole. */
const AGAIN = 1000;

/**
 * The packs' tables made again whole, after a restore, a merge or a rebuild's swap (what names what, first): each
 * emptied, then every item handed to the projectors as written whole, a page of ids at a time. Run as the tables' owner,
 * in the transaction given, so in a rebuild's shadow it makes the shadow's.
 */
export async function projectAgain(tx: Q, reg: TypesRead, at = new Date().toISOString()): Promise<void> {
  const projectors = await projectorsOf(reg);
  if (!projectors.length || !isRegistry(reg)) return;
  const as = owner(tx);
  try {
    await as.become();
    for (const p of projectors) for (const t of Object.keys(p.tables).filter((t) => NAME.test(t))) await tx.query(`delete from ${t}`);
  } finally {
    await as.back();
  }
  for (let after = ''; ;) {
    const { rows } = await tx.query<{ id: string }>(`select id from entity where id > $1 order by id limit ${AGAIN}`, [after]);
    if (!rows.length) return;
    await projectPacks(tx, reg, at, rows.map((r): Fact => ['+', r.id, 'body', null]));
    after = rows.at(-1)!.id;
  }
}

/** The setting that asks the next open to make the packs' tables again: left by a restore, which has no registry to run them with. */
const AGAIN_AT_OPEN = 'log.project_again';

/** Ask the next open of this database to make the packs' tables again whole (a restore, a map made outside the server). */
export const projectAgainAtOpen = (q: Q): Promise<unknown> =>
  q.query(`insert into setting (key, value) values ($1, 'true'::jsonb) on conflict (key) do update set value = excluded.value`, [AGAIN_AT_OPEN]);

/** At an open, once the map's packs are read: the packs' tables made again whole if a restore asked it. */
export async function projectAgainIfAsked(db: Db, reg: TypesRead): Promise<boolean> {
  if (!(await db.query(`select 1 from setting where key = $1`, [AGAIN_AT_OPEN])).rows.length) return false;
  await db.transaction(async (tx) => {
    await projectAgain(tx, reg);
    await tx.query(`delete from setting where key = $1`, [AGAIN_AT_OPEN]);
  });
  return true;
}

/** log.project: the packs' projectors over facts the root projection has just written, each into its own tables. */
export async function projectPacks(tx: Q, reg: TypesRead, at: string, facts: Fact[]): Promise<void> {
  if (!facts.length) return;
  const projectors = await projectorsOf(reg);
  if (!projectors.length || !isRegistry(reg)) return;
  const as = owner(tx);
  try {
    // A forgotten item leaves every declared table that names it, whatever its pack says.
    const forgotten = [...new Set(facts.filter((f) => f[0] === '+' && f[2] === 'forgotten' && !isLink(f[1])).map((f) => f[1]))];
    if (forgotten.length) {
      await as.become();
      for (const p of projectors) for (const [t, cols] of Object.entries(p.tables)) {
        const ids = Object.entries(cols).filter(([c, shape]) => shape === 'id' && NAME.test(c)).map(([c]) => c);
        if (NAME.test(t) && ids.length) await tx.query(`delete from ${t} where ${ids.map((c) => `${c} = any($1::text[])`).join(' or ')}`, [forgotten]);
      }
    }
    for (const p of projectors) await p.run(projectorContext(reg, p.pack, at), facts, rowsFor(tx, p, as));
  } finally {
    await as.back();
  }
}
