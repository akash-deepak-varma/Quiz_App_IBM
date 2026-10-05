import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UnsafeEndpointError } from '../lib/errors.js';
import { env } from '../config/env.js';

/**
 * Validation for user-supplied AI provider endpoints.
 *
 * Users can type any base URL into AI Settings, which makes the backend a potential HTTP proxy into
 * whatever it can reach -- the cloud metadata service, a database on the private network, the
 * loopback interface. This module is the only thing standing between those and a crafted endpoint.
 *
 * Three enforcement points, because none alone is sufficient:
 *   1. save   (PUT /api/me/ai-config)  -- fast, clear feedback for an honest mistake
 *   2. test   (POST .../test)          -- same, before anything is persisted
 *   3. every outbound request, via `createGuardedFetch` -- the load-bearing one, because both SDKs
 *      follow redirects, so a validated public host can still answer 302 -> 169.254.169.254.
 *
 * Re-resolving DNS on every request (3) also closes the rebinding gap between save time and use
 * time. A sub-millisecond TOCTOU window remains between the lookup and the socket connect; closing
 * that properly needs a pinned-IP custom agent, which is out of proportion for this prototype. It
 * is a known, accepted limit.
 */

// https is the only scheme unless AI_ALLOW_INSECURE_ENDPOINTS is explicitly on, which is the local
// "I run Ollama on my laptop" switch and which config/env.js refuses to accept in production.
// Loopback is likewise blocked by default and allowed only behind that same flag -- loopback is the
// SSRF target, not an exemption.
//
// Ports are an allowlist rather than a deny-list, because a deny-list never survives "what about
// port 9000?", and no real gateway needs an odd port. Note `new URL('https://x:443/')` normalises
// the port away to '', so '' is the common case and '443' is only ever seen pre-normalisation.
const HTTPS_PORTS = new Set(['', '443', '8443']);
const INSECURE_PORTS = new Set(['', '80', '443', '1234', '3000', '5000', '8000', '8080', '11434']);

function insecureAllowed() {
  return env.aiAllowInsecureEndpoints === true;
}

/** @returns {number[]|null} four octets, or null if not a valid IPv4 literal */
function ipv4Octets(value) {
  if (isIP(value) !== 4) return null;
  return value.split('.').map(Number);
}

function inIpv4Range(octets, [a, b, c, d], prefixBits) {
  const toInt = ([w, x, y, z]) => ((w << 24) | (x << 16) | (y << 8) | z) >>> 0;
  const mask = prefixBits === 0 ? 0 : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (toInt(octets) & mask) === (toInt([a, b, c, d]) & mask);
}

// Everything that is not a routable public address, plus the ranges that are routable but are
// never a legitimate AI endpoint.
const BLOCKED_IPV4 = [
  { net: [0, 0, 0, 0], bits: 8, label: 'unspecified' },
  { net: [10, 0, 0, 0], bits: 8, label: 'private' },
  { net: [100, 64, 0, 0], bits: 10, label: 'carrier-grade NAT' },
  { net: [127, 0, 0, 0], bits: 8, label: 'loopback' },
  // 169.254.0.0/16 is what makes the cloud metadata endpoint 169.254.169.254 unreachable.
  { net: [169, 254, 0, 0], bits: 16, label: 'link-local' },
  { net: [172, 16, 0, 0], bits: 12, label: 'private' },
  { net: [192, 0, 0, 0], bits: 24, label: 'IETF protocol assignment' },
  { net: [192, 168, 0, 0], bits: 16, label: 'private' },
  { net: [198, 18, 0, 0], bits: 15, label: 'benchmarking' },
  { net: [224, 0, 0, 0], bits: 4, label: 'multicast' },
  { net: [240, 0, 0, 0], bits: 4, label: 'reserved' },
];

/**
 * Expands an IPv6 literal to its 8 hextets, resolving `::` and any embedded IPv4 tail.
 * Returns null for anything it cannot parse, which callers treat as "block it".
 */
function expandIpv6(input) {
  let value = input;

  // Drop a zone index ("fe80::1%eth0") -- irrelevant here and not part of the address.
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);

  // An embedded IPv4 tail ("::ffff:127.0.0.1") becomes the two hextets it stands for, so the
  // IPv4-mapped forms of every blocked range are caught by the same checks.
  const lastColon = value.lastIndexOf(':');
  if (lastColon !== -1 && value.slice(lastColon + 1).includes('.')) {
    const octets = ipv4Octets(value.slice(lastColon + 1));
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array(missing).fill('0'), ...tail];
}

function blockedIpv6Reason(value) {
  const hextets = expandIpv6(value);
  if (!hextets) return 'unparseable IPv6 address';

  const words = hextets.map((h) => parseInt(h || '0', 16));
  if (words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) {
    return 'unparseable IPv6 address';
  }

  // An IPv4-mapped address was rewritten into the last two hextets above; re-check it as IPv4 so
  // "::ffff:169.254.169.254" cannot slip past the IPv4 range list.
  if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
    const octets = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
    const hit = BLOCKED_IPV4.find((range) => inIpv4Range(octets, range.net, range.bits));
    return hit ? `${hit.label} address` : null;
  }

  if (words.every((w) => w === 0)) return 'unspecified address';
  if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return 'loopback address';

  const first = words[0];
  // fc00::/7 -- unique-local, which includes the IPv6 metadata address fd00:ec2::254.
  if ((first & 0xfe00) === 0xfc00) return 'unique-local address';
  // fe80::/10 -- link-local.
  if ((first & 0xffc0) === 0xfe80) return 'link-local address';
  // ff00::/8 -- multicast.
  if ((first & 0xff00) === 0xff00) return 'multicast address';

  return null;
}

// Checked by name before DNS so the error can say "metadata service" rather than "link-local
// address". The IP forms are caught by the range checks regardless.
const NAMED_DENY = new Set([
  '169.254.169.254',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200',
]);

/**
 * @returns {string|null} a human-readable reason the address is unsafe, or null if it is fine.
 */
export function blockedAddressReason(address) {
  const version = isIP(address);
  if (version === 4) {
    const octets = ipv4Octets(address);
    if (!octets) return 'unparseable IPv4 address';
    if (address === '255.255.255.255') return 'broadcast address';
    const hit = BLOCKED_IPV4.find((range) => inIpv4Range(octets, range.net, range.bits));
    return hit ? `${hit.label} address` : null;
  }
  if (version === 6) return blockedIpv6Reason(address);
  return 'not an IP address';
}

/**
 * Structural checks only -- no DNS, so this is safe to call synchronously while validating a form.
 *
 * @returns {URL} the parsed URL
 * @throws {UnsafeEndpointError}
 */
export function validateAiBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new UnsafeEndpointError('API endpoint is required');
  }

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeEndpointError('API endpoint is not a valid URL');
  }

  const allowInsecure = insecureAllowed();

  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new UnsafeEndpointError(
      allowInsecure
        ? 'API endpoint must use https or http (other schemes, including file: and data:, are never allowed)'
        : 'API endpoint must use https'
    );
  }

  // Credentials in the URL would be sent to the upstream host and logged by it, and they are a
  // common way to smuggle a different host past naive parsers.
  if (url.username || url.password) {
    throw new UnsafeEndpointError('API endpoint must not contain a username or password');
  }

  const allowedPorts = allowInsecure ? INSECURE_PORTS : HTTPS_PORTS;
  if (!allowedPorts.has(url.port)) {
    throw new UnsafeEndpointError(
      `API endpoint port ${url.port} is not allowed (use the default port for ${url.protocol.replace(':', '')})`
    );
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (!allowInsecure) {
    if (host === 'localhost' || host.endsWith('.localhost')) {
      throw new UnsafeEndpointError('API endpoint must not point at localhost');
    }

    // A single-label hostname resolves through the machine's DNS search domains, which on a cloud
    // host points straight at internal infrastructure ("http://metadata").
    if (!host.includes('.') && isIP(host) === 0) {
      throw new UnsafeEndpointError('API endpoint hostname must be fully qualified (e.g. api.example.com)');
    }

    // Named denies checked before DNS, purely so the message is specific rather than generic.
    if (NAMED_DENY.has(host)) {
      throw new UnsafeEndpointError('API endpoint points at a cloud metadata service, which is not allowed');
    }
  }

  // A bare IP literal needs no DNS, so judge it now and give a precise message. Still enforced
  // under allowInsecure, except that loopback is permitted there.
  if (isIP(host) !== 0) {
    const literal = blockedAddressReason(host);
    if (literal && !(allowInsecure && literal === 'loopback address')) {
      throw new UnsafeEndpointError(`API endpoint resolves to a ${literal}, which is not allowed`);
    }
  }

  return url;
}

/**
 * Resolves the hostname and rejects it if *any* returned address is unsafe. Checking every record
 * matters: a hostname with one public and one private A record would otherwise pass.
 *
 * @throws {UnsafeEndpointError}
 */
export async function assertSafeHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const allowInsecure = insecureAllowed();

  // Loopback is the one range the local-development flag unblocks: it is the whole point of
  // pointing at Ollama or LM Studio on the same machine. Every other range stays blocked even then.
  const permitted = (reason) => reason === null || (allowInsecure && reason === 'loopback address');

  if (isIP(bare) !== 0) {
    const reason = blockedAddressReason(bare);
    if (!permitted(reason)) {
      throw new UnsafeEndpointError(`API endpoint resolves to a ${reason}, which is not allowed`);
    }
    return;
  }

  let addresses;
  try {
    addresses = await lookup(bare, { all: true, verbatim: true });
  } catch {
    // Deliberately does not echo the DNS error, which can contain the resolver's own detail.
    throw new UnsafeEndpointError('API endpoint hostname could not be resolved');
  }

  if (!addresses || addresses.length === 0) {
    throw new UnsafeEndpointError('API endpoint hostname could not be resolved');
  }

  for (const { address } of addresses) {
    const reason = blockedAddressReason(address);
    if (!permitted(reason)) {
      // Names the rule, never the resolved IP -- that would make this a DNS oracle.
      throw new UnsafeEndpointError(`API endpoint resolves to a ${reason}, which is not allowed`);
    }
  }
}

/** Structural + DNS validation. Use this anywhere a URL is about to be contacted. */
export async function assertSafeAiUrl(raw) {
  const url = validateAiBaseUrl(raw);
  await assertSafeHost(url.hostname);
  return url;
}

/**
 * A `fetch` to hand to the provider SDKs (both accept a `fetch` option:
 * @anthropic-ai/sdk index.d.ts `fetch?: Core.Fetch`, openai index.d.ts likewise).
 *
 * Re-validates every outgoing URL and refuses to follow redirects, which is what actually stops
 * a validated host from bouncing the request to an internal address.
 */
export function createGuardedFetch(fetchImpl = globalThis.fetch) {
  return async function guardedFetch(input, init = {}) {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input);

    await assertSafeAiUrl(target);

    const response = await fetchImpl(input, { ...init, redirect: 'manual' });

    // With redirect:'manual' the 3xx is returned rather than followed. Treating it as a failure --
    // instead of silently chasing it -- is the entire point.
    if (response.status >= 300 && response.status < 400) {
      throw new UnsafeEndpointError(
        `API endpoint returned a ${response.status} redirect; redirects are not followed for user-configured endpoints`
      );
    }

    return response;
  };
}
