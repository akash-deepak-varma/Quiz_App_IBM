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
//
// xp is denormalized onto Attempt at submit-time (see quiz.controller.js#submit) using this
// same computeAttemptXP formula, so the weekly/all-time sum here is a plain indexed groupBy
// instead of a full-table scan joined against every Quiz.
export async function getLeaderboard(range = 'week') {
  const since = range === 'week' ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : null;

  const [xpGroups, streaks] = await Promise.all([
    prisma.attempt.groupBy({
      by: ['userId'],
      where: { completedAt: since ? { gte: since } : { not: null } },
      _sum: { xp: true },
    }),
    // Every user who has ever completed an attempt gets a Streak row (recordActivityAndGetStreak),
    // and applyStreakActivity never resets currentStreak back to 0 -- so this population, filtered
    // to currentStreak > 0, is exactly who a full user scan would have produced non-zero rows for,
    // without pulling every never-active signup into memory. It also preserves a real subtlety of
    // the old behavior: a user whose only attempt predates the weekly window still shows up here
    // with their streak-only score, same as before.
    prisma.streak.findMany({
      where: { currentStreak: { gt: 0 } },
      include: { user: { select: { name: true } } },
    }),
  ]);

  const xpByUser = new Map(xpGroups.map((g) => [g.userId, g._sum.xp ?? 0]));

  const rows = streaks
    .map((s) => ({
      userId: s.userId,
      name: s.user.name,
      score: (xpByUser.get(s.userId) ?? 0) + computeStreakBonus(s.currentStreak),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return { range, rows };
}
