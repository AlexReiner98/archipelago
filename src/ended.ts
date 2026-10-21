// A workspace that has ended: what it holds can still be read and taken away (its backup), and nothing more can be
// written, until the day it is deleted from the server. A server pack ends a workspace it made (workspace.end, when
// its subscription has ended) and can take that back (when it is paid for again); the server deletes what is due, on
// its clock (src/workspaces.ts). Like a member limit, it is the server's to keep, in the control values of the
// default workspace's database: no one workspace's admin can lift it.
//
// The one write path (src/pelago.ts) asks stillWritable before every change; members (src/members.ts) before adding.

import { controlValue, setControlValue, takeControlValue } from './control.ts';
import type { Q } from './db.ts';

export interface Ended {
  /** When it ended, and when it is deleted. */
  since: string;
  delete_at: string;
  /** What the pack says to do about it ("Pay again at …"), and where. */
  note?: string;
  manage?: string;
}

const KEY = 'ended:';
/** How long an answer is kept here: every write asks, and another server may end or resume the workspace. */
const KEEP_MS = 10_000;

let source: (workspace: string) => Promise<Ended | undefined> = async () => undefined;
const kept = new Map<string, { at: number; value: Ended | undefined }>();

/** Where the server reads whether a workspace has ended: it says so when it starts. */
export function configureEnded(read: (workspace: string) => Promise<Ended | undefined>): void {
  source = read;
  kept.clear();
}

export async function endedOf(workspace: string): Promise<Ended | undefined> {
  const hit = kept.get(workspace);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const value = await source(workspace);
  kept.set(workspace, { at: Date.now(), value });
  return value;
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Refuse a write to a workspace that has ended, saying until when it can be taken away. */
export async function stillWritable(workspace: string): Promise<void> {
  const ended = await endedOf(workspace);
  if (!ended) return;
  throw new Error(`This workspace ended on ${day(ended.since)} and is read-only: it is deleted on ${day(ended.delete_at)}. Download its backup on the Workspace page.${ended.note ? ` ${ended.note}` : ''}`);
}

/** The control values: read, set and lifted only by the server and its packs. */
export const readEnded = (control: Q, workspace: string) => controlValue<Ended>(control, KEY + workspace);
export async function setEnded(control: Q, workspace: string, ended: Ended | null): Promise<void> {
  if (ended) await setControlValue(control, KEY + workspace, ended);
  else await takeControlValue(control, KEY + workspace);
  kept.delete(workspace);
}

/** The workspaces whose day to be deleted has come. */
export async function dueForDeletion(control: Q, now = new Date()): Promise<string[]> {
  const { rows } = await control.query<{ key: string }>(`select key from control_value where key like 'ended:%' and (value->>'delete_at')::timestamptz <= $1`, [now.toISOString()]);
  return rows.map((r) => r.key.slice(KEY.length));
}
