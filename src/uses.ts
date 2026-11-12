// Moved to the usage pack (docs/kernel-packs.md, "Where each module goes"): this shim keeps its importers working until
// the gather step rewrites them. They name a workspace, not a map, so a use is counted with the usage pack's server
// context (serverContext), which calls root.uses and nothing else; it is counted a moment later, never awaited.

import type { KernelContext } from './kernel-context.ts';
import type { RootCall } from './root-calls.ts';
import * as moved from '../packs/usage/kernel/uses.ts';

export * from '../packs/usage/kernel/uses.ts';

/** The server's workspaces, which counting a use never needs. */
const NONE = new Proxy({}, { get: () => () => { throw new Error('Counting a use needs no workspace of the server'); } }) as NonNullable<RootCall['workspaces']>;
let server: Promise<KernelContext> | undefined;
/** The usage pack's server context, made once. */
const ctx = () => (server ??= import('./kernel-context.ts').then((k) => k.serverContext('usage', NONE)));

/** Count one use of a declaration on a workspace. */
export const used = (workspace: string, kind: moved.UseKind, id: string, n = 1): void => {
  if (id) void ctx().then((c) => moved.used(c, kind, id, n, workspace)).catch((err: Error) => console.error(`counting a use on ${workspace} failed: ${err.message}`));
};
