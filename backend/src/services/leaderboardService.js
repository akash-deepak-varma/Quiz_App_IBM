import { prisma } from '../lib/prismaClient.js';

const DIFFICULTY_WEIGHTS = { beginner: 1, intermediate: 1.5, advanced: 2 };
const STREAK_BONUS_CAP_DAYS = 30;
const STREAK_BONUS_PER_DAY = 2;

// accuracy is attempt.score (0..1) -- a multiplier, not a flat bonus, so grinding lots of
// easy/low-accuracy quizzes doesn't outscore fewer, harder, well-answered ones.
export function computeAttemptXP({ difficulty, numQuestions, accuracy }) {
  const weight = DIFFICULTY_WEIGHTS[difficulty] ?? 1;
  return numQuestions * weight * (accuracy ?? 0);
}

export function computeStreakBonus(currentStreak) {
  return Math.min(currentStreak ?? 0, STREAK_BONUS_CAP_DAYS) * STREAK_BONUS_PER_DAY;
}

// range: 'week' | 'alltime'. Streak bonus is range-independent by design (current
// momentum), so it's added once to both the weekly and all-time score.
export async function getLeaderboard(range = 'week') {
  const since = range === 'week' ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : null;

  const [attempts, users] = await Promise.all([
    prisma.attempt.findMany({
      where: { completedAt: since ? { gte: since } : { not: null } },
      include: { quiz: true, _count: { select: { answerLogs: true } } },
    }),
    prisma.user.findMany({ include: { streak: true } }),
  ]);

  const xpByUser = new Map();
  for (const attempt of attempts) {
    const xp = computeAttemptXP({
      difficulty: attempt.quiz.difficulty,
      numQuestions: attempt._count.answerLogs,
      accuracy: attempt.score,
    });
    xpByUser.set(attempt.userId, (xpByUser.get(attempt.userId) ?? 0) + xp);
  }

  const rows = users
    .map((user) => ({
      userId: user.id,
      name: user.name,
      score: (xpByUser.get(user.id) ?? 0) + computeStreakBonus(user.streak?.currentStreak),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return { range, rows };
}
