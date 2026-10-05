import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

const { prisma } = await import('../src/lib/prismaClient.js');
const { resetDb } = await import('./setup/resetDb.js');
const { resolveAiConfig, gradingProviderFor, toPublicAiConfig } = await import(
  '../src/services/aiConfigService.js'
);
const { encryptApiKey } = await import('../src/lib/apiKeyCrypto.js');
const { env } = await import('../src/config/env.js');
const { classifyError, FAILURE_CATEGORIES, isRetryable } = await import(
  '../src/services/generation/failureCategory.js'
);
const { MissingAiConfigError, AiConfigUnreadableError, UnsafeEndpointError } = await import(
  '../src/lib/errors.js'
);

const KEY = 'sk-a-users-own-key-1234567890';

async function makeUser(email) {
  const org = (await prisma.org.findFirst()) ?? (await prisma.org.create({ data: { name: 'T' } }));
  return prisma.user.create({
    data: { name: 'T', email, passwordHash: 'x', orgId: org.id },
  });
}

beforeEach(async () => {
  await resetDb();
  lookup.mockReset();
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('resolveAiConfig resolution order', () => {
  it('resolves mock with no user and no saved row at all', async () => {
    // Deliberately not asserted with a spy on prisma.userAiConfig: Prisma builds its delegates
    // lazily behind proxy getters, so vi.spyOn installs an own property that mockRestore then
    // leaves as undefined -- which breaks every later test in the file rather than failing this one.
    //
    // The guarantee that actually matters to a user is this one: mock needs no account
    // configuration whatsoever. The "makes no network call" half is pinned in
    // aiConfig.controller.test.js, which asserts global fetch is never called.
    const resolved = await resolveAiConfig({ requestedProvider: 'mock' });

    expect(resolved).toEqual({ provider: 'mock', runtime: null });
  });

  it('uses the user\'s own saved row and decrypts the key', async () => {
    const user = await makeUser('own@example.com');
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'claude',
        baseUrl: 'https://api.example.com/ica',
        model: 'm-user',
        apiKeyCipher: encryptApiKey(KEY, user.id),
      },
    });

    const { provider, runtime } = await resolveAiConfig({ userId: user.id, requestedProvider: 'claude' });

    expect(provider).toBe('claude');
    expect(runtime.apiKey).toBe(KEY);
    expect(runtime.model).toBe('m-user');
    expect(runtime.source).toBe('user');
  });

  it('falls back to the saved provider when the request names none', async () => {
    const user = await makeUser('default@example.com');
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'claude',
        baseUrl: 'https://api.example.com/ica',
        apiKeyCipher: encryptApiKey(KEY, user.id),
      },
    });

    const { provider } = await resolveAiConfig({ userId: user.id });
    expect(provider).toBe('claude');
  });

  it('does not hand an openai row\'s key to a claude request', async () => {
    const user = await makeUser('wrongprovider@example.com');
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'openai',
        baseUrl: 'https://api.example.com/ica/v1',
        apiKeyCipher: encryptApiKey(KEY, user.id),
      },
    });

    await expect(resolveAiConfig({ userId: user.id, requestedProvider: 'claude' })).rejects.toThrow(
      MissingAiConfigError
    );
  });

  it('throws MissingAiConfigError when nothing is saved and the env fallback is off', async () => {
    const user = await makeUser('nothing@example.com');
    expect(env.aiAllowEnvFallback).toBe(false); // the production setting, forced in test/setup/env.js

    await expect(resolveAiConfig({ userId: user.id, requestedProvider: 'claude' })).rejects.toThrow(
      /No API key is saved/
    );
  });

  it('surfaces an unreadable stored key as a re-enter-it message, not a generic failure', async () => {
    const user = await makeUser('corrupt@example.com');
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'claude',
        baseUrl: 'https://api.example.com/ica',
        // Shaped like a real packed value but not decryptable -- what a rotated ENCRYPTION_KEY or a
        // tampered row looks like.
        apiKeyCipher: 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCCCCCC',
      },
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolveAiConfig({ userId: user.id, requestedProvider: 'claude' })).rejects.toThrow(
      AiConfigUnreadableError
    );

    // Logged for diagnosis, but never the ciphertext and never the key.
    const logged = JSON.stringify(consoleSpy.mock.calls);
    expect(logged).toContain(user.id);
    expect(logged).not.toContain('v1.AAAA');
    consoleSpy.mockRestore();
  });

  it('refuses a saved row whose endpoint now resolves to a private address', async () => {
    const user = await makeUser('rebind@example.com');
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'claude',
        baseUrl: 'https://api.example.com/ica',
        apiKeyCipher: encryptApiKey(KEY, user.id),
      },
    });

    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    await expect(resolveAiConfig({ userId: user.id, requestedProvider: 'claude' })).rejects.toThrow(
      UnsafeEndpointError
    );
  });

  it('builds a distinct frozen runtime object per resolution', async () => {
    const user = await makeUser('distinct@example.com');
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'claude',
        baseUrl: 'https://api.example.com/ica',
        apiKeyCipher: encryptApiKey(KEY, user.id),
      },
    });

    const a = await resolveAiConfig({ userId: user.id, requestedProvider: 'claude' });
    const b = await resolveAiConfig({ userId: user.id, requestedProvider: 'claude' });

    // Identity is what the providers' WeakMap client cache keys on, so a new object per resolution
    // is what makes it "one client per request" rather than "one client forever".
    expect(a.runtime).not.toBe(b.runtime);
    expect(Object.isFrozen(a.runtime)).toBe(true);
  });

  it('keeps the key out of logs and JSON even if a runtime config is serialized', async () => {
    const user = await makeUser('redact@example.com');
    await prisma.userAiConfig.create({
      data: {
        userId: user.id,
        provider: 'claude',
        baseUrl: 'https://api.example.com/ica',
        apiKeyCipher: encryptApiKey(KEY, user.id),
      },
    });

    const { runtime } = await resolveAiConfig({ userId: user.id, requestedProvider: 'claude' });

    // errorHandler.js console.errors whole error objects on 5xx, so an accidental serialization is
    // a realistic path for a key to reach a log.
    expect(JSON.stringify(runtime)).not.toContain(KEY);
    expect(JSON.stringify(runtime)).toContain('[redacted]');
    // ...while the real value is still available to the provider that needs it.
    expect(runtime.apiKey).toBe(KEY);
  });
});

describe('gradingProviderFor', () => {
  it('keeps mock-generated quizzes on the mock grader', () => {
    // A mock quiz has fixture answers; grading them with a real model would make a retake's score
    // depend on whatever gateway the learner had configured that week.
    expect(gradingProviderFor('mock')).toBe('mock');
  });

  it('honours the recorded provider name for real quizzes', () => {
    expect(gradingProviderFor('claude')).toBe('claude');
    expect(gradingProviderFor('openai')).toBe('openai');
  });
});

describe('toPublicAiConfig', () => {
  it('reduces the stored ciphertext to a boolean and exposes no key field', () => {
    const publicShape = toPublicAiConfig({
      provider: 'claude',
      baseUrl: 'https://api.example.com/ica',
      model: 'm',
      apiKeyCipher: 'v1.a.b.c',
    });

    expect(publicShape.hasApiKey).toBe(true);
    expect(publicShape.apiKeyCipher).toBeUndefined();
    expect(JSON.stringify(publicShape)).not.toContain('v1.');
  });

  it('describes the empty state for a user with no row', () => {
    expect(toPublicAiConfig(null)).toMatchObject({ provider: 'mock', hasApiKey: false, baseUrl: null });
  });
});

/**
 * These pin string literals rather than behaviour, which is unusual and deliberate.
 *
 * lib/errors.js cannot import FAILURE_CATEGORIES (failureCategory.js already imports from
 * errors.js, so it would be a cycle), so each AI-config error carries the category as a bare
 * string. classifyError validates that string against its own map and silently falls through to
 * UNKNOWN if it does not match -- and UNKNOWN is retryable. So a typo would not break anything
 * loudly; it would just make these failures retry three times and report the wrong cause.
 */
describe('AI config errors classify as a non-retryable category', () => {
  it.each([
    ['MissingAiConfigError', () => new MissingAiConfigError('claude')],
    ['AiConfigUnreadableError', () => new AiConfigUnreadableError()],
    ['UnsafeEndpointError', () => new UnsafeEndpointError('nope')],
  ])('%s -> AI_CONFIG_MISSING', (_name, make) => {
    expect(classifyError(make())).toBe(FAILURE_CATEGORIES.AI_CONFIG_MISSING);
  });

  it('is not retried, because only the user can change the setting', () => {
    expect(isRetryable(FAILURE_CATEGORIES.AI_CONFIG_MISSING)).toBe(false);
    // The pre-existing non-retryable categories must keep their behaviour.
    expect(isRetryable(FAILURE_CATEGORIES.PROVIDER_4XX)).toBe(false);
    expect(isRetryable(FAILURE_CATEGORIES.CANCELLED)).toBe(false);
    expect(isRetryable(FAILURE_CATEGORIES.PROVIDER_5XX)).toBe(true);
  });

  it('classifies by the carried category, not by the 400 status it also has', () => {
    // BadRequestError sets statusCode 400, which classifyError would otherwise read as
    // PROVIDER_4XX. The pre-classification hook has to win.
    const err = new MissingAiConfigError('claude');
    expect(err.statusCode).toBe(400);
    expect(classifyError(err)).toBe(FAILURE_CATEGORIES.AI_CONFIG_MISSING);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
