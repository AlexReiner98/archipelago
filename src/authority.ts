// On whose authority something is done, as the log keeps it: a human acting is theirs; an agent says whether it is a
// human's word (and where it was said) or its own judgment, and the record keeps that the agent reported it.

import type { Authority } from './pelago.ts';

export function authorityOf(human: boolean, me: string, claimed?: Pick<Authority, 'of' | 'basis'>): Authority {
  if (human) return { of: 'human', who: me };
  if (claimed?.of !== 'human') return { of: 'agent', who: me, ...(claimed?.basis && { basis: claimed.basis }) };
  if (!claimed.basis?.trim()) throw new Error('Change rejected:\n- authority: to act on a human’s word, say what they said and where (authority.basis).');
  return { of: 'human', basis: claimed.basis, stated_by: me };
}
