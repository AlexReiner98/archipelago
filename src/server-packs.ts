// Server packs: what a server does that no one workspace's map can (sell a workspace, take a payment's webhook), by
// the pack contract. A server pack is a folder with a pack.json marked tier "server" and a handler.js, kept in the
// kernel's own packs folder (beside the workspace packs, for one that ships with it) or in one of the folders the
// server's configuration names (PELAGO_SERVER_PACKS, separated as PATH is): so a private one is a folder on the
// machine the server runs on, never a file of this repository. Being there enables it; no workspace owner can. Its
// handler runs in the same sandbox as any pack's (src/packhost.ts), one process for the server.
//
// What it may declare: public pages and entries, and webhooks, all under /x/<pack>/ (src/server-routes.ts); the
// server acts it may ask for, from the kernel's closed list (src/server-acts.ts); the documents a person agrees to
// before they are signed in (src/agreements.ts); hosts it may call, with the secrets the kernel adds
// (src/server-requests.ts); what a workspace's admin may connect it to (src/server-connect.ts); and schedules. It gets
// no database, no map, no token and no secret: the kernel holds each secret, sealed, and adds it where it is needed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { env } from './env.ts';

/** The acts a server pack may ask the kernel for, each only if it declares it. */
export const SERVER_ACTS = [
  'workspace.create', 'workspace.admit', 'workspace.limit', 'workspace.end', 'signin.link', 'mail.send', 'agreement.record',
  // On a workspace whose admin connected the pack (src/server-connect.ts).
  'begun.get', 'begun.take', 'connection.make', 'connection.get', 'connection.drop', 'workspace.add', 'workspace.deliver',
] as const;
export type ServerAct = (typeof SERVER_ACTS)[number];

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const FILE = /^[a-z0-9][a-z0-9_.-]{0,60}\.(html|js|css|svg|png|webp)$/;
/** The addresses the kernel answers at itself, which no pack may take as an alias. */
const KERNEL_PATHS = /^\/(x|api|agent|mcp|hook|hooks|connect|p|s|read|operator|backup-file|whoami|health)(\/|$)/;

export interface ServerHost {
  id: string;
  base: string;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
  /** A secret sent as a bearer token. */
  secret?: string;
  /** A short-lived token the kernel signs (RS256) with the secret named key, issued by the secret named issuer. */
  sign?: { key: string; issuer: string; minutes?: number };
  /** Where the signed token is traded for a token to act as one account ({as} in the path), and the answer's fields. */
  exchange?: { path: string; token: string; expires: string };
}

export interface ServerPackFile {
  id: string;
  version: string;
  title: string;
  description?: string;
  tier: 'server';
  /** The server acts it may ask for. */
  acts?: ServerAct[];
  /**
   * Entries of its handler anyone may call with no login, as POST /x/<pack>/<id>, each answering JSON. One marked GET
   * is where a person is sent back to from outside: called with the address's query, it answers where to send them on
   * ({ redirect }), and a refusal is shown them as a page.
   */
  entries?: { id: string; description?: string; limit_ms?: number; method?: 'GET' | 'POST' }[];
  /**
   * Pages anyone may open, as GET /x/<pack>/<id>: an HTML file in its public/ folder, under a strict policy. A page may
   * send a form to one of its hosts (form_action), as when a person is handed to another site with what it asks for.
   */
  pages?: { id: string; file: string; form_action?: string }[];
  /**
   * POST /x/<pack>/hook/<id>, checked before the handler sees it: the HMAC-SHA256 of the raw body with the secret named.
   * One that names headers is handed { payload, headers } with those of the delivery's headers, not the body alone.
   */
  webhooks?: { id: string; secret: string; header?: string; format?: 'prefixed' | 'hex'; headers?: string[]; limit_ms?: number }[];
  /** Outside services it may call while it runs (ctx.request), each with how the kernel proves who it is. */
  hosts?: ServerHost[];
  /**
   * The secrets its hosts and webhooks are given, held by the kernel: set at run time from a host's answer (sealed in
   * the control plane), or from the environment (PELAGO_SECRET_<PACK>_<NAME>, or the name given as env).
   */
  secrets?: { name: string; env?: string }[];
  /**
   * What a workspace's admin may connect it to (src/server-connect.ts): entries the kernel calls, never public. status
   * says whether it is ready to be connected; start answers where to send the admin, given a one-time word (state).
   * With setup, the default workspace's admin readies it once for the server, through start too.
   */
  connect?: { status: string; start: string; setup?: boolean };
  /** Entries the server's leader runs every so many minutes, and once when it takes the lead. */
  schedules?: { id: string; every_minutes: number }[];
  /** Addresses it answered at before it was a pack, each to one of its own routes ("hook/<id>", an entry or a page). */
  aliases?: Record<string, string>;
  /**
   * One of its entries, answering the documents a person agrees to before they are signed in, each { id, title, url,
   * version, also? } (src/agreements.ts), also naming the same document in other languages. A new version is agreed to
   * again at the next sign-in.
   */
  agreements?: string;
}

export interface ServerPack {
  file: ServerPackFile;
  folder: string;
}

/** Why a pack.json is not a server pack it may be, as sentences; none when it is. */
export function checkServerPack(p: Partial<ServerPackFile>, folder: string): string[] {
  const problems: string[] = [];
  if (!p.id || !ID.test(p.id)) problems.push('its id is lowercase letters, digits and underscores, starting with a letter');
  if (p.tier !== 'server') problems.push('it is not marked tier "server"');
  if (!p.version || !p.title) problems.push('it needs a version and a title');
  for (const act of p.acts ?? []) if (!(SERVER_ACTS as readonly string[]).includes(act)) problems.push(`"${act}" is not a server act: one of ${SERVER_ACTS.join(', ')}`);
  const names = [...(p.entries ?? []), ...(p.pages ?? [])].map((e) => e.id);
  for (const name of names) if (!NAME.test(name) || name === 'hook' || name === 'public') problems.push(`"${name}" cannot name an entry or a page`);
  if (new Set(names).size !== names.length) problems.push('an entry and a page share a name');
  for (const page of p.pages ?? []) if (!FILE.test(page.file) || !existsSync(join(folder, 'public', page.file))) problems.push(`page "${page.id}" names no file in its public/ folder`);
  for (const page of p.pages ?? []) if (page.form_action && !p.hosts?.some((h) => h.id === page.form_action)) problems.push(`page "${page.id}" sends a form to no host of its own`);
  const secrets = (p.secrets ?? []).map((s) => s.name);
  for (const s of secrets) if (!NAME.test(s)) problems.push(`"${s}" cannot name a secret`);
  for (const host of p.hosts ?? []) {
    if (!NAME.test(host.id) || !/^https?:\/\/\S+$/.test(host.base ?? '')) problems.push(`host "${host.id}" needs an id and an http(s) base`);
    for (const name of [host.secret, host.sign?.key, host.sign?.issuer]) if (name !== undefined && !secrets.includes(name)) problems.push(`host "${host.id}" names the secret "${name}", which it does not declare`);
    if (host.exchange && (!host.sign || !host.exchange.path?.includes('{as}') || !host.exchange.token || !host.exchange.expires)) problems.push(`host "${host.id}": an exchange trades a signed token, at a path with {as}, for a token and when it expires`);
  }
  for (const hook of p.webhooks ?? []) {
    if (!NAME.test(hook.id) || !NAME.test(hook.secret ?? '')) problems.push(`webhook "${hook.id}" needs an id and the name of its secret`);
    if (hook.format && !['prefixed', 'hex'].includes(hook.format)) problems.push(`webhook "${hook.id}": its format is prefixed (sha256=<hex>) or hex`);
    if (p.secrets && !secrets.includes(hook.secret)) problems.push(`webhook "${hook.id}" names the secret "${hook.secret}", which it does not declare`);
  }
  if (p.connect && (!p.connect.status || !p.connect.start)) problems.push('what it connects to needs a status and a start entry');
  for (const s of p.schedules ?? []) if (!NAME.test(s.id ?? '') || !(s.every_minutes >= 1)) problems.push(`schedule "${s.id}" needs an id and every_minutes`);
  for (const [path, to] of Object.entries(p.aliases ?? {})) {
    const hook = /^hook\/([a-z][a-z0-9_]*)$/.exec(to);
    if (!/^\/[a-z0-9][a-z0-9/_-]*$/.test(path) || KERNEL_PATHS.test(path)) problems.push(`"${path}" cannot be an address of its own`);
    if (hook ? !p.webhooks?.some((w) => w.id === hook[1]) : !names.includes(to)) problems.push(`"${path}" leads to no route of its own: "${to}"`);
  }
  if (p.agreements !== undefined && !p.entries?.some((e) => e.id === p.agreements)) problems.push(`its agreements name no entry of its own: "${p.agreements}"`);
  if ((p.entries?.length || p.webhooks?.length || p.connect || p.schedules?.length) && !existsSync(join(folder, 'handler.js'))) problems.push('it has entries or webhooks and no handler.js');
  return problems;
}

/** The kernel's own packs folder, where the server packs that ship with it are kept beside the workspace packs. */
export const OWN_PACKS = resolve(import.meta.dirname, '..', 'packs');

/** The folders server packs are kept in: the kernel's own, and those the configuration names. */
export const serverPackDirs = (given = env('SERVER_PACKS')): string[] => [OWN_PACKS, ...(given ?? '').split(delimiter).map((d) => d.trim()).filter(Boolean).map((d) => resolve(d))];

/** Whether a pack file is marked a server pack: only those are read from a folder that holds workspace packs too. */
function markedServer(at: string): boolean {
  try {
    return (JSON.parse(readFileSync(at, 'utf8')) as { tier?: string }).tier === 'server';
  } catch {
    return true;
  }
}

/** Every server pack in those folders. One that is not right is left out and said why, never half loaded. */
export function loadServerPacks(dirs = serverPackDirs()): { packs: ServerPack[]; refused: { folder: string; why: string[] }[] } {
  const packs: ServerPack[] = [];
  const refused: { folder: string; why: string[] }[] = [];
  for (const dir of [...new Set(dirs)]) {
    if (!existsSync(dir)) {
      refused.push({ folder: dir, why: ['there is no such folder'] });
      continue;
    }
    for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      const folder = join(dir, name);
      const at = join(folder, 'pack.json');
      if (!existsSync(at) || (dir === OWN_PACKS && !markedServer(at))) continue;
      let file: Partial<ServerPackFile>;
      try {
        file = JSON.parse(readFileSync(at, 'utf8'));
      } catch (err) {
        refused.push({ folder, why: [`its pack.json is not JSON: ${(err as Error).message}`] });
        continue;
      }
      const why = checkServerPack(file, folder);
      if (!why.length && packs.some((p) => p.file.id === file.id)) why.push(`another server pack is "${file.id}" already`);
      for (const path of Object.keys(file.aliases ?? {})) if (packs.some((p) => p.file.aliases?.[path])) why.push(`another server pack answers at "${path}" already`);
      if (why.length) refused.push({ folder, why });
      else packs.push({ file: file as ServerPackFile, folder });
    }
  }
  return { packs, refused };
}

/** A secret from the server's environment: PELAGO_SECRET_<PACK>_<NAME>, or the name the pack declares for it. */
export function envSecret(pack: Pick<ServerPackFile, 'id' | 'secrets'>, name: string): string | undefined {
  const declared = pack.secrets?.find((s) => s.name === name)?.env;
  return env(`SECRET_${pack.id}_${name}`.toUpperCase()) ?? (declared ? env(declared) : undefined);
}
