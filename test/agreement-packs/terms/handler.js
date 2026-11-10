// The tests' documents: a terms and a privacy policy at fixed versions, said at the signin gate, which keeps what each
// address agreed to in the pack's own store (by a hash of the address, since a key holds no @), as a service's legal
// pack does.
import { createHash } from 'node:crypto';

const keyOf = (email) => `agreed:${createHash('sha256').update(email).digest('hex')}`;
const DOCUMENTS = [
  { id: 'terms', title: 'Terms of Service', url: '/x/terms/terms', version: '2026-10-21', also: [{ title: "Conditions d'utilisation", url: '/x/terms/terms_fr' }, { title: 'Bad', url: 'javascript:alert(1)' }] },
  { id: 'privacy', title: 'Privacy Policy', url: 'https://example.com/privacy', version: 'v1' },
  { id: 'Bad id', title: 'Left out', url: '/x', version: '1' },
];

export default {
  async signin({ email, agree, via }, ctx) {
    if (!email) return { answer: { documents: DOCUMENTS } };
    const agreed = (await ctx.store.get(keyOf(email))) ?? {};
    for (const g of Array.isArray(agree) ? agree : []) {
      const doc = DOCUMENTS.find((d) => d.id === g?.id && d.version === g?.version);
      if (doc && !(agreed[doc.id] ?? []).some((v) => v.version === doc.version)) agreed[doc.id] = [...(agreed[doc.id] ?? []), { version: doc.version, at: ctx.now, via }];
    }
    await ctx.store.put(keyOf(email), agreed);
    return { answer: { documents: DOCUMENTS, owes: DOCUMENTS.filter((d) => !(agreed[d.id] ?? []).some((v) => v.version === d.version)).map((d) => d.id) } };
  },
};
