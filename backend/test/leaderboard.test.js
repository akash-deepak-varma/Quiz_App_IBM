import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prismaClient.js';
import { getLeaderboard, computeAttemptXP, computeStreakBonus } from '../src/services/leaderboardService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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

async function seedUserWithAttempt({ name, difficulty, numQuestions, accuracy, completedAt, currentStreak }) {
  const org = await prisma.org.create({ data: { name: `${name}-org` } });
  const user = await prisma.user.create({
    data: { name, email: `${name}@example.com`, passwordHash: 'x', orgId: org.id },
  });
  const topic = await prisma.topic.create({ data: { name: `${name}-topic` } });
  const quiz = await prisma.quiz.create({
    data: { userId: user.id, topicId: topic.id, difficulty, providerUsed: 'mock' },
  });
  const xp = computeAttemptXP({ difficulty, numQuestions, accuracy });
  await prisma.attempt.create({
    data: { quizId: quiz.id, userId: user.id, completedAt, score: accuracy, xp },
  });
  await prisma.streak.create({ data: { userId: user.id, currentStreak, longestStreak: currentStreak } });
  return { user, xp };
}

describe('getLeaderboard', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sums recent xp with streak bonus for a within-window attempt, and excludes an old attempt from the weekly view while still showing the streak bonus', async () => {
    const { user: userA, xp: xpA } = await seedUserWithAttempt({
      name: 'recent-user',
      difficulty: 'beginner',
      numQuestions: 4,
      accuracy: 0.75,
      completedAt: new Date(),
      currentStreak: 5,
    });
    const { user: userB, xp: xpB } = await seedUserWithAttempt({
      name: 'stale-user',
      difficulty: 'intermediate',
      numQuestions: 4,
      accuracy: 0.5,
      completedAt: new Date(Date.now() - 10 * DAY_MS),
      currentStreak: 3,
    });

    const bonusA = computeStreakBonus(5);
    const bonusB = computeStreakBonus(3);

    const week = await getLeaderboard('week');
    const rowA = week.rows.find((r) => r.userId === userA.id);
    const rowB = week.rows.find((r) => r.userId === userB.id);

    expect(rowA.score).toBeCloseTo(xpA + bonusA);
    // userB's only attempt is outside the weekly window, so their weekly xp contribution is 0 --
    // but they still appear because their streak (never reset to 0 by a completed attempt) is positive.
    expect(rowB.score).toBeCloseTo(bonusB);
    expect(week.rows.indexOf(rowA)).toBeLessThan(week.rows.indexOf(rowB));

    const alltime = await getLeaderboard('alltime');
    const rowAAll = alltime.rows.find((r) => r.userId === userA.id);
    const rowBAll = alltime.rows.find((r) => r.userId === userB.id);

    expect(rowAAll.score).toBeCloseTo(xpA + bonusA);
    // Alltime view includes the old attempt's xp too.
    expect(rowBAll.score).toBeCloseTo(xpB + bonusB);
  });

  it('assigns contiguous 1-based ranks in descending score order', async () => {
    await seedUserWithAttempt({
      name: 'top-user',
      difficulty: 'advanced',
      numQuestions: 5,
      accuracy: 1,
      completedAt: new Date(),
      currentStreak: 10,
    });
    await seedUserWithAttempt({
      name: 'low-user',
      difficulty: 'beginner',
      numQuestions: 1,
      accuracy: 0.2,
      completedAt: new Date(),
      currentStreak: 1,
    });

    const { rows } = await getLeaderboard('alltime');
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
    expect(rows[0].score).toBeGreaterThanOrEqual(rows[rows.length - 1].score);
  });
});
