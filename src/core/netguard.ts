import dns from 'node:dns/promises';
import net from 'node:net';
import { UserError } from './errors.js';

/** True for loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  // IPv4-mapped/translated forms, both dotted (::ffff:127.0.0.1) and hex (::ffff:7f00:1, 64:ff9b::7f00:1).
  const mapped = v.match(/^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    if (mapped[1]) return isPrivateAddress(mapped[1]);
    const hi = parseInt(mapped[2], 16);
    const lo = parseInt(mapped[3], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (v.startsWith('::ffff:')) return true; // any other mapped form: refuse rather than guess
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

/** Rejects URLs that would make the server fetch something on the local machine or network (SSRF). */
export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  const u = typeof raw === 'string' ? new URL(raw) : raw;
  if (!['http:', 'https:'].includes(u.protocol)) throw new UserError(`Only http(s) URLs are allowed: ${u.href}`);
  if (u.username || u.password) throw new UserError('URLs with embedded credentials are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new UserError(`Refusing to fetch a local address: ${host}`);
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new UserError(`Could not resolve ${host}.`);
  if (addrs.some(isPrivateAddress)) throw new UserError(`Refusing to fetch a private or local network address (${host}).`);
  return u;
}

/** fetch() that re-checks every redirect hop and caps the body size. */
export async function safeFetchText(url: string, opts: { maxBytes: number; timeoutMs: number; headers?: Record<string, string> }): Promise<{ text: string; type: string; finalUrl: string }> {
  let current = await assertPublicUrl(url);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, { headers: opts.headers, redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = await assertPublicUrl(new URL(res.headers.get('location')!, current));
      continue;
    }
    if (!res.ok) throw new UserError(`Could not download ${current.href} (HTTP ${res.status}).`);
    const reader = res.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > opts.maxBytes) {
        await reader.cancel();
        break; // keep what we have; documents are truncated, not rejected
      }
      parts.push(value);
    }
    return { text: Buffer.concat(parts).toString('utf8'), type: res.headers.get('content-type') ?? '', finalUrl: current.href };
  }
  throw new UserError('Too many redirects.');
}
