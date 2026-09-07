import { prisma } from '../lib/prismaClient.js';

const WEAKEST_TOPICS_LIMIT = 3;
const HISTORY_LIMIT = 100;

export async function getDashboardSummary(userId) {
  const [attempts, streak] = await Promise.all([
    prisma.attempt.findMany({
      where: { userId, completedAt: { not: null } },
      include: { quiz: { include: { topic: true } } },
      orderBy: { completedAt: 'asc' },
    }),
    prisma.streak.findUnique({ where: { userId } }),
  ]);

  const quizzesTaken = attempts.length;
  const overallAccuracy =
    quizzesTaken === 0 ? 0 : attempts.reduce((sum, a) => sum + (a.score ?? 0), 0) / quizzesTaken;
  const totalTimeSpentSeconds = attempts.reduce((sum, a) => sum + (a.timeSpentSeconds ?? 0), 0);

  const accuracyByDate = new Map();
  const accuracyByTopic = new Map();
  for (const attempt of attempts) {
    const date = attempt.completedAt.toISOString().slice(0, 10);
    const dateEntry = accuracyByDate.get(date) ?? { sum: 0, count: 0 };
    dateEntry.sum += attempt.score ?? 0;
    dateEntry.count += 1;
    accuracyByDate.set(date, dateEntry);

    const topic = attempt.quiz.topic.name;
    const topicEntry = accuracyByTopic.get(topic) ?? { sum: 0, count: 0 };
    topicEntry.sum += attempt.score ?? 0;
    topicEntry.count += 1;
    accuracyByTopic.set(topic, topicEntry);
  }

  const accuracyTrend = [...accuracyByDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { sum, count }]) => ({ date, accuracy: sum / count }));

  const byTopic = [...accuracyByTopic.entries()].map(([topic, { sum, count }]) => ({
    topic,
    accuracy: sum / count,
    quizzesTaken: count,
  }));

  const weakestTopics = [...byTopic]
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, WEAKEST_TOPICS_LIMIT)
    .map(({ topic, accuracy }) => ({ topic, accuracy }));

  return {
    quizzesTaken,
    overallAccuracy,
    totalTimeSpentSeconds,
    accuracyTrend,
    byTopic,
    weakestTopics,
    streak: { current: streak?.currentStreak ?? 0, longest: streak?.longestStreak ?? 0 },
  };
}

export async function getDashboardHistory(userId) {
  const attempts = await prisma.attempt.findMany({
    where: { userId, completedAt: { not: null } },
    include: { quiz: { include: { topic: true } } },
    orderBy: { completedAt: 'desc' },
    take: HISTORY_LIMIT,
  });

  return {
    attempts: attempts.map((a) => ({
      attemptId: a.id,
      topic: a.quiz.topic.name,
      difficulty: a.quiz.difficulty,
      score: a.score,
      completedAt: a.completedAt,
    })),
  };
}
