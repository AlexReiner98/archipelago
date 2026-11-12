// The loader root's parts of the schema's numbered steps (src/migrate.ts): what lives on an island.

import type { StepPart } from '../../database/kernel/migrate.ts';
import { ISLAND_INDEX } from './island-items.ts';

export const STEPS: StepPart[] = [
  { version: 32, name: 'what lives on an island', sql: ISLAND_INDEX },
];
