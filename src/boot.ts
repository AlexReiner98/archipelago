// The boot stub: the server's entry point, and the one part of the kernel that is no pack (docs/kernel-packs.md,
// "The boot stub"; decision e_3pxvwdn7). It holds no SQL, no route and no type name. It
//
//   1. reads packs/roots.json, the root packs in order, each with its hash;
//   2. hashes each root pack's folder (pack.json as canonical JSON, and kernel/**) and refuses to start on a
//      difference, naming the pack and both hashes;
//   3. starts the roots in order, each handed the roots before it by id: a root that asks for one after it stops
//      the start;
//   4. hands each root the fillings of the hook points and slots it opens, as the root that has them (the loader)
//      answers;
//   5. opens a workspace: each root's open in order, then the open.<phase> slots, then on the server that leads the
//      timers;
//   6. records the root hashes on the control log at each start, which /health answers too;
//   7. stops the roots in reverse order.
//
// The owner's word for a change to a root pack is their approval of the pull request that changes roots.json: CI
// runs `node src/boot.ts --check` and refuses a roots.json the owner has not approved (.github/workflows/roots.yml).
// `npm run roots` writes the hashes of the folders as they are, for that pull request.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { controlValue, setControlValue } from './control.ts';
import type { Q } from './db.ts';
import { sha256Hex } from './hashes.ts';
import { jcs } from './jcs.ts';

/** The repository: packs/ and roots.json are read from here unless told otherwise. */
export const HOME = join(import.meta.dirname, '..');
/** Where the root list is, under the repository. */
export const ROOTS_FILE = 'packs/roots.json';
/** The phases a workspace opens in, each a slot `open.<phase>` the packs fill (the order Workspaces.load had). */
export { OPEN_PHASES } from './open-phases.ts'; import { OPEN_PHASES } from './open-phases.ts';
/** The control value the starts are kept under, and how many are kept. */
export const STARTS_KEY = 'boot.starts';
const STARTS_KEPT = 50;

/** One root in roots.json. */
export interface RootEntry {
  id: string;
  hash: string;
}

/** What a root pack's code is handed: itself, the roots before it, and the server's error stream. */
export interface RootContext {
  pack: { id: string; version: string; hash: string };
  /** A root started before this one, by id. Asking for one after it, or for no root, throws: the start stops. */
  root<T = RootStarted>(id: string): T;
  said(message: string): void;
}

/** A filling of a hook point or slot: a function a pack's module gave for it. */
export type Filling = (...args: never[]) => unknown;

/** A timer a pack declares, run on the server that leads. */
export interface Timer {
  pack: string;
  run: (workspace: string) => unknown;
  every_ms: number;
  leading?: boolean;
}

/** What a started root answers with: its interface, and what the stub asks of it. */
export interface RootStarted {
  [name: string]: unknown;
  /** The hook points and slots it opens, filled by the stub after every root has started. */
  opens?: readonly string[];
  fill?(point: string, fillings: Filling[]): void;
  /** The loader's: the fillings of a point, in pack order. */
  fillings?(point: string): Filling[];
  /** The loader's: the timers the packs declare. */
  timers?(): Timer[];
  open?(workspace: string): unknown;
  close?(workspace: string): unknown;
  stop?(): unknown;
}

/** A root pack's module (its `kernel.modules` folder's index.ts). */
export interface RootModule {
  start(ctx: RootContext): RootStarted | Promise<RootStarted>;
}

/** The started server's roots, as the rest of the start uses them. */
export interface Booted {
  roots: RootEntry[];
  /** The root hashes by id, as /health answers them. */
  hashes: Record<string, string>;
  get<T = RootStarted>(id: string): T;
  open(workspace: string, leading?: boolean): Promise<void>;
  close(workspace: string): Promise<void>;
  /** Keeps this start on the control log: when, from which commit, on which roots. */
  started(control: Q, commit?: string): Promise<void>;
  stop(): Promise<void>;
}

/** Refused: the server does not start. */
export class BootRefused extends Error {}

/** A file's text with its line endings as git keeps them, so a Windows checkout hashes as Linux does. */
const text = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Every file under a folder, as paths relative to the pack, with forward slashes, sorted. */
function filesUnder(packDir: string, sub: string): string[] {
  const at = join(packDir, sub);
  if (!existsSync(at)) return [];
  return readdirSync(at, { recursive: true, encoding: 'utf8' })
    .map((f) => `${sub}/${f.replace(/\\/g, '/')}`)
    .filter((f) => statSync(join(packDir, f)).isFile())
    .sort();
}

/**
 * A root pack's hash: SHA-256 of the canonical JSON of each file's own hash by path. pack.json is hashed as
 * canonical JSON, so spacing and key order do not count; kernel/** as text with LF line endings.
 */
export function hashPack(packDir: string): string {
  const manifest = join(packDir, 'pack.json');
  if (!existsSync(manifest)) throw new BootRefused(`${packDir} has no pack.json.`);
  const files: Record<string, string> = { 'pack.json': sha256Hex(jcs(JSON.parse(text(manifest)))) };
  for (const f of filesUnder(packDir, 'kernel')) files[f] = sha256Hex(text(join(packDir, f)));
  return sha256Hex(jcs(files));
}

/** The root list, checked for its shape. */
export function readRoots(file: string): RootEntry[] {
  if (!existsSync(file)) throw new BootRefused(`${file} is missing: it lists the root packs the server starts.`);
  const parsed = JSON.parse(text(file)) as { roots?: unknown };
  const roots = parsed.roots;
  if (!Array.isArray(roots) || !roots.length) throw new BootRefused(`${file} lists no root packs.`);
  const seen = new Set<string>();
  for (const r of roots as RootEntry[]) {
    if (typeof r?.id !== 'string' || typeof r.hash !== 'string') throw new BootRefused(`${file}: each root is { "id", "hash" }.`);
    if (seen.has(r.id)) throw new BootRefused(`${file} lists ${r.id} twice.`);
    seen.add(r.id);
  }
  return roots as RootEntry[];
}

interface Manifest {
  id: string;
  version?: string;
  kernel?: { trust?: string; modules?: string };
}

const manifestOf = (packDir: string) => JSON.parse(text(join(packDir, 'pack.json'))) as Manifest;

/** The packs under packs/ whose manifest says they are root, by id. */
function declaredRoots(packsDir: string): string[] {
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(packsDir, d.name, 'pack.json')))
    .filter((d) => manifestOf(join(packsDir, d.name)).kernel?.trust === 'root')
    .map((d) => d.name);
}

/**
 * Every difference between roots.json and the folders: a hash that is not the folder's, a root pack the list
 * leaves out, a listed pack that is not root. Empty when the server may start.
 */
export function checkRoots(home = HOME): string[] {
  const packsDir = join(home, 'packs'), roots = readRoots(join(home, ROOTS_FILE)), wrong: string[] = [];
  for (const r of roots) {
    const dir = join(packsDir, r.id);
    if (!existsSync(join(dir, 'pack.json'))) { wrong.push(`${r.id}: listed in ${ROOTS_FILE}, but packs/${r.id} has no pack.json.`); continue; }
    const m = manifestOf(dir);
    if (m.id !== r.id) wrong.push(`${r.id}: packs/${r.id}/pack.json says its id is ${m.id}.`);
    if (m.kernel && m.kernel.trust !== 'root') wrong.push(`${r.id}: listed as a root, but its manifest's kernel.trust is ${m.kernel.trust ?? 'missing'}.`);
    const now = hashPack(dir);
    if (now !== r.hash) wrong.push(`${r.id}: ${ROOTS_FILE} pins ${r.hash}, but its folder hashes to ${now}. A root pack changes only with the owner's word: npm run roots, in a pull request they approve.`);
  }
  const listed = new Set(roots.map((r) => r.id));
  for (const id of declaredRoots(packsDir)) if (!listed.has(id)) wrong.push(`${id}: its manifest says it is a root pack, but ${ROOTS_FILE} does not list it.`);
  return wrong;
}

/** roots.json with each listed pack's hash as its folder is now: what a pull request that changes a root brings. */
export function pinRoots(home = HOME): RootEntry[] {
  const file = join(home, ROOTS_FILE), parsed = JSON.parse(text(file)) as { roots: RootEntry[] };
  parsed.roots = parsed.roots.map((r) => ({ id: r.id, hash: hashPack(join(home, 'packs', r.id)) }));
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed.roots;
}

/** Loads a root pack's module: TypeScript under its own folder, never a file a pack item carries. */
const importModule = async (path: string) => (await import(pathToFileURL(path).href)) as RootModule;

/**
 * Checks the roots and starts them in order. Refuses (BootRefused) on a hash that differs, a root that asks for
 * one after it, or a root whose start fails; the roots started before it are stopped again first.
 */
export async function boot(options: { home?: string; load?: (path: string, id: string) => Promise<RootModule>; said?: (message: string) => void } = {}): Promise<Booted> {
  const home = options.home ?? HOME, said = options.said ?? ((m: string) => console.error(m)), load = options.load ?? importModule;
  const wrong = checkRoots(home);
  if (wrong.length) throw new BootRefused(`The server does not start: its root packs are not the ones pinned.\n${wrong.join('\n')}`);
  const roots = readRoots(join(home, ROOTS_FILE));
  const started = new Map<string, RootStarted>(), order: string[] = [];
  const get = <T>(id: string): T => {
    const r = started.get(id);
    if (!r) throw new BootRefused(roots.some((x) => x.id === id) ? `${id} starts later: a root pack needs only those above it in ${ROOTS_FILE}.` : `There is no root pack ${id}.`);
    return r as T;
  };
  const stopAll = async () => {
    for (const id of [...order].reverse()) {
      try { await started.get(id)?.stop?.(); } catch (err) { said(`stopping the ${id} root pack: ${(err as Error).message}`); }
    }
  };
  for (const r of roots) {
    const dir = join(home, 'packs', r.id), m = manifestOf(dir);
    try {
      let handle: RootStarted = {};
      if (m.kernel?.modules) {
        const mod = await load(join(dir, m.kernel.modules, 'index.ts'), r.id);
        const ctx: RootContext = {
          pack: { id: r.id, version: m.version ?? '', hash: r.hash },
          root: <T>(id: string) => {
            if (id === r.id) throw new BootRefused(`The ${r.id} root pack asks for itself.`);
            if (!started.has(id)) throw new BootRefused(`The ${r.id} root pack asks for ${id}, which ${roots.some((x) => x.id === id) ? 'starts after it' : 'is no root pack'}: a root needs only those above it in ${ROOTS_FILE}.`);
            return get<T>(id);
          },
          said: (message) => said(`${r.id}: ${message}`),
        };
        handle = (await mod.start(ctx)) ?? {};
      }
      started.set(r.id, handle);
      order.push(r.id);
    } catch (err) {
      await stopAll();
      throw err instanceof BootRefused ? err : new BootRefused(`The server does not start: the ${r.id} root pack failed to start: ${(err as Error).message}`);
    }
  }
  // The loader answers what fills each hook point and slot; a root that opens one is handed its fillings.
  const loader = order.map((id) => started.get(id)!).find((h) => typeof h.fillings === 'function');
  const fillings = (point: string): Filling[] => loader?.fillings?.(point) ?? [];
  for (const id of order) {
    const h = started.get(id)!;
    for (const point of h.opens ?? []) h.fill?.(point, fillings(point));
  }

  const hashes = Object.fromEntries(roots.map((r) => [r.id, r.hash]));
  const timers = new Map<string, ReturnType<typeof setInterval>[]>();
  return {
    roots,
    hashes,
    get,
    async open(workspace, leading = true) {
      for (const id of order) await started.get(id)!.open?.(workspace);
      for (const phase of OPEN_PHASES) for (const fill of fillings(`open.${phase}`)) await (fill as (ws: string) => unknown)(workspace);
      if (!leading || timers.has(workspace)) return;
      const running = (loader?.timers?.() ?? []).map((t) => {
        const tick = () => { try { void Promise.resolve(t.run(workspace)).catch((err: Error) => said(`${t.pack}'s timer: ${err.message}`)); } catch (err) { said(`${t.pack}'s timer: ${(err as Error).message}`); } };
        if (t.leading) tick();
        return setInterval(tick, t.every_ms);
      });
      timers.set(workspace, running);
    },
    async close(workspace) {
      for (const t of timers.get(workspace) ?? []) clearInterval(t);
      timers.delete(workspace);
      for (const id of [...order].reverse()) await started.get(id)!.close?.(workspace);
    },
    async started(control, commit) {
      const kept = (await controlValue<unknown[]>(control, STARTS_KEY)) ?? [];
      await setControlValue(control, STARTS_KEY, [{ at: new Date().toISOString(), commit, roots: hashes }, ...kept].slice(0, STARTS_KEPT));
    },
    async stop() {
      for (const ws of [...timers.keys()]) for (const t of timers.get(ws)!) clearInterval(t);
      timers.clear();
      await stopAll();
    },
  };
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const wrong = checkRoots();
    if (wrong.length) {
      console.error(wrong.join('\n'));
      process.exit(1);
    }
    console.log(`root packs as pinned: ${readRoots(join(HOME, ROOTS_FILE)).map((r) => r.id).join(', ')}`);
  } else if (arg === '--pin') {
    for (const r of pinRoots()) console.log(`${r.id} ${r.hash}`);
  } else {
    let booted: Booted;
    try {
      booted = await boot();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    const { serve } = await import('./server.ts');
    serve(booted);
  }
}
