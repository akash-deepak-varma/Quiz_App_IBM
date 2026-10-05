import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';

// Endpoint validation resolves the hostname for real, so without this every case using a made-up
// host would 400 with "could not be resolved" -- and a case using a real host would make the suite
// depend on DNS. Answer with a public address; the SSRF cases below override it per test.
const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

const { app } = await import('../src/app.js');
import { prisma } from '../src/lib/prismaClient.js';
import { resetDb } from './setup/resetDb.js';
import { signupUser } from './setup/signup.js';
import { encryptApiKey } from '../src/lib/apiKeyCrypto.js';

const REAL_KEY = 'sk-super-secret-key-abcdef123456';

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

/**
 * A public endpoint is the only thing that could leak a stored key, so most of these cases are one
 * assertion: the key is not in the response, in any field, at any depth.
 */
function expectNoKeyAnywhere(body) {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain(REAL_KEY);
  expect(serialized).not.toContain('sk-');
  // The ciphertext must not leak either -- it is not plaintext, but it is not the client's business
  // and shipping it invites an offline attack if ENCRYPTION_KEY ever leaks.
  expect(serialized).not.toContain('v1.');
  expect(body.apiKey).toBeUndefined();
  expect(body.apiKeyCipher).toBeUndefined();
}

describe('GET /api/me/ai-config', () => {
  beforeEach(resetDb);

  it('returns a usable empty state rather than a 404 when nothing is saved', async () => {
    const token = await signupUser('fresh@example.com');

    const res = await request(app).get('/api/me/ai-config').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider: 'mock',
      baseUrl: null,
      model: null,
      hasApiKey: false,
    });
    // Sent so the frontend stops duplicating constants/enums.js AI_PROVIDERS.
    expect(res.body.providers).toEqual(['mock', 'claude', 'openai']);
    expect(res.body.defaults.claude.model).toBeTypeOf('string');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/me/ai-config');
    expect(res.status).toBe(401);
  });

  it('reports a stored key as a boolean and never returns the key itself', async () => {
    const token = await signupUser('haskey@example.com');
    const user = await prisma.user.findUnique({ where: { email: 'haskey@example.com' } });
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'claude',
        baseUrl: 'https://api.example.com/ica',
        model: 'claude-sonnet-5',
        apiKeyCipher: encryptApiKey(REAL_KEY, user.id),
      },
    });

    const res = await request(app).get('/api/me/ai-config').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(true);
    expect(res.body.provider).toBe('claude');
    expectNoKeyAnywhere(res.body);
  });
});

describe('PUT /api/me/ai-config', () => {
  beforeEach(resetDb);

  it('saves a configuration and encrypts the key at rest', async () => {
    const token = await signupUser('save@example.com');

    const res = await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', model: 'm1', apiKey: REAL_KEY });

    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(true);
    expectNoKeyAnywhere(res.body);

    const row = await prisma.userAiConfig.findFirst();
    // Stored ciphertext, not the key.
    expect(row.apiKeyCipher).not.toContain(REAL_KEY);
    expect(row.apiKeyCipher.startsWith('v1.')).toBe(true);
  });

  it('keeps the stored key when apiKey is omitted', async () => {
    const token = await signupUser('keep@example.com');
    await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', apiKey: REAL_KEY });

    // The client cannot send back a key it was never given, so an omitted apiKey has to mean "keep".
    const res = await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', model: 'changed' });

    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(true);
    expect(res.body.model).toBe('changed');
  });

  it('clears the stored key when apiKey is an empty string', async () => {
    const token = await signupUser('clear@example.com');
    await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', apiKey: REAL_KEY });

    const res = await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', apiKey: '' });

    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(false);
  });

  it('rejects an unknown provider', async () => {
    const token = await signupUser('badprovider@example.com');
    const res = await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'gemini', apiKey: REAL_KEY });

    expect(res.status).toBe(400);
  });

  it.each([
    ['a metadata address', 'https://169.254.169.254/latest/'],
    ['plain http', 'http://api.example.com'],
    ['localhost', 'https://localhost/v1'],
    ['a file URL', 'file:///etc/passwd'],
    ['credentials in the URL', 'https://u:p@api.example.com'],
  ])('rejects %s as an endpoint', async (_label, baseUrl) => {
    const token = await signupUser(`ssrf-${Math.random().toString(36).slice(2)}@example.com`);
    const res = await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl, apiKey: REAL_KEY });

    expect(res.status).toBe(400);
    expect(await prisma.userAiConfig.count()).toBe(0);
  });

  it('rejects a key containing a newline, which would be header injection', async () => {
    const token = await signupUser('inject@example.com');
    const res = await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', apiKey: 'abc\r\nX-Evil: 1' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot be sent in a request header/);
  });

  it('refuses an endpoint or model for the mock provider', async () => {
    const token = await signupUser('mockextra@example.com');
    const res = await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'mock', baseUrl: 'https://api.example.com' });

    expect(res.status).toBe(400);
  });

  it('keeps one user\'s configuration invisible to another', async () => {
    const tokenA = await signupUser('a@example.com');
    const tokenB = await signupUser('b@example.com');

    await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ provider: 'claude', baseUrl: 'https://a.example.com/ica', apiKey: REAL_KEY });

    const res = await request(app).get('/api/me/ai-config').set('Authorization', `Bearer ${tokenB}`);

    // B sees its own empty state, not A's row -- the requirement that users never share credentials.
    expect(res.body.hasApiKey).toBe(false);
    expect(res.body.baseUrl).toBeNull();
    expect(await prisma.userAiConfig.count()).toBe(1);
  });
});

describe('DELETE /api/me/ai-config', () => {
  beforeEach(resetDb);

  it('removes the row and returns the empty state', async () => {
    const token = await signupUser('del@example.com');
    await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', apiKey: REAL_KEY });

    const res = await request(app).delete('/api/me/ai-config').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(false);
    expect(await prisma.userAiConfig.count()).toBe(0);
  });

  it('is not an error when nothing was saved', async () => {
    const token = await signupUser('delnothing@example.com');
    const res = await request(app).delete('/api/me/ai-config').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/me/ai-config/test', () => {
  beforeEach(resetDb);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('succeeds for the mock provider without touching the network', async () => {
    const token = await signupUser('testmock@example.com');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await request(app)
      .post('/api/me/ai-config/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'mock' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // The guarantee that the app is demonstrable with no key at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to test a real provider with no key supplied and none saved', async () => {
    const token = await signupUser('nokey@example.com');

    const res = await request(app)
      .post('/api/me/ai-config/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Enter an API key/);
  });

  it('rejects a blocked endpoint before contacting anything', async () => {
    const token = await signupUser('testssrf@example.com');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await request(app)
      .post('/api/me/ai-config/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://169.254.169.254/', apiKey: REAL_KEY });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not record a test result when testing unsaved form values', async () => {
    const token = await signupUser('unsaved@example.com');
    await request(app)
      .put('/api/me/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'mock' });

    await request(app)
      .post('/api/me/ai-config/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'claude', baseUrl: 'https://api.example.com/ica', apiKey: REAL_KEY });

    const row = await prisma.userAiConfig.findFirst();
    // A failed experiment with a typed-in key must not mark a working saved config as broken.
    expect(row.lastTestStatus).toBeNull();
  });
});
