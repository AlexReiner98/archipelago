// The seal root's parts of the schema's numbered steps (src/migrate.ts): the vault of per-item keys.

import type { StepPart } from '../../database/kernel/migrate.ts';
import { VAULT } from './vault.ts';

export const STEPS: StepPart[] = [
  // Forgetting, the write root's part, follows it (packs/write/kernel/steps.ts).
  { version: 20, name: 'per-item keys in a vault, and forgetting', sql: VAULT },
];
