import { prisma } from '../lib/prismaClient.js';
import { toJsonOrNull } from '../lib/serialization.js';

/**
 * Turning a set of validated questions into a persisted quiz.
 *
 * Both generation paths end here -- the synchronous `POST /api/quiz/generate` and the background
 * worker's finalizer -- so a quiz produced by a job is indistinguishable from one produced inline.
 * That shared ending is what keeps `GET /api/quiz/:id`, the runner, the library and analytics from
 * needing to know which path built the quiz.
 *
 * Everything runs in one transaction. The old inline version did a `findUnique` then a `create` on
 * Topic, which two simultaneous requests for the same new topic could both pass before either
 * inserted; `upsert` on the unique `name` closes that.
 */
export async function materializeQuiz(
  { userId, topic, difficulty, providerUsed, notes = null, tags = [], questions },
  client = prisma
) {
  const cleanTags = [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];

  const run = async (tx) => {
    const topicRow = await tx.topic.upsert({
      where: { name: topic },
      update: {},
      create: { name: topic },
    });

    if (cleanTags.length > 0) {
      await tx.topic.update({
        where: { id: topicRow.id },
        data: {
          tags: { connectOrCreate: cleanTags.map((name) => ({ where: { name }, create: { name } })) },
        },
      });
    }

    return tx.quiz.create({
      data: {
        userId,
        topicId: topicRow.id,
        difficulty,
        providerUsed,
        sourceNotes: notes,
        questions: {
          create: questions.map((question, index) => ({
            type: question.type,
            prompt: question.prompt,
            optionsJson: toJsonOrNull(question.options ?? null),
            starterCode: question.starterCode ?? null,
            correctAnswer: JSON.stringify(question.correctAnswer),
            explanation: question.explanation,
            orderIndex: index,
          })),
        },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
  };

  // `client` is already a transaction when the worker calls this from inside one -- Prisma has no
  // nested transactions, so reuse it rather than opening a second.
  return client === prisma ? prisma.$transaction(run) : run(client);
}
