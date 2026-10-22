// What a person agrees to before they are signed in: the documents a server pack declares (a service's terms, its
// privacy policy), each at a version. A server with no such pack asks for nothing. A person who has not agreed to a
// document's current version is shown it before a sign-in link or code is traded for a token, and agrees by ticking a
// box; a new version is agreed to again at the next sign-in. What each address agreed to, and when, is kept in the
// server's own database, every version of it, so the record says what was in force for them at any time.

import { controlValue, setControlValue } from './control.ts';
import type { Q } from './db.ts';

/** One document to agree to: where it is read and the version in force. */
export interface Agreement {
  id: string;
  title: string;
  url: string;
  version: string;
  /** The same document in other languages, each named in its own: shown beside it wherever it is agreed to. */
  also?: { title: string; url: string }[];
}

/** What one address agreed to: per document, each version with when and how. */
export type Agreed = Record<string, { version: string; at: string; via: string }[]>;

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const key = (email: string) => `agreed:${email}`;
const titled = (t: unknown): t is string => typeof t === 'string' && t.length > 0 && t.length <= 80;
const linked = (u: unknown): u is string => typeof u === 'string' && /^(\/(?!\/)|https:\/\/)[^\s"<>]{0,500}$/.test(u);

/** The documents a pack's answer names, those that are well formed; anything else in it is left out. */
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

/** What an address has agreed to. */
export const agreedBy = async (control: Q, email: string): Promise<Agreed> => (await controlValue<Agreed>(control, key(email))) ?? {};

/** Which of the documents in force an address has not agreed to at their current version. */
export const owed = (current: Agreement[], agreed: Agreed): Agreement[] => current.filter((a) => !(agreed[a.id] ?? []).some((v) => v.version === a.version));

/**
 * Record that an address agreed to the documents given, each as { id, version }. Only a version in force now counts;
 * one that has since changed is not recorded, and the person is asked again. Answers what is still owed.
 */
export async function recordAgreement(control: Q, email: string, given: unknown, current: Agreement[], via: string): Promise<Agreement[]> {
  const agreed = await agreedBy(control, email);
  const at = new Date().toISOString();
  let changed = false;
  for (const g of Array.isArray(given) ? given : []) {
    const doc = current.find((a) => a.id === g?.id && a.version === g?.version);
    if (!doc || (agreed[doc.id] ?? []).some((v) => v.version === doc.version)) continue;
    agreed[doc.id] = [...(agreed[doc.id] ?? []), { version: doc.version, at, via }];
    changed = true;
  }
  if (changed) await setControlValue(control, key(email), agreed);
  return owed(current, agreed);
}
