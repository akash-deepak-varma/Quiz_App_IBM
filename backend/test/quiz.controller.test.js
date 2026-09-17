import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prismaClient.js';

async function resetDb() {
  await prisma.answerLog.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.userBadge.deleteMany();
  await prisma.streak.deleteMany();
  await prisma.question.deleteMany();
  await prisma.quiz.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.user.deleteMany();
  await prisma.org.deleteMany();
}

async function signup(email) {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Test User', email, password: 'supersecret' });
  return res.body.token;
}

describe('POST /api/quiz/generate', () => {
  beforeEach(resetDb);

  it('creates a quiz and withholds correctAnswer/explanation from the response', async () => {
    const token = await signup('generator@example.com');

    const res = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'Loops', difficulty: 'beginner', numQuestions: 3, typeMix: ['true_false'] });

    expect(res.status).toBe(201);
    expect(res.body.questions).toHaveLength(3);
    for (const q of res.body.questions) {
      expect(q).not.toHaveProperty('correctAnswer');
      expect(q).not.toHaveProperty('explanation');
      expect(q.type).toBe('true_false');
    }
  });

  it('rejects a request with no topic with 400', async () => {
    const token = await signup('badrequest@example.com');
    const res = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ difficulty: 'beginner', numQuestions: 3 });
    expect(res.status).toBe(400);
  });

  it('returns 429 once the hourly generation limit is exceeded', async () => {
    const token = await signup('ratelimited@example.com');
    const payload = { topic: 'Rate limiting', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] };

    let lastStatus;
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app)
        .post('/api/quiz/generate')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('POST /api/quiz/:id/submit', () => {
  beforeEach(resetDb);

  it('grades a fully-correct submission and reveals correctAnswer/explanation', async () => {
    const token = await signup('submitter@example.com');
    const generateRes = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'True or false', difficulty: 'beginner', numQuestions: 2, typeMix: ['true_false'] });

    const quizId = generateRes.body.quizId;
    const answers = generateRes.body.questions.map((q) => ({ questionId: q.id, userAnswer: 'true' }));
    const promptsByQuestionId = new Map(generateRes.body.questions.map((q) => [q.id, q.prompt]));

    const submitRes = await request(app)
      .post(`/api/quiz/${quizId}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers, timeSpentSeconds: 42 });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.score).toBe(1);
    expect(submitRes.body.results).toHaveLength(2);
    for (const result of submitRes.body.results) {
      expect(result.isCorrect).toBe(true);
      expect(result.correctAnswer).toBe('true');
      expect(result.explanation).toBeTypeOf('string');
      expect(result.prompt).toBe(promptsByQuestionId.get(result.questionId));
    }
    expect(Array.isArray(submitRes.body.newBadges)).toBe(true);
    expect(submitRes.body.streak.current).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 when submitting to a quiz owned by a different user', async () => {
    const ownerToken = await signup('owner@example.com');
    const intruderToken = await signup('intruder@example.com');

    const generateRes = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ topic: 'Ownership', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });

    const quizId = generateRes.body.quizId;

    const submitRes = await request(app)
      .post(`/api/quiz/${quizId}/submit`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ answers: [{ questionId: generateRes.body.questions[0].id, userAnswer: 'true' }] });

    expect(submitRes.status).toBe(404);
  });
});

describe('PATCH /api/quiz/:quizId/questions/:questionId', () => {
  beforeEach(resetDb);

  it('updates a question on a quiz with no attempts yet', async () => {
    const token = await signup('editor@example.com');
    const generateRes = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'Editing', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });
    const quizId = generateRes.body.quizId;
    const questionId = generateRes.body.questions[0].id;

    const res = await request(app)
      .patch(`/api/quiz/${quizId}/questions/${questionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'Edited prompt', explanation: 'Edited explanation' });

    expect(res.status).toBe(200);
    expect(res.body.prompt).toBe('Edited prompt');
    expect(res.body.explanation).toBe('Edited explanation');
    expect(res.body.correctAnswer).toBe('true');
  });

  it('returns 409 once the quiz has an attempt', async () => {
    const token = await signup('editor-locked@example.com');
    const generateRes = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'Editing locked', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });
    const quizId = generateRes.body.quizId;
    const questionId = generateRes.body.questions[0].id;

    await request(app)
      .post(`/api/quiz/${quizId}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ questionId, userAnswer: 'true' }] });

    const res = await request(app)
      .patch(`/api/quiz/${quizId}/questions/${questionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'Should not apply' });

    expect(res.status).toBe(409);
  });

  it('returns 404 when the quiz is owned by a different user', async () => {
    const ownerToken = await signup('edit-owner@example.com');
    const intruderToken = await signup('edit-intruder@example.com');
    const generateRes = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ topic: 'Edit ownership', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });
    const quizId = generateRes.body.quizId;
    const questionId = generateRes.body.questions[0].id;

    const res = await request(app)
      .patch(`/api/quiz/${quizId}/questions/${questionId}`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ prompt: 'Hijacked' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/quiz/:quizId/questions/:questionId/regenerate', () => {
  beforeEach(resetDb);

  it('regenerates a question on a quiz with no attempts yet', async () => {
    const token = await signup('regen@example.com');
    const generateRes = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'Regenerating', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });
    const quizId = generateRes.body.quizId;
    const questionId = generateRes.body.questions[0].id;

    const res = await request(app)
      .post(`/api/quiz/${quizId}/questions/${questionId}/regenerate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(questionId);
    expect(res.body.type).toBe('true_false');
    expect(res.body.prompt).toBeTypeOf('string');
    expect(res.body.correctAnswer).toBeTruthy();
  });

  it('returns 409 once the quiz has an attempt', async () => {
    const token = await signup('regen-locked@example.com');
    const generateRes = await request(app)
      .post('/api/quiz/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'Regenerate locked', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });
    const quizId = generateRes.body.quizId;
    const questionId = generateRes.body.questions[0].id;

    await request(app)
      .post(`/api/quiz/${quizId}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ questionId, userAnswer: 'true' }] });

    const res = await request(app)
      .post(`/api/quiz/${quizId}/questions/${questionId}/regenerate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
  });
});
