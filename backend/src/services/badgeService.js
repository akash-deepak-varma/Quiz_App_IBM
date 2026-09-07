import { prisma } from '../lib/prismaClient.js';

// Precomputes everything every rule type needs in one pass over the user's completed
// attempts, so evaluateAndAwardBadges doesn't re-query per badge/rule.
export async function computeUserStatsSnapshot(userId) {
  const attempts = await prisma.attempt.findMany({
    where: { userId, completedAt: { not: null } },
    include: { quiz: { include: { topic: true } }, answerLogs: true },
  });

  const totalQuizzesTaken = attempts.length;
  const totalQuestionsAnswered = attempts.reduce((sum, a) => sum + a.answerLogs.length, 0);
  const hasPerfectScore = attempts.some((a) => a.score === 1);

  const byTopic = new Map();
  for (const attempt of attempts) {
    const topicName = attempt.quiz.topic.name;
    const entry = byTopic.get(topicName) || { scores: [] };
    entry.scores.push(attempt.score ?? 0);
    byTopic.set(topicName, entry);
  }
  const topicStats = [...byTopic.entries()].map(([topic, { scores }]) => ({
    topic,
    quizzesTaken: scores.length,
    accuracy: scores.reduce((sum, v) => sum + v, 0) / scores.length,
  }));

  return { totalQuizzesTaken, totalQuestionsAnswered, hasPerfectScore, topicStats };
}

// Tagged-union rule engine -- a genuinely new rule *kind* means one more case here;
// a new badge with an existing rule kind is just a new Badge row (see prisma/seed.js).
export function evaluateRule(rule, snapshot, streak) {
  switch (rule.type) {
    case 'first_quiz':
      return snapshot.totalQuizzesTaken >= 1;
    case 'streak_days':
      return (streak?.currentStreak ?? 0) >= rule.threshold;
    case 'questions_answered_total':
      return snapshot.totalQuestionsAnswered >= rule.threshold;
    case 'perfect_score':
      return snapshot.hasPerfectScore;
    case 'topic_mastery':
      return snapshot.topicStats.some(
        (t) => t.quizzesTaken >= rule.minQuizzes && t.accuracy >= rule.minAccuracy
      );
    default:
      return false;
  }
}

// Runs once per submitted attempt. Only evaluates badges the user hasn't already earned,
// and awards every newly-qualifying one in a single batch insert.
export async function evaluateAndAwardBadges(userId, streak) {
  const [badges, userBadges, snapshot] = await Promise.all([
    prisma.badge.findMany(),
    prisma.userBadge.findMany({ where: { userId } }),
    computeUserStatsSnapshot(userId),
  ]);

  const earnedBadgeIds = new Set(userBadges.map((ub) => ub.badgeId));
  const newlyEarned = badges.filter(
    (badge) => !earnedBadgeIds.has(badge.id) && evaluateRule(JSON.parse(badge.ruleJson), snapshot, streak)
  );

  if (newlyEarned.length > 0) {
    await prisma.userBadge.createMany({
      data: newlyEarned.map((badge) => ({ userId, badgeId: badge.id })),
    });
  }

  return newlyEarned;
}
