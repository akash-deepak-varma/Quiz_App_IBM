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

async function generateAndSubmit(token, { correct }) {
  const generateRes = await request(app)
    .post('/api/quiz/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ topic: 'Explain endpoint', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });

  const quizId = generateRes.body.quizId;
  const questionId = generateRes.body.questions[0].id;
  const userAnswer = correct ? 'true' : 'false';

  const submitRes = await request(app)
    .post(`/api/quiz/${quizId}/submit`)
    .set('Authorization', `Bearer ${token}`)
    .send({ answers: [{ questionId, userAnswer }], timeSpentSeconds: 5 });

  return { attemptId: submitRes.body.attemptId, questionId };
}

describe('POST /api/attempts/:id/questions/:questionId/explain', () => {
  beforeEach(resetDb);

  it('returns a string explanation for a question answered incorrectly', async () => {
    const token = await signup('explainer@example.com');
    const { attemptId, questionId } = await generateAndSubmit(token, { correct: false });

    const res = await request(app)
      .post(`/api/attempts/${attemptId}/questions/${questionId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.explanation).toBeTypeOf('string');
    expect(res.body.explanation.length).toBeGreaterThan(0);
  });

  it('returns 400 when the question was answered correctly', async () => {
    const token = await signup('correct@example.com');
    const { attemptId, questionId } = await generateAndSubmit(token, { correct: true });

    const res = await request(app)
      .post(`/api/attempts/${attemptId}/questions/${questionId}/explain`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
  });

  it('returns 404 for an attempt owned by a different user', async () => {
    const ownerToken = await signup('owner2@example.com');
    const intruderToken = await signup('intruder2@example.com');
    const { attemptId, questionId } = await generateAndSubmit(ownerToken, { correct: false });

    const res = await request(app)
      .post(`/api/attempts/${attemptId}/questions/${questionId}/explain`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send();

    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-existent attempt/question pair', async () => {
    const token = await signup('missing@example.com');

    const res = await request(app)
      .post('/api/attempts/not-a-real-id/questions/not-a-real-id/explain')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(404);
  });
});
