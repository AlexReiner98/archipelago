// Run once before the test files start (npm test): the blank database image they all start from (src/db.ts), made
// here once rather than in each of a dozen processes at once.
import { blankImageFile } from '../src/db.ts';

export async function globalSetup() {
  if (!process.env.PELAGO_TEST_DATABASE_URL) process.env.PELAGO_TEST_IMAGE ??= await blankImageFile();
}
