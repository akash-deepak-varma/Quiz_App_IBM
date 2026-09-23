import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb } from './setup/resetDb.js';

async function signup(email) {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Test User', email, password: 'supersecret' });
  return res.body.token;
}

async function generateQuiz(token, overrides = {}) {
  const res = await request(app)
    .post('/api/quiz/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ topic: 'Loops', difficulty: 'beginner', numQuestions: 1, typeMix: ['true_false'], ...overrides });
  return res.body;
}

describe('GET /api/quiz/:id', () => {
  beforeEach(resetDb);

  it('returns the same shape as generate, without correctAnswer/explanation, for retake', async () => {
    const token = await signup('retake@example.com');
    const generated = await generateQuiz(token);

    const res = await request(app).get(`/api/quiz/${generated.quizId}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.quizId).toBe(generated.quizId);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0]).not.toHaveProperty('correctAnswer');
    expect(res.body.questions[0]).not.toHaveProperty('explanation');
  });

  it('returns 404 for a quiz owned by a different user', async () => {
    const ownerToken = await signup('libowner@example.com');
    const intruderToken = await signup('libintruder@example.com');
    const generated = await generateQuiz(ownerToken);

    const res = await request(app)
      .get(`/api/quiz/${generated.quizId}`)
      .set('Authorization', `Bearer ${intruderToken}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/quiz/library', () => {
  beforeEach(resetDb);

  it('lists the current user quizzes with topic/tags/favorite state, filterable by tag', async () => {
    const token = await signup('library@example.com');
    const tagged = await generateQuiz(token, { topic: 'Arrays', tags: ['fundamentals', 'js'] });
    await generateQuiz(token, { topic: 'Closures' });

    await request(app)
      .post(`/api/quiz/${tagged.quizId}/favorite`)
      .set('Authorization', `Bearer ${token}`);

    const allRes = await request(app).get('/api/quiz/library').set('Authorization', `Bearer ${token}`);
    expect(allRes.status).toBe(200);
    expect(allRes.body.total).toBe(2);

    const taggedEntry = allRes.body.quizzes.find((q) => q.quizId === tagged.quizId);
    expect(taggedEntry.tags.sort()).toEqual(['fundamentals', 'js']);
    expect(taggedEntry.isFavorited).toBe(true);
    expect(taggedEntry.questionCount).toBe(1);
    expect(taggedEntry.attemptCount).toBe(0);

    const filteredRes = await request(app)
      .get('/api/quiz/library')
      .query({ tag: 'js' })
      .set('Authorization', `Bearer ${token}`);
    expect(filteredRes.body.total).toBe(1);
    expect(filteredRes.body.quizzes[0].quizId).toBe(tagged.quizId);
  });

  it('only returns the requesting user own quizzes', async () => {
    const ownerToken = await signup('libowner2@example.com');
    const otherToken = await signup('libother2@example.com');
    await generateQuiz(ownerToken);

    const res = await request(app).get('/api/quiz/library').set('Authorization', `Bearer ${otherToken}`);
    expect(res.body.total).toBe(0);
  });
});

describe('POST/DELETE /api/quiz/:id/favorite', () => {
  beforeEach(resetDb);

  it('toggles a favorite on and off', async () => {
    const token = await signup('favorite@example.com');
    const generated = await generateQuiz(token);

    const favRes = await request(app)
      .post(`/api/quiz/${generated.quizId}/favorite`)
      .set('Authorization', `Bearer ${token}`);
    expect(favRes.status).toBe(204);

    let libRes = await request(app).get('/api/quiz/library').set('Authorization', `Bearer ${token}`);
    expect(libRes.body.quizzes[0].isFavorited).toBe(true);

    const unfavRes = await request(app)
      .delete(`/api/quiz/${generated.quizId}/favorite`)
      .set('Authorization', `Bearer ${token}`);
    expect(unfavRes.status).toBe(204);

    libRes = await request(app).get('/api/quiz/library').set('Authorization', `Bearer ${token}`);
    expect(libRes.body.quizzes[0].isFavorited).toBe(false);
  });

  it('returns 404 favoriting a quiz owned by a different user', async () => {
    const ownerToken = await signup('favowner@example.com');
    const intruderToken = await signup('favintruder@example.com');
    const generated = await generateQuiz(ownerToken);

    const res = await request(app)
      .post(`/api/quiz/${generated.quizId}/favorite`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/topics', () => {
  beforeEach(resetDb);

  it('lists topics with tags and the current user own quiz counts', async () => {
    const token = await signup('topics@example.com');
    await generateQuiz(token, { topic: 'Arrays', tags: ['fundamentals'] });
    await generateQuiz(token, { topic: 'Arrays', tags: ['fundamentals'] });

    const res = await request(app).get('/api/topics').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.topics).toHaveLength(1);
    expect(res.body.topics[0]).toMatchObject({ name: 'Arrays', tags: ['fundamentals'], quizCount: 2 });
  });
});
