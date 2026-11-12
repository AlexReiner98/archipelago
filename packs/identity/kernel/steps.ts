// The identity root's parts of the schema's numbered steps (packs/database/kernel/migrate.ts): what the server kept on its disk, kept in
// the default database (packs/identity/kernel/control.ts).

import type { StepPart } from '../../database/kernel/migrate.ts';
import { ADOPT_APP, CONTROL, PACK_STORE } from './control.ts';

export const STEPS: StepPart[] = [
  { version: 4, name: 'what the server kept on its disk', sql: CONTROL },
  { version: 8, name: 'what a server pack keeps', sql: PACK_STORE },
  { version: 13, name: 'the GitHub App as a server pack', sql: ADOPT_APP },
];
