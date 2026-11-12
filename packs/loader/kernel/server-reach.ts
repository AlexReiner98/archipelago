// What a server pack may declare beyond its pages, entries, webhooks and gates (e_nsruapq3, 10 Nov 2026): the
// addresses it takes from the kernel's closed list (mounts), entries that answer a page, streams the kernel feeds,
// files it serves filled with the kernel's values, the agents it may launch, and the surface whose hooks it
// translates. Each is a declaration the kernel acts on (packs/surface/kernel/server-mounts.ts, server-routes.ts, server-streams.ts,
// server-files.ts, server-launch.ts, server-adapter.ts); none gives the pack a map, a process, a token or a header.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isCountStream } from '../../log/kernel/retention.ts';

/** The addresses a server pack may take, each by at most one pack (decision e_wptrr6tf). */
export const MOUNTS = ['public', 'site', 'setup'] as const;
export type Mount = (typeof MOUNTS)[number];
/** What answers at a mount: public and site an entry of its own that answers a page, setup a file it serves. */
const BY_ENTRY: Mount[] = ['public', 'site'];

/** What the kernel tells a stream's listeners of. */
export const STREAM_ON = ['published'] as const;
/** The values the kernel fills a served file with, as {name} in it. */
export const FILLS = ['origin', 'tokens', 'version', 'rules'] as const;
/** The types a served file may be. */
export const FILE_TYPES = ['text/javascript', 'text/markdown', 'text/plain', 'text/x-shellscript'] as const;
/** What a launcher's command may name, filled by the kernel (decision e_885ztqkv): never a shell. mode is how the launch was asked to run (plan, acceptEdits), session_id the id its run is registered under. */
export const LAUNCH_FILLS = ['prompt', 'mcp_config', 'tools', 'model', 'mode', 'session_id'] as const;

export interface MoreReach {
  /** The addresses it takes: public (/p/), site (a domain's whole space), setup (/connect/setup.mjs). */
  mounts?: Partial<Record<Mount, string>>;
  /** Streams anyone may listen on, at /x/<pack>/<id>/<workspace>/<id>, which the kernel holds and tells. */
  streams?: { id: string; on: (typeof STREAM_ON)[number] }[];
  /** Files of its files/ folder served as they are, but for the values named in fill: at /x/<pack>/files/<id>. */
  files?: { id: string; file: string; type: (typeof FILE_TYPES)[number]; fill?: (typeof FILLS)[number][] }[];
  /** Agents it may launch: argv with {fill}s, run with no shell; read, a function given each line it prints. */
  launchers?: { id: string; argv: string[]; read: string; /** The one launched when the launch setting names none (packs/surface/kernel/server-launch.ts). */ default?: true }[];
  /**
   * The stream on a site's workspace its counts are kept in (the acts count.add and count.read, packs/publish/kernel/pack-counts.ts): a
   * plain word no kernel stream has, one pack's alone, kept by the retention rule a workspace pack gives it.
   */
  counts?: string;
  /** The surface whose hooks it translates (POST /hooks/<surface>/<event>): in and out, functions of its handler. */
  adapter?: { surface: string; in: string; out: string; before?: Before };
}

/**
 * What a surface was before there were surfaces, said by the one pack whose it was: its hooks are those at /hooks/<event>
 * (packs/loader/kernel/server-adapter.ts), actor the name every session's hooks act under on the log, and agent the name an agent acts
 * under on a server with no tokens when it gives none (src/server.ts).
 */
export interface Before { actor: string; agent: string }

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ACTOR = /^[a-z][a-z0-9_-]{0,39}$/;
const FILE = /^[a-z0-9][a-z0-9_.-]{0,60}\.(mjs|js|md|txt|sh|ps1)$/;
const fills = (s: string) => [...s.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);

/**
 * Why what a pack declares of these is not what it may be, as sentences. names are its entries' and pages' ids,
 * html those of its entries that answer a page, fns the functions the kernel calls that are no route (gates).
 */
export function checkMoreReach(server: MoreReach, folder: string, names: string[], html: string[], fns: string[]): string[] {
  const problems: string[] = [];
  const files = server.files ?? [];
  for (const [mount, to] of Object.entries(server.mounts ?? {})) {
    const m = mount as Mount;
    if (!(MOUNTS as readonly string[]).includes(mount)) problems.push(`"${mount}" is not a mount: one of ${MOUNTS.join(', ')}`);
    else if (BY_ENTRY.includes(m) ? !html.includes(String(to)) : !files.some((f) => f.id === to)) problems.push(`its mount ${mount} names no ${BY_ENTRY.includes(m) ? 'entry of its own that answers a page' : 'file of its own'}: "${to}"`);
  }
  const streams = (server.streams ?? []).map((s) => s.id);
  for (const s of server.streams ?? []) {
    if (!NAME.test(s.id) || names.includes(s.id) || ['hook', 'public', 'files'].includes(s.id)) problems.push(`"${s.id}" cannot name a stream`);
    if (!(STREAM_ON as readonly string[]).includes(s.on)) problems.push(`stream "${s.id}" is told of ${STREAM_ON.join(' or ')}`);
  }
  if (new Set(streams).size !== streams.length) problems.push('two streams share a name');
  for (const f of files) {
    if (!NAME.test(f.id) || !FILE.test(f.file ?? '') || !existsSync(join(folder, 'files', f.file))) problems.push(`file "${f.id}" names no file in its files/ folder`);
    if (!(FILE_TYPES as readonly string[]).includes(f.type)) problems.push(`file "${f.id}" is one of ${FILE_TYPES.join(', ')}`);
    for (const v of f.fill ?? []) if (!(FILLS as readonly string[]).includes(v)) problems.push(`file "${f.id}" is filled with ${FILLS.join(', ')}, not "${v}"`);
  }
  if (new Set(files.map((f) => f.id)).size !== files.length) problems.push('two files share a name');
  if (server.counts !== undefined && !isCountStream(String(server.counts))) problems.push(`"${server.counts}" cannot name the stream its counts are kept in`);
  const called = [...fns];
  for (const l of server.launchers ?? []) {
    if (!NAME.test(l.id) || !Array.isArray(l.argv) || !l.argv.length || l.argv.some((a) => typeof a !== 'string')) problems.push(`launcher "${l.id}" needs an id and a command as a list`);
    for (const v of (l.argv ?? []).flatMap(fills)) if (!(LAUNCH_FILLS as readonly string[]).includes(v)) problems.push(`launcher "${l.id}" fills ${LAUNCH_FILLS.join(', ')}, not "${v}"`);
    if (l.default !== undefined && l.default !== true) problems.push(`launcher "${l.id}" is the default (true), or says nothing`);
    called.push(l.read);
  }
  if ((server.launchers ?? []).filter((l) => l.default).length > 1) problems.push('one launcher of a pack is its default');
  if (server.adapter) {
    const { surface, in: inward, out } = server.adapter;
    if (!NAME.test(surface ?? '')) problems.push('its adapter names its surface: lowercase letters, digits and underscores');
    const before = server.adapter.before;
    if (before !== undefined && (typeof before !== 'object' || before === null || !ACTOR.test(String(before.actor)) || !ACTOR.test(String(before.agent)))) problems.push('its adapter says what it was before there were surfaces as { actor, agent }, names of lowercase letters, digits, - and _');
    called.push(inward, out);
  }
  for (const fn of called.slice(fns.length)) if (!NAME.test(String(fn)) || names.includes(String(fn)) || streams.includes(String(fn))) problems.push(`it names a function of its handler that is no entry, page or stream: "${fn}"`);
  return problems;
}

/** Whether a pack declares anything of these its handler answers. */
export const runsMore = (server: MoreReach) => Boolean(server.launchers?.length || server.adapter);
