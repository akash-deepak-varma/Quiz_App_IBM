import { prisma } from '../lib/prismaClient.js';

const DEFAULT_HARDEST_LIMIT = 10;
const DEFAULT_REVIEW_LIMIT = 20;
const MIN_TIMES_ANSWERED = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DUE_IN_DAYS = 30;

async function getUserAnswerLogs(userId) {
  return prisma.answerLog.findMany({
    where: { attempt: { userId, completedAt: { not: null } } },
    include: {
      question: { include: { quiz: { include: { topic: true } } } },
      attempt: { select: { completedAt: true } },
    },
    orderBy: { attempt: { completedAt: 'asc' } },
  });
}

export async function getHardestQuestions(userId, { limit = DEFAULT_HARDEST_LIMIT } = {}) {
  const logs = await getUserAnswerLogs(userId);

  const byQuestion = new Map();
  for (const log of logs) {
    const entry = byQuestion.get(log.questionId) ?? {
      questionId: log.questionId,
      prompt: log.question.prompt,
      topic: log.question.quiz.topic.name,
      quizId: log.question.quizId,
      timesAnswered: 0,
      timesWrong: 0,
    };
    entry.timesAnswered += 1;
    if (!log.isCorrect) entry.timesWrong += 1;
    byQuestion.set(log.questionId, entry);
  }

  return [...byQuestion.values()]
    .filter((e) => e.timesAnswered >= MIN_TIMES_ANSWERED)
    .map((e) => ({ ...e, wrongRate: e.timesWrong / e.timesAnswered }))
    .sort((a, b) => b.wrongRate - a.wrongRate)
    .slice(0, limit);
}

// Spaced-repetition-lite, derived entirely from AnswerLog history (no new schema): each correct
// answer in a row doubles how long a question can go untouched before it's "due" again, capped
// at MAX_DUE_IN_DAYS; a single wrong answer resets that streak back to daily review.
export async function getReviewQueue(userId, { limit = DEFAULT_REVIEW_LIMIT } = {}) {
  const logs = await getUserAnswerLogs(userId);

  const byQuestion = new Map();
  for (const log of logs) {
    const entry = byQuestion.get(log.questionId) ?? {
      questionId: log.questionId,
      prompt: log.question.prompt,
      topic: log.question.quiz.topic.name,
      quizId: log.question.quizId,
      consecutiveCorrect: 0,
      lastSeenAt: null,
    };
    entry.consecutiveCorrect = log.isCorrect ? entry.consecutiveCorrect + 1 : 0;
    entry.lastSeenAt = log.attempt.completedAt;
    byQuestion.set(log.questionId, entry);
  }

  const now = Date.now();

  return [...byQuestion.values()]
    .map((e) => {
      const dueInDays = Math.min(2 ** e.consecutiveCorrect, MAX_DUE_IN_DAYS);
      const dueAt = new Date(e.lastSeenAt.getTime() + dueInDays * DAY_MS);
      return {
        questionId: e.questionId,
        prompt: e.prompt,
        topic: e.topic,
        quizId: e.quizId,
        dueAt,
        overdueMs: now - dueAt.getTime(),
      };
    })
    .filter((e) => e.overdueMs >= 0)
    .sort((a, b) => b.overdueMs - a.overdueMs)
    .slice(0, limit)
    .map(({ questionId, prompt, topic, quizId, dueAt }) => ({ questionId, prompt, topic, quizId, dueAt }));
}
