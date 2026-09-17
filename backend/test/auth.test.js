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

describe('POST /api/auth/signup', () => {
  beforeEach(resetDb);

  it('creates an account and returns a token plus a public user with no passwordHash', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'supersecret' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a missing field with 400', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'noname@example.com', password: 'supersecret' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBeTypeOf('string');
  });

  it('rejects a duplicate email with 400', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Ada', email: 'dupe@example.com', password: 'supersecret' });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Someone Else', email: 'dupe@example.com', password: 'supersecret' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await resetDb();
    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Grace Hopper', email: 'grace@example.com', password: 'supersecret' });
  });

  it('logs in with the right password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'grace@example.com', password: 'supersecret' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user.email).toBe('grace@example.com');
  });

  it('rejects the wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'grace@example.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(resetDb);

  it('rejects a missing token with 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid token', async () => {
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Margaret Hamilton', email: 'margaret@example.com', password: 'supersecret' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signupRes.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('margaret@example.com');
  });

  it('rejects an invalid token with 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
