import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prismaClient.js';

async function resetDb() {
  await prisma.favorite.deleteMany();
  await prisma.answerLog.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.userBadge.deleteMany();
  await prisma.streak.deleteMany();
  await prisma.question.deleteMany();
  await prisma.quiz.deleteMany();
  await prisma.tag.deleteMany();
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

async function generateQuiz(token, topic) {
  const res = await request(app)
    .post('/api/quiz/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ topic, difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'] });
  return res.body;
}

async function submit(token, quizId, questionId, userAnswer) {
  return request(app)
    .post(`/api/quiz/${quizId}/submit`)
    .set('Authorization', `Bearer ${token}`)
    .send({ answers: [{ questionId, userAnswer }] });
}

describe('GET /api/analytics/hardest-questions', () => {
  beforeEach(resetDb);

  it('surfaces a question answered wrong more often than right, and excludes one answered only once', async () => {
    const token = await signup('hardest@example.com');
    const hard = await generateQuiz(token, 'Hard topic');
    const hardQuestionId = hard.questions[0].id;
    const easy = await generateQuiz(token, 'Easy topic');
    const easyQuestionId = easy.questions[0].id;

    // hard question: wrong, wrong, right -- 2 attempts each of the same quiz needs a fresh
    // Attempt row per submit, which the controller allows (submit doesn't restrict to once).
    await submit(token, hard.quizId, hardQuestionId, 'false');
    await submit(token, hard.quizId, hardQuestionId, 'false');
    await submit(token, hard.quizId, hardQuestionId, 'true');
    // easy question: answered correctly only once -- below the timesAnswered >= 2 threshold.
    await submit(token, easy.quizId, easyQuestionId, 'true');

    const res = await request(app).get('/api/analytics/hardest-questions').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.questions.map((q) => q.questionId);
    expect(ids).toContain(hardQuestionId);
    expect(ids).not.toContain(easyQuestionId);
    const hardEntry = res.body.questions.find((q) => q.questionId === hardQuestionId);
    expect(hardEntry.timesAnswered).toBe(3);
    expect(hardEntry.wrongRate).toBeCloseTo(2 / 3);
  });
});

describe('GET /api/analytics/review-queue', () => {
  beforeEach(resetDb);

  it('includes a question whose review window has elapsed, excludes one not yet due', async () => {
    const token = await signup('review@example.com');
    const due = await generateQuiz(token, 'Due topic');
    const dueQuestionId = due.questions[0].id;
    const fresh = await generateQuiz(token, 'Fresh topic');
    const freshQuestionId = fresh.questions[0].id;

    await submit(token, due.quizId, dueQuestionId, 'false'); // wrong -> 1-day review window
    await submit(token, fresh.quizId, freshQuestionId, 'true'); // correct -> 2-day review window

    // Backdate the wrong-answer attempt so its 1-day window has already elapsed; the
    // freshly-correct attempt is left at "now" so its 2-day window has not.
    await prisma.attempt.updateMany({
      where: { quizId: due.quizId },
      data: { completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    });

    const res = await request(app).get('/api/analytics/review-queue').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.questions.map((q) => q.questionId);
    expect(ids).toContain(dueQuestionId);
    expect(ids).not.toContain(freshQuestionId);
  });
});
