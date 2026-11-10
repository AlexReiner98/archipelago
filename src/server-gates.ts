// The gates: where the kernel asks a server pack before it goes ahead (src/server-packs.ts, reach.server.gates). The
// kernel keeps none of what they answer from; each pack keeps its own, in its store.
//
// - signin: what a person agrees to before they are signed in (a service's terms, its privacy policy), each at a
//   version, and what an address has not yet agreed to. A person who owes a document is shown it before a sign-in
//   link or code is traded for a token, and agrees by ticking a box, which the pack records.
// - standing: what a workspace the pack made may do (src/standing.ts), asked of that pack alone.
//
// A server with no gate asks nothing: nobody owes anything, and nothing is limited.

import { controlValue } from './control.ts';
import type { Q } from './db.ts';
import type { ServerPacks } from './server-host.ts';
import { standingFrom, type Standing } from './standing.ts';

/** One document to agree to: where it is read and the version in force. */
export interface Agreement {
  id: string;
  title: string;
  url: string;
  version: string;
  /** The same document in other languages, each named in its own: shown beside it wherever it is agreed to. */
  also?: { title: string; url: string }[];
}

/** How long the documents in force are taken as they were last answered. */
const DOCUMENTS_MS = 60_000;
const ID = /^[a-z][a-z0-9_]{0,39}$/;
const titled = (t: unknown): t is string => typeof t === 'string' && t.length > 0 && t.length <= 80;
const linked = (u: unknown): u is string => typeof u === 'string' && /^(\/(?!\/)|https:\/\/)[^\s"<>]{0,500}$/.test(u);
/** The workspace a pack made, as src/server-acts.ts keeps it. */
export const madeKey = (workspace: string) => `server_pack_made:${workspace}`;

/** The documents a gate's answer names, those that are well formed; anything else in it is left out. */
export function agreementsFrom(answer: unknown): Agreement[] {
  if (!Array.isArray(answer)) return [];
  return answer
    .filter((a): a is Agreement => {
      if (!a || typeof a !== 'object') return false;
      const { id, title, url, version } = a as Record<string, unknown>;
      return typeof id === 'string' && ID.test(id) && titled(title) && linked(url) && typeof version === 'string' && version.length > 0 && version.length <= 40;
    })
    .map(({ id, title, url, version, also }) => {
      // Other languages: up to three, each well formed, or none.
      const others = (Array.isArray(also) ? also : []).filter((o) => o && titled(o.title) && linked(o.url)).slice(0, 3).map(({ title, url }) => ({ title, url }));
      return { id, title, url, version, ...(others.length ? { also: others } : {}) };
    });
}

const shown = new WeakMap<ServerPacks, { at: number; documents: Promise<Agreement[]> }>();

/**
 * Ask every signin gate, for an address or none: the documents in force, and those the address owes, after recording
 * what it agrees to now (each { id, version }, only a version in force counting). A gate that fails is said in the
 * server's log: asked for documents it adds none, and asked for what is owed it lets nobody in until it answers.
 */
export async function signinGate(packs: ServerPacks, ask: { email?: string; agree?: unknown; via?: string }, except?: string) {
  const gates = packs.packs.filter((p) => p.file.reach.server.gates?.signin && p.file.id !== except);
  const each = await Promise.all(
    gates.map(async (p) => {
      try {
        const answer = ((await packs.call(p.file.id, 'entry', p.file.reach.server.gates!.signin!, ask, undefined, true)) ?? {}) as { documents?: unknown; owes?: unknown };
        const documents = agreementsFrom(answer.documents);
        const owes = new Set(Array.isArray(answer.owes) ? answer.owes.map(String) : []);
        return { documents, owes: ask.email ? documents.filter((d) => owes.has(d.id)) : [] };
      } catch (err) {
        console.error(`server pack ${p.file.id}: its signin gate did not answer: ${(err as Error).message}`);
        if (ask.email) throw new Error('Signing in cannot be checked just now: try again in a minute.');
        return { documents: [], owes: [] };
      }
    }),
  );
  return { documents: each.flatMap((e) => e.documents), owes: each.flatMap((e) => e.owes) };
}

/** The documents a person agrees to before they are signed in, asked again after a minute so a new version is soon in force. */
export function documentsInForce(packs: ServerPacks): Promise<Agreement[]> {
  const hit = shown.get(packs);
  if (hit && Date.now() - hit.at < DOCUMENTS_MS) return hit.documents;
  const documents = signinGate(packs, {}).then((g) => g.documents);
  shown.set(packs, { at: Date.now(), documents });
  return documents;
}

/** What each workspace's pack last said, for when it cannot be asked: while that pack is in a call of its own, or failing. */
const last = new Map<string, Standing | undefined>();

/**
 * A workspace's standing, from the pack that made it, if that pack has the gate: none for any other. A pack in the
 * middle of a call of its own is not asked (it takes one call at a time, and the call may be waiting on this): its
 * last word stands.
 */
export async function standingGate(packs: ServerPacks, control: Q, workspace: string): Promise<Standing | undefined> {
  if (!packs.packs.some((p) => p.file.reach.server.gates?.standing)) return undefined;
  const made = await controlValue<string>(control, madeKey(workspace));
  const pack = made ? packs.find(made) : undefined;
  const gate = pack?.file.reach.server.gates?.standing;
  if (!pack || !gate) return undefined;
  if (packs.busy(pack.file.id)) return last.get(workspace);
  try {
    const value = standingFrom(await packs.call(pack.file.id, 'entry', gate, { workspace }, undefined, true));
    last.set(workspace, value);
    return value;
  } catch (err) {
    console.error(`server pack ${pack.file.id}: its standing gate did not answer for ${workspace}: ${(err as Error).message}`);
    return last.get(workspace);
  }
}

/** The workspaces some pack made whose pack says they ended and whose day to be deleted has come. */
export async function dueForDeletion(packs: ServerPacks, control: Q, now = new Date()): Promise<string[]> {
  if (!packs.packs.some((p) => p.file.reach.server.gates?.standing)) return [];
  const { rows } = await control.query<{ key: string }>(`select key from control_value where key like 'server_pack_made:%'`);
  const due: string[] = [];
  for (const { key } of rows) {
    const id = key.slice(madeKey('').length);
    const ended = (await standingGate(packs, control, id))?.ended;
    if (ended && Date.parse(ended.delete_at) <= now.getTime()) due.push(id);
  }
  return due;
}
