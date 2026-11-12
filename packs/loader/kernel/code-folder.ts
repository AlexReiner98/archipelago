// Kernel code runs only from the server's own folder (docs/kernel-packs.md, "The manifest key kernel"): where an internal
// pack's modules are loaded from, for its hooks, its names and its log.appended filling alike.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isRequired, type Manifest } from './manifest.ts';
import { OWN_PACKS } from './pack-folders.ts';
import type { Registry } from './packs.ts';

/**
 * Where an internal pack's code is loaded from: a required one's always from the server's own folder (OWN_PACKS), whatever
 * folder the registry read its manifest from (a test's copied packs), so the process runs one copy of it; an optional one
 * from where the registry found it.
 */
export const codeFolder = (reg: Pick<Registry, 'folderOf'>, pack: Manifest): string =>
  isRequired(pack) && existsSync(join(OWN_PACKS, pack.id, 'pack.json')) ? join(OWN_PACKS, pack.id) : reg.folderOf(pack.id);

