// Calls this server makes to an address someone gave it: a workspace's model server, a connection to check. Such a
// call follows no redirect, and where the server refuses its own network (PELAGO_PRIVATE_URLS=off, or
// PELAGO_MODEL_PRIVATE_URLS=off as it was first named) it connects to no private address. The address checked is
// the one the socket is handed, on every call: a name that answered with a public address when it was saved, or a
// public host that redirects, reaches nothing inside (the audit of 29 Oct 2026).

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { env } from './env.ts';

/** What no call to an address someone gave may reach: private, shared, link-local, reserved and multicast ranges. */
const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

/** The eight groups of an IPv6 address, as numbers; a dotted IPv4 tail is two of them. */
function groups(ip: string): number[] {
  const part = (x: string | undefined) =>
    x ? x.split(':').flatMap((g) => (g.includes('.') ? ((o) => [(o[0] << 8) | o[1], (o[2] << 8) | o[3]])(g.split('.').map(Number)) : [parseInt(g, 16)])) : [];
  const [head, tail] = ip.split('::');
  const h = part(head), t = part(tail);
  return tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill(0), ...t];
}
const dotted = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * The IPv4 address an IPv6 one carries, where a network may route to it: mapped (::ffff:0:0/96), compatible
 * (::/96), NAT64 (64:ff9b::/96 and 64:ff9b:1::/48) and 6to4 (2002::/16).
 */
function carried(ip: string): string | undefined {
  const g = groups(ip.replace(/%.*$/, ''));
  if (g.length !== 8 || g.some((x) => !Number.isInteger(x))) return undefined;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return dotted(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && (g[2] === 1 || g.slice(2, 6).every((x) => x === 0))) return dotted(g[6], g[7]);
  if (g[0] === 0x2002) return dotted(g[1], g[2]);
  return undefined;
}

/** Whether an address is on a private network, this machine's own included, or carries one that is. */
export const isPrivate = (ip: string): boolean => {
  if (isIP(ip) !== 6) return PRIVATE.check(ip, 'ipv4');
  const v4 = carried(ip);
  return PRIVATE.check(ip, 'ipv6') || (v4 !== undefined && PRIVATE.check(v4, 'ipv4'));
};

/** Whether a host name is this machine's by its name alone. */
export const localName = (host: string) => host === 'localhost' || host.endsWith('.localhost');

/** Whether this server refuses to call addresses on its own network. */
export const privateRefused = () => /^(off|false|0|no)$/i.test((env('PRIVATE_URLS') ?? env('MODEL_PRIVATE_URLS'))?.trim() ?? '');

export const REFUSED = 'This server does not call addresses on its own network.';

/** A lookup that hands the socket no private address. */
const publicOnly: LookupFunction = (name, options, done) =>
  dnsLookup(name, options, (err, address, family) => {
    if (err) return done(err, address as string, family);
    const all = Array.isArray(address) ? (address as LookupAddress[]).map((a) => a.address) : [address as string];
    if (all.some(isPrivate)) return done(Object.assign(new Error(REFUSED), { code: 'EREFUSED' }), address as string, family);
    done(null, address as string, family);
  });

/** A fetch for an address someone gave: no redirect followed, and no private address reached where they are refused. */
export const guardedFetch: typeof fetch = async (input, init = {}) => {
  if (!privateRefused()) return fetch(input, { ...init, redirect: 'error' });
  const url = new URL(input instanceof Request ? input.url : String(input));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (localName(host) || (isIP(host) && isPrivate(host))) throw new TypeError(REFUSED);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  return new Promise<Response>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: init.method ?? 'GET', headers, lookup: publicOnly, signal: init.signal ?? undefined }, (res) => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        res.resume();
        return reject(new TypeError('A redirect is not followed.'));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
        resolve(new Response([204, 205].includes(status) ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage, headers: h }));
      });
    });
    req.on('error', reject);
    req.end(typeof init.body === 'string' ? init.body : undefined);
  });
};
