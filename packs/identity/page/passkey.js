// Passkeys in the browser (packs/identity/kernel/passkeys.ts): one added for the address signed in, and a sign-in with
// any this device has for this server. The public key goes to the server as the browser gives it (SPKI), so nothing
// here reads CBOR.

import { authHeaders, postJson } from './base.js';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Whether this browser makes and uses passkeys at all. */
export const passkeysHere = () => typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials?.create);

const said = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'That did not work.');
  return body;
};

/** Add a passkey for the address signed in. Rejects with why not, a person's cancel among them. */
export async function addPasskey() {
  const o = await said(await postJson('/connect/passkey/add/options', {}, authHeaders()));
  const made = await navigator.credentials.create({
    publicKey: {
      challenge: unb64(o.challenge),
      rp: o.rp,
      user: { id: unb64(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.algs.map((alg) => ({ type: 'public-key', alg })),
      excludeCredentials: o.exclude.map((id) => ({ type: 'public-key', id: unb64(id) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      attestation: 'none',
    },
  });
  const r = made.response;
  return said(await postJson('/connect/passkey/add', { id: made.id, clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.getAuthenticatorData()), publicKey: b64(r.getPublicKey()), alg: r.getPublicKeyAlgorithm() }, authHeaders()));
}

/** Sign in with a passkey this device has: the ticket the server trades for a sign-in (POST /connect/verified). */
export async function passkeyTicket() {
  const o = await said(await postJson('/connect/passkey/options', {}));
  const got = await navigator.credentials.get({ publicKey: { challenge: unb64(o.challenge), rpId: o.rpId, userVerification: 'preferred' } });
  const r = got.response;
  return (await said(await postJson('/connect/passkey', { id: got.id, clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature) }))).ticket;
}
