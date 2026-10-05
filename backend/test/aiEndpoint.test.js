import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the module under test sees the mock when it imports node:dns/promises.
const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

const {
  validateAiBaseUrl,
  assertSafeHost,
  assertSafeAiUrl,
  blockedAddressReason,
  createGuardedFetch,
} = await import('../src/validation/aiEndpoint.js');

/** Make DNS answer with whatever addresses a case needs. */
function resolvesTo(...addresses) {
  lookup.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  );
}

beforeEach(() => {
  lookup.mockReset();
  resolvesTo('93.184.216.34'); // a public address, so the default case passes
});

describe('blockedAddressReason', () => {
  it('allows ordinary public addresses', () => {
    expect(blockedAddressReason('93.184.216.34')).toBeNull();
    expect(blockedAddressReason('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
  });

  it.each([
    ['169.254.169.254', 'the cloud metadata address'],
    ['127.0.0.1', 'IPv4 loopback'],
    ['10.1.2.3', 'private 10/8'],
    ['172.16.5.4', 'private 172.16/12'],
    ['192.168.1.1', 'private 192.168/16'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'unspecified'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
  ])('blocks %s (%s)', (address) => {
    expect(blockedAddressReason(address)).toBeTruthy();
  });

  it.each([
    ['::1', 'IPv6 loopback'],
    ['::', 'unspecified'],
    ['fd00:ec2::254', 'the IPv6 metadata address, inside fc00::/7'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
  ])('blocks %s (%s)', (address) => {
    expect(blockedAddressReason(address)).toBeTruthy();
  });

  // The classic bypass: a checker that only pattern-matches IPv4 strings lets the mapped form of a
  // blocked range straight through.
  it('blocks IPv4-mapped IPv6 forms of blocked ranges', () => {
    expect(blockedAddressReason('::ffff:169.254.169.254')).toBeTruthy();
    expect(blockedAddressReason('::ffff:127.0.0.1')).toBeTruthy();
    expect(blockedAddressReason('::ffff:10.0.0.1')).toBeTruthy();
  });

  it('still allows an IPv4-mapped public address', () => {
    expect(blockedAddressReason('::ffff:93.184.216.34')).toBeNull();
  });
});

describe('validateAiBaseUrl', () => {
  it('accepts a plain https URL with a path', () => {
    const url = validateAiBaseUrl('https://api.example.com/ica');
    expect(url.hostname).toBe('api.example.com');
  });

  it('rejects http when insecure endpoints are not allowed', () => {
    expect(() => validateAiBaseUrl('http://api.example.com')).toThrow(/must use https/);
  });

  it.each(['file:///etc/passwd', 'data:text/plain,hello', 'ftp://example.com', 'gopher://example.com'])(
    'rejects the scheme in %s',
    (raw) => {
      expect(() => validateAiBaseUrl(raw)).toThrow(/must use https/);
    }
  );

  it('rejects credentials embedded in the URL', () => {
    expect(() => validateAiBaseUrl('https://user:secret@api.example.com')).toThrow(/username or password/);
  });

  it('rejects a non-allowlisted port', () => {
    expect(() => validateAiBaseUrl('https://api.example.com:9000')).toThrow(/port 9000 is not allowed/);
  });

  it('accepts the allowlisted ports', () => {
    expect(() => validateAiBaseUrl('https://api.example.com:443')).not.toThrow();
    expect(() => validateAiBaseUrl('https://api.example.com:8443')).not.toThrow();
  });

  it('rejects localhost by name', () => {
    expect(() => validateAiBaseUrl('https://localhost/v1')).toThrow(/localhost/);
  });

  it('rejects a single-label hostname, which resolves through DNS search domains', () => {
    expect(() => validateAiBaseUrl('https://metadata/latest')).toThrow(/fully qualified/);
  });

  it('rejects a bare blocked IP literal without needing DNS', () => {
    expect(() => validateAiBaseUrl('https://169.254.169.254/latest/meta-data/')).toThrow(/not allowed/);
    expect(() => validateAiBaseUrl('https://[::1]/v1')).toThrow(/not allowed/);
  });

  it('rejects an unparseable URL and a missing one', () => {
    expect(() => validateAiBaseUrl('not a url')).toThrow(/valid URL/);
    expect(() => validateAiBaseUrl('')).toThrow(/required/);
    expect(() => validateAiBaseUrl(undefined)).toThrow(/required/);
  });
});

describe('assertSafeHost', () => {
  it('passes a hostname that resolves to a public address', async () => {
    resolvesTo('93.184.216.34');
    await expect(assertSafeHost('api.example.com')).resolves.toBeUndefined();
  });

  it('rejects a hostname that resolves to a private address (DNS rebinding)', async () => {
    resolvesTo('10.0.0.5');
    await expect(assertSafeHost('rebind.example.com')).rejects.toThrow(/private address/);
  });

  // Checking only the first record would let this through.
  it('rejects when ANY resolved address is blocked, not just the first', async () => {
    resolvesTo('93.184.216.34', '169.254.169.254');
    await expect(assertSafeHost('mixed.example.com')).rejects.toThrow(/not allowed/);
  });

  it('rejects a hostname that does not resolve, without echoing the resolver error', async () => {
    lookup.mockRejectedValue(new Error('queryA ENOTFOUND internal-detail.example'));
    await expect(assertSafeHost('nope.example.com')).rejects.toThrow(/could not be resolved/);
    await expect(assertSafeHost('nope.example.com')).rejects.not.toThrow(/internal-detail/);
  });

  it('rejects an empty DNS answer', async () => {
    lookup.mockResolvedValue([]);
    await expect(assertSafeHost('empty.example.com')).rejects.toThrow(/could not be resolved/);
  });

  // Naming the resolved IP would turn this endpoint into a DNS oracle for internal networks.
  it('never names the resolved address in the error', async () => {
    resolvesTo('192.168.33.44');
    await expect(assertSafeHost('rebind.example.com')).rejects.not.toThrow(/192\.168\.33\.44/);
  });
});

describe('createGuardedFetch', () => {
  let fetchImpl;

  beforeEach(() => {
    fetchImpl = vi.fn().mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('validates the URL and forwards the request with redirects disabled', async () => {
    resolvesTo('93.184.216.34');
    const guarded = createGuardedFetch(fetchImpl);

    await guarded('https://api.example.com/v1/messages', { method: 'POST', body: '{}' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' });
  });

  // The hole that save-time validation alone cannot close: both SDKs follow redirects, so a
  // validated public host could bounce the request to an internal address.
  it('refuses to follow a redirect rather than chasing it', async () => {
    resolvesTo('93.184.216.34');
    fetchImpl.mockResolvedValue({ status: 302, headers: new Map([['location', 'http://169.254.169.254/']]) });
    const guarded = createGuardedFetch(fetchImpl);

    await expect(guarded('https://api.example.com/v1/messages')).rejects.toThrow(/redirect/i);
  });

  it('re-validates on every call, so a rebind between calls is caught', async () => {
    const guarded = createGuardedFetch(fetchImpl);

    resolvesTo('93.184.216.34');
    await expect(guarded('https://api.example.com/v1')).resolves.toMatchObject({ status: 200 });

    // Same URL, DNS now answers with a metadata address.
    resolvesTo('169.254.169.254');
    await expect(guarded('https://api.example.com/v1')).rejects.toThrow(/not allowed/);

    // The second request never reached the network.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a blocked URL before making any request at all', async () => {
    const guarded = createGuardedFetch(fetchImpl);
    await expect(guarded('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('assertSafeAiUrl', () => {
  it('combines the structural and DNS checks', async () => {
    resolvesTo('93.184.216.34');
    await expect(assertSafeAiUrl('https://api.example.com/ica')).resolves.toBeDefined();

    resolvesTo('127.0.0.1');
    await expect(assertSafeAiUrl('https://api.example.com/ica')).rejects.toThrow(/loopback/);
  });
});
