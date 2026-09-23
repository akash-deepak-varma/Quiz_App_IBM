import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prismaClient.js';
import { runOneJob, claimNextJob } from '../src/services/generation/worker.js';
import * as mockProvider from '../src/providers/mockProvider.js';
import { resetDb } from './setup/resetDb.js';

async function signup(email) {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Test User', email, password: 'supersecret' });
  return res.body.token;
}

function enqueue(token, body) {
  return request(app).post('/api/quiz/generations').set('Authorization', `Bearer ${token}`).send(body);
}

describe('POST /api/quiz/generations', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('returns 202 with a job id instead of waiting for the quiz', async () => {
    const token = await signup('async-enqueue@example.com');

    const res = await enqueue(token, {
      topic: 'Recursion',
      difficulty: 'beginner',
      numQuestions: 6,
      typeMix: ['true_false'],
    });

    expect(res.status).toBe(202);
    expect(res.body.generationId).toBeTruthy();
    expect(res.body).toMatchObject({ status: 'PENDING', requested: 6, generated: 0 });
    // No quiz exists yet -- that is the whole point of the 202.
    expect(res.body.quizId).toBeUndefined();
    expect(await prisma.quiz.count()).toBe(0);
  });

  it('validates the body exactly as the synchronous endpoint does', async () => {
    const token = await signup('async-validate@example.com');

    expect((await enqueue(token, { difficulty: 'beginner', numQuestions: 3 })).status).toBe(400);
    expect((await enqueue(token, { topic: 'T', numQuestions: 0 })).status).toBe(400);
    expect((await enqueue(token, { topic: 'T', typeMix: ['nope'] })).status).toBe(400);
    expect((await enqueue(token, { topic: 'T', provider: 'gemini' })).status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/quiz/generations').send({ topic: 'T' });
    expect(res.status).toBe(401);
  });

  // `/api/quiz/:id` would happily match "generations" if the routers were mounted the other way
  // round, answering a job poll with "Quiz not found".
  it('is not shadowed by the quiz router\'s /:id route', async () => {
    const token = await signup('async-route@example.com');
    const { body } = await enqueue(token, { topic: 'Routing', numQuestions: 1, typeMix: ['true_false'] });

    const res = await request(app)
      .get(`/api/quiz/generations/${body.generationId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.generationId).toBe(body.generationId);
  });
});

describe('the generation worker', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('drives a queued job from PENDING to READY and materializes the quiz', async () => {
    const token = await signup('async-worker@example.com');
    const { body } = await enqueue(token, {
      topic: 'Closures',
      difficulty: 'intermediate',
      numQuestions: 6,
      typeMix: ['true_false', 'mcq'],
      tags: ['javascript'],
    });

    const outcome = await runOneJob();
    expect(outcome).toMatchObject({ id: body.generationId, status: 'READY', generated: 6 });

    const status = await request(app)
      .get(`/api/quiz/generations/${body.generationId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(status.body).toMatchObject({ status: 'READY', requested: 6, generated: 6 });
    expect(status.body.quizId).toBeTruthy();

    // The materialized quiz must be indistinguishable from one the synchronous endpoint produced --
    // same endpoint, same shape, same withheld fields.
    const quizRes = await request(app)
      .get(`/api/quiz/${status.body.quizId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(quizRes.status).toBe(200);
    expect(quizRes.body).toMatchObject({ topic: 'Closures', difficulty: 'intermediate', providerUsed: 'mock' });
    expect(quizRes.body.questions).toHaveLength(6);
    for (const question of quizRes.body.questions) {
      expect(question).not.toHaveProperty('correctAnswer');
      expect(question).not.toHaveProperty('explanation');
    }
    // Distinct prompts: proof that per-batch `startIndex` defeats the mock provider's collision.
    expect(new Set(quizRes.body.questions.map((q) => q.prompt)).size).toBe(6);

    const topic = await prisma.topic.findUnique({ where: { name: 'Closures' }, include: { tags: true } });
    expect(topic.tags.map((t) => t.name)).toEqual(['javascript']);
  });

  it('returns null when nothing is queued', async () => {
    expect(await runOneJob()).toBeNull();
  });

  it('leaves one row per batch attempt for observability', async () => {
    const token = await signup('async-telemetry@example.com');
    const { body } = await enqueue(token, { topic: 'Telemetry', numQuestions: 5, typeMix: ['true_false'] });

    await runOneJob();

    const batches = await prisma.generationBatch.findMany({ where: { generationId: body.generationId } });
    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches) {
      expect(batch.status).toBe('SUCCEEDED');
      expect(JSON.parse(batch.typesJson)).toEqual(['true_false']);
      expect(batch.attempt).toBeGreaterThanOrEqual(1);
    }
    const job = await prisma.quizGeneration.findUnique({ where: { id: body.generationId } });
    expect(job.attempts).toBe(batches.length);
    expect(job.planJson).toBeTruthy();
    expect(job.contextMode).toBe('DIRECT');
  });

  it('records a classified failure instead of one opaque error when the provider never complies', async () => {
    const token = await signup('async-failure@example.com');
    vi.spyOn(mockProvider, 'generateQuiz').mockRejectedValue(
      Object.assign(new Error('gateway exploded'), { status: 500 })
    );

    const { body } = await enqueue(token, { topic: 'Doomed', numQuestions: 2, typeMix: ['true_false'] });
    const outcome = await runOneJob();

    expect(outcome.status).toBe('FAILED');
    const job = await prisma.quizGeneration.findUnique({ where: { id: body.generationId } });
    expect(job).toMatchObject({ status: 'FAILED', generated: 0, failureCategory: 'PROVIDER_5XX' });
    expect(job.failureReason).toContain('gateway exploded');
    expect(job.finishedAt).toBeTruthy();
    expect(await prisma.quiz.count()).toBe(0);
  });

  // Half-generated work used to be unreachable: a crashed request left nothing behind at all.
  it('resumes a reclaimed job from the questions already staged', async () => {
    const token = await signup('async-resume@example.com');
    const { body } = await enqueue(token, { topic: 'Resumable', numQuestions: 6, typeMix: ['true_false'] });

    // Stand in for a worker that persisted two questions and then died mid-run: the job is left
    // GENERATING with an expired lease.
    await prisma.generatedQuestion.createMany({
      data: [0, 1].map((i) => ({
        generationId: body.generationId,
        batchKey: 'b1',
        type: 'true_false',
        prompt: `Salvaged question ${i}`,
        optionsJson: JSON.stringify(['true', 'false']),
        correctAnswer: JSON.stringify('true'),
        explanation: 'Salvaged from the previous run.',
      })),
    });
    await prisma.quizGeneration.update({
      where: { id: body.generationId },
      data: {
        status: 'GENERATING',
        generated: 2,
        attempts: 2,
        lockedBy: 'dead-worker',
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    const spy = vi.spyOn(mockProvider, 'generateQuiz');
    const outcome = await runOneJob();
    expect(outcome).toMatchObject({ status: 'READY', generated: 6 });

    // Only the shortfall was re-requested.
    const asked = spy.mock.calls.reduce((total, [args]) => total + args.numQuestions, 0);
    expect(asked).toBe(4);

    const quizRes = await request(app)
      .get(`/api/quiz/${outcome.quizId}`)
      .set('Authorization', `Bearer ${token}`);
    const prompts = quizRes.body.questions.map((q) => q.prompt);
    expect(prompts).toContain('Salvaged question 0');
    expect(prompts).toContain('Salvaged question 1');
    expect(new Set(prompts).size).toBe(6);
  });

  it('does not claim a GENERATING job whose lease is still fresh', async () => {
    const token = await signup('async-lease@example.com');
    const { body } = await enqueue(token, { topic: 'Leased', numQuestions: 1, typeMix: ['true_false'] });

    await prisma.quizGeneration.update({
      where: { id: body.generationId },
      data: { status: 'GENERATING', lockedBy: 'busy-worker', lockedAt: new Date() },
    });

    expect(await claimNextJob()).toBeNull();
  });

  it('claims the oldest job first', async () => {
    const token = await signup('async-fifo@example.com');
    const first = (await enqueue(token, { topic: 'First', numQuestions: 1, typeMix: ['true_false'] })).body;
    const second = (await enqueue(token, { topic: 'Second', numQuestions: 1, typeMix: ['true_false'] })).body;

    const claimed = await claimNextJob({ workerId: 'test-worker' });
    expect(claimed.id).toBe(first.generationId);
    expect(claimed.lockedBy).toBe('test-worker');
    expect(claimed.startedAt).toBeTruthy();
    expect(second.generationId).not.toBe(claimed.id);

    // The lease is only a lease if its clock agrees with everyone else's: `DateTime` columns hold
    // UTC, so a SQL `now()` written in the server's local zone would be off by the local offset and
    // silently break both expiry and every timestamp shown to the user.
    expect(Math.abs(claimed.lockedAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('refuses a job that a peer claimed between its own read and write', async () => {
    const token = await signup('async-contention@example.com');
    const { generationId } = (
      await enqueue(token, { topic: 'Contended', numQuestions: 1, typeMix: ['true_false'] })
    ).body;

    // Mutual exclusion used to be the database's job (`FOR UPDATE SKIP LOCKED`) and is now the
    // query's, because the claim repeats its own predicate inside the UPDATE. The interleaving that
    // matters is read-then-lose-the-row, and two live claims in one process will *not* produce it --
    // they serialise on the shared client, so both come back with one winner no matter what the
    // UPDATE checks. So worker-b's read is paused explicitly and worker-a claims inside that window.
    // Patched by hand rather than with vi.spyOn: Prisma's model delegates are proxy-backed, so
    // `mockRestore()` puts back undefined instead of the original method. The restore is the first
    // statement inside, before any await, so the pause is strictly one-shot even if this throws.
    const original = prisma.quizGeneration.findMany;
    let winner;
    prisma.quizGeneration.findMany = async (args) => {
      prisma.quizGeneration.findMany = original;
      const staleCandidates = await prisma.quizGeneration.findMany(args);
      winner = await claimNextJob({ workerId: 'worker-a' });
      return staleCandidates;
    };

    const loser = await claimNextJob({ workerId: 'worker-b' });

    expect(winner.id).toBe(generationId);
    expect(winner.lockedBy).toBe('worker-a');
    // The guard fired: worker-b's UPDATE matched zero rows, so it reports no job rather than
    // becoming a second owner of one already in flight.
    expect(loser).toBeNull();

    const stored = await prisma.quizGeneration.findUnique({ where: { id: generationId } });
    expect(stored.lockedBy).toBe('worker-a');
    expect(stored.status).toBe('GENERATING');
  });
});

describe('GET /api/quiz/generations/:id', () => {
  beforeEach(resetDb);

  it('reports progress while the job is still queued', async () => {
    const token = await signup('async-progress@example.com');
    const { body } = await enqueue(token, { topic: 'Progress', numQuestions: 10, typeMix: ['true_false'] });

    const res = await request(app)
      .get(`/api/quiz/generations/${body.generationId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      generationId: body.generationId,
      status: 'PENDING',
      requested: 10,
      generated: 0,
      topic: 'Progress',
      quizId: null,
    });
  });

  it('hides another user\'s generation behind a 404', async () => {
    const owner = await signup('async-owner@example.com');
    const stranger = await signup('async-stranger@example.com');
    const { body } = await enqueue(owner, { topic: 'Private', numQuestions: 1, typeMix: ['true_false'] });

    const res = await request(app)
      .get(`/api/quiz/generations/${body.generationId}`)
      .set('Authorization', `Bearer ${stranger}`);

    expect(res.status).toBe(404);
  });

  it('404s an unknown id', async () => {
    const token = await signup('async-missing@example.com');
    const res = await request(app)
      .get('/api/quiz/generations/does-not-exist')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/quiz/generations/:id/cancel', () => {
  beforeEach(resetDb);

  it('cancels a job the worker has not claimed yet, and no provider call is made', async () => {
    const token = await signup('async-cancel@example.com');
    const { body } = await enqueue(token, { topic: 'Cancelled', numQuestions: 8, typeMix: ['true_false'] });

    const res = await request(app)
      .post(`/api/quiz/generations/${body.generationId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    const spy = vi.spyOn(mockProvider, 'generateQuiz');
    expect(await runOneJob()).toBeNull(); // no longer claimable
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stops a claimed job between batch attempts', async () => {
    const token = await signup('async-cancel-running@example.com');
    const { body } = await enqueue(token, { topic: 'Stopping', numQuestions: 8, typeMix: ['true_false'] });

    // Flag it mid-flight: the worker checks cancellation before each attempt, so the job ends
    // CANCELLED without materializing a quiz.
    await prisma.quizGeneration.update({ where: { id: body.generationId }, data: { cancelRequested: true } });

    const outcome = await runOneJob();
    expect(outcome.status).toBe('CANCELLED');
    expect(await prisma.quiz.count()).toBe(0);

    const job = await prisma.quizGeneration.findUnique({ where: { id: body.generationId } });
    expect(job.failureCategory).toBe('CANCELLED');
    expect(job.finishedAt).toBeTruthy();
  });

  it('409s a generation that has already finished', async () => {
    const token = await signup('async-cancel-late@example.com');
    const { body } = await enqueue(token, { topic: 'Too late', numQuestions: 2, typeMix: ['true_false'] });
    await runOneJob();

    const res = await request(app)
      .post(`/api/quiz/generations/${body.generationId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
  });
});
