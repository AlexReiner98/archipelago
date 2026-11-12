// What the surface's server holds of this pack for the whole process (surface.mail, packs/surface/kernel/above.ts):
// an address as the server reads one, the relay's bounces, and the mail a server pack sends. What a bounce is kept as
// is read on the map that keeps it (surface.bounced, surface.note_bounced: ./bounces.ts).

import type { KernelContext } from '#pelago/kernel';
import { BOUNCED_DAYS, failedFor, fromRelay } from './bounces.ts';
import { normalEmail, sendMail, setBounced } from './mail.ts';

export const served = (_ctx: KernelContext) => ({ email: normalEmail, sendMail, setBounced, bounces: { fromRelay, failedFor, days: BOUNCED_DAYS } });
