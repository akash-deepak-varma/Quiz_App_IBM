import { prisma } from '../src/lib/prismaClient.js';
import { hashPassword } from '../src/services/authService.js';
import * as mockProvider from '../src/providers/mockProvider.js';
import { toJsonOrNull, fromJsonOrNull } from '../src/lib/serialization.js';
import { scoreAnswer, computeAttemptScore } from '../src/services/quizScoringService.js';
import { recordActivityAndGetStreak } from '../src/services/streakService.js';
import { evaluateAndAwardBadges } from '../src/services/badgeService.js';

const BADGES = [
  { name: 'First Quiz', description: 'Complete your first quiz.', rule: { type: 'first_quiz' } },
  { name: '7-Day Streak', description: 'Practice for 7 days in a row.', rule: { type: 'streak_days', threshold: 7 } },
  {
    name: '30-Day Streak',
    description: 'Practice for 30 days in a row.',
    rule: { type: 'streak_days', threshold: 30 },
  },
  {
    name: 'Century Club',
    description: 'Answer 100 questions in total.',
    rule: { type: 'questions_answered_total', threshold: 100 },
  },
  { name: 'Perfect Score', description: 'Score 100% on a quiz.', rule: { type: 'perfect_score' } },
  {
    name: 'Topic Master',
    description: 'Average 90%+ accuracy across at least 3 quizzes on one topic.',
    rule: { type: 'topic_mastery', minAccuracy: 0.9, minQuizzes: 3 },
  },
];

const DEMO_USER = { name: 'Demo User', email: 'demo@example.com', password: 'demopass123' };
const DEMO_QUIZ_TOPIC = 'JavaScript Basics';

async function seedOrg() {
  let org = await prisma.org.findFirst();
  if (!org) {
    org = await prisma.org.create({ data: { name: 'Default Org' } });
    console.log(`Created default org: ${org.name}`);
  } else {
    console.log(`Default org already exists: ${org.name}`);
  }
  return org;
}

async function seedBadges() {
  for (const badge of BADGES) {
    const existing = await prisma.badge.findFirst({ where: { name: badge.name } });
    if (existing) continue;
    await prisma.badge.create({
      data: { name: badge.name, description: badge.description, ruleJson: JSON.stringify(badge.rule) },
    });
    console.log(`Created badge: ${badge.name}`);
  }
}

async function seedDemoUser(org) {
  let user = await prisma.user.findUnique({ where: { email: DEMO_USER.email } });
  if (!user) {
    const passwordHash = await hashPassword(DEMO_USER.password);
    user = await prisma.user.create({
      data: { name: DEMO_USER.name, email: DEMO_USER.email, passwordHash, orgId: org.id },
    });
    console.log(`Created demo user: ${user.email} (password: ${DEMO_USER.password})`);
  } else {
    console.log(`Demo user already exists: ${user.email}`);
  }
  return user;
}

async function seedSampleQuiz(user) {
  const existing = await prisma.quiz.findFirst({
    where: { userId: user.id },
    include: { questions: { orderBy: { orderIndex: 'asc' } } },
  });
  if (existing) {
    console.log('Demo user already has a sample quiz, skipping.');
    return existing;
  }

  let topic = await prisma.topic.findUnique({ where: { name: DEMO_QUIZ_TOPIC } });
  if (!topic) {
    topic = await prisma.topic.create({ data: { name: DEMO_QUIZ_TOPIC } });
  }

  // Reuses the real mock-provider code path (not a hand-duplicated fixture) so the
  // seeded quiz is guaranteed schema-valid and stays in sync with mockProvider.js.
  const rawQuiz = await mockProvider.generateQuiz({
    topic: DEMO_QUIZ_TOPIC,
    difficulty: 'beginner',
    numQuestions: 6,
  });

  const quiz = await prisma.quiz.create({
    data: {
      userId: user.id,
      topicId: topic.id,
      difficulty: rawQuiz.difficulty,
      providerUsed: 'mock',
      questions: {
        create: rawQuiz.questions.map((q, index) => ({
          type: q.type,
          prompt: q.prompt,
          optionsJson: toJsonOrNull(q.options ?? null),
          starterCode: q.starterCode ?? null,
          correctAnswer: JSON.stringify(q.correctAnswer),
          explanation: q.explanation,
          orderIndex: index,
        })),
      },
    },
    include: { questions: { orderBy: { orderIndex: 'asc' } } },
  });
  console.log(`Created sample quiz "${DEMO_QUIZ_TOPIC}" for ${user.email}`);
  return quiz;
}

// Completes the sample quiz for the demo user through the same scoring/streak/badge
// pipeline the real POST /api/quiz/:id/submit endpoint runs (not a hand-rolled Attempt
// row), so the demo account has real activity right after a fresh seed. Without this, the
// demo user has zero XP and no streak row -- getLeaderboard filters out zero-score rows
// entirely, so the demo account would never actually appear on the leaderboard.
// Answers every question with its own correct answer so the demo account shows a
// completed, well-scored quiz rather than an arbitrary one.
async function seedSampleAttempt(user, quiz) {
  const existing = await prisma.attempt.findFirst({ where: { userId: user.id, quizId: quiz.id } });
  if (existing) {
    console.log('Demo user already has a completed attempt, skipping.');
    return;
  }

  const graded = [];
  for (const question of quiz.questions) {
    const correctAnswer = fromJsonOrNull(question.correctAnswer);
    const { isCorrect, scoreFraction, aiFeedback } = await scoreAnswer(
      { ...question, correctAnswer },
      correctAnswer,
      mockProvider
    );
    graded.push({ question, userAnswer: correctAnswer, isCorrect, scoreFraction, aiFeedback });
  }

  await prisma.attempt.create({
    data: {
      quizId: quiz.id,
      userId: user.id,
      completedAt: new Date(),
      score: computeAttemptScore(graded.map((g) => g.scoreFraction)),
      timeSpentSeconds: 120,
      answerLogs: {
        create: graded.map((g) => ({
          questionId: g.question.id,
          userAnswer: JSON.stringify(g.userAnswer),
          isCorrect: g.isCorrect,
          scoreFraction: g.scoreFraction,
          aiFeedback: g.aiFeedback,
        })),
      },
    },
  });

  const streak = await recordActivityAndGetStreak(user.id);
  await evaluateAndAwardBadges(user.id, streak);
  console.log(`Completed sample quiz for ${user.email}`);
}

async function main() {
  const org = await seedOrg();
  await seedBadges();
  const demoUser = await seedDemoUser(org);
  const quiz = await seedSampleQuiz(demoUser);
  await seedSampleAttempt(demoUser, quiz);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
