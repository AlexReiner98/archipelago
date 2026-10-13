// Where a request came from, when there are proxies in front of the server.
// Each proxy adds the address it was reached from to the end of
// x-forwarded-for, after whatever the caller wrote there himself. So the
// list is read from its end: past the proxies we trust, the first address
// that is not one of them is the caller. What stands before it the caller
// could have written, and is not believed.
//
// Trusted without being told: this machine and private networks, which is
// where a hosting platform's own balancer reaches the server from. Beyond
// that the server is told (PELAGO_TRUSTED_PROXIES): networks as CIDR, or the
// word "cloudflare" for Cloudflare's published ones.

import { BlockList, isIP } from 'node:net';
import { env } from './env.ts';

const PRIVATE = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'];
/** https://www.cloudflare.com/ips/ as read on 13 Oct 2026. */
const CLOUDFLARE = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

const family = (address: string) => (isIP(address) === 6 ? 'ipv6' : 'ipv4');
/** An address as it is compared: an IPv4 one written as IPv6 (::ffff:10.0.0.1) is the IPv4 one. */
const plain = (address: string | undefined) => (address ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

/**
 * The proxies whose word is taken for where a request came from: private
 * networks always, and what `named` adds, comma separated: networks as CIDR,
 * single addresses, or "cloudflare".
 */
export function trustedProxies(named?: string): BlockList {
  const list = new BlockList();
  const given = (named ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  for (const part of [...PRIVATE, ...given.flatMap((g) => (g.toLowerCase() === 'cloudflare' ? CLOUDFLARE : [g]))]) {
    const [address, bits] = part.split('/');
    if (!isIP(address) || (bits !== undefined && !/^\d+$/.test(bits))) throw new Error(`PELAGO_TRUSTED_PROXIES: "${part}" is not an address, a network as CIDR (203.0.113.0/24) or "cloudflare".`);
    if (bits === undefined) list.addAddress(address, family(address));
    else list.addSubnet(address, Number(bits), family(address));
  }
  return list;
}

/**
 * The address a request came from: the last in the chain (what the caller
 * and each proxy said, then the connection itself) that is not a trusted
 * proxy. When every one is, the request is from inside, and it is the first.
 */
export function clientAddress(forwarded: string | string[] | undefined, peer: string | undefined, trusted: BlockList): string {
  const said = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').map(plain).filter(Boolean);
  const chain = [...said, plain(peer)].filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    // What is not an address at all was not written by a proxy: nothing before it is believed either.
    if (!isIP(chain[i])) return chain[i + 1] ?? chain[i];
    if (!trusted.check(chain[i], family(chain[i]))) return chain[i];
  }
  return chain[0] ?? '';
}
