import { prisma } from '../../src/lib/prismaClient.js';

/**
 * Empty the test schema, children before parents.
 *
 * Every integration suite used to keep its own copy of this list, which meant the delete order was
 * duplicated seven times and each copy was subtly different. Adding one table that references
 * `User` with the default RESTRICT then broke six suites at once -- not because their assertions
 * were wrong, but because a leftover row in a table they had never heard of blocked
 * `user.deleteMany()`. One list, in one place, is what stops that happening again.
 *
 * `Badge` is deliberately absent: it is reference data seeded by `badgeService`, not per-test state.
 */
const DELETE_ORDER = [
  'answerLog', // -> attempt, question
  'attempt', // -> quiz, user
  'favorite', // -> quiz, user
  'userBadge', // -> user, badge
  'streak', // -> user
  'generatedQuestion', // -> quizGeneration
  'generationBatch', // -> quizGeneration
  'quizGeneration', // -> user (RESTRICT), quiz (SET NULL)
  'question', // -> quiz
  'quiz', // -> user, topic
  'tag', // <-> topic (implicit join table)
  'topic',
  'user', // -> org
  'org',
];

export async function resetDb() {
  // Sequential, not `$transaction`: the suites call this in `beforeEach`, and a failure here should
  // name the table it could not clear rather than one opaque rolled-back transaction.
  for (const model of DELETE_ORDER) {
    await prisma[model].deleteMany();
  }
}
