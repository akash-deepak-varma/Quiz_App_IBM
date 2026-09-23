import { prisma } from '../../lib/prismaClient.js';
import { toJsonOrNull } from '../../lib/serialization.js';

/**
 * Storage backends for `runGeneration`. The orchestrator only ever sees this four-method
 * interface, which is what lets the synchronous endpoint and the background worker share one
 * implementation of the batching and retry logic.
 *
 * `saveQuestions(unit, questions)`   persist accepted questions immediately
 * `recordBatchAttempt(record)`       persist one attempt's telemetry
 * `getAcceptedPrompts()`             prompts already accepted for this job (dedupe + resume seed)
 * `isCancelled()`                    cooperative cancellation check, called before each attempt
 */

/**
 * In-memory store for the synchronous path, where the HTTP response *is* the durability boundary:
 * if the request dies, there is nobody left to hand a partial quiz to.
 */
export function createMemoryStore() {
  const questions = [];
  const attempts = [];

  return {
    async saveQuestions(_unit, batch) {
      questions.push(...batch);
    },
    async recordBatchAttempt(record) {
      attempts.push(record);
    },
    async getAcceptedPrompts() {
      return questions.map((question) => question.prompt);
    },
    async isCancelled() {
      return false;
    },
    snapshot() {
      return { questions: [...questions], attempts: [...attempts] };
    },
  };
}

/**
 * Durable store for a background job. Every accepted question is written to `GeneratedQuestion`
 * as soon as its batch validates, so a crash costs at most the batches actually in flight -- the
 * whole reason the async path exists.
 *
 * `orderIndex` stays null here: staging rows are written before the job's final interleaved
 * ordering is known, and `materializeQuiz` assigns positions at the end.
 */
export function createPrismaStore(generationId, client = prisma) {
  return {
    async saveQuestions(unit, batch) {
      if (batch.length === 0) return;

      await client.$transaction([
        client.generatedQuestion.createMany({
          data: batch.map((question) => ({
            generationId,
            batchKey: unit.id,
            type: question.type,
            prompt: question.prompt,
            optionsJson: toJsonOrNull(question.options ?? null),
            starterCode: question.starterCode ?? null,
            correctAnswer: JSON.stringify(question.correctAnswer),
            explanation: question.explanation,
          })),
        }),
        // The progress endpoint reads `generated` directly, so bump it in the same transaction as
        // the rows it counts -- otherwise a poll can see a total the staging table cannot justify.
        client.quizGeneration.update({
          where: { id: generationId },
          data: { generated: { increment: batch.length } },
        }),
      ]);
    },

    async recordBatchAttempt(record) {
      await client.$transaction([
        client.generationBatch.create({
          data: {
            generationId,
            batchKey: record.batchId,
            typesJson: JSON.stringify(record.types),
            requested: record.requested,
            accepted: record.accepted,
            rejected: record.rejected,
            dupes: record.duplicates,
            attempt: record.attempt,
            status: record.status,
            failureCategory: record.failureCategory,
            failureReason: record.failureReason,
            durationMs: record.durationMs ?? null,
            inputTokens: record.usage?.inputTokens ?? null,
            outputTokens: record.usage?.outputTokens ?? null,
          },
        }),
        client.quizGeneration.update({
          where: { id: generationId },
          data: {
            attempts: { increment: 1 },
            inputTokens: { increment: record.usage?.inputTokens ?? 0 },
            outputTokens: { increment: record.usage?.outputTokens ?? 0 },
          },
        }),
      ]);
    },

    // On a resumed job this is what stops already-persisted work from being generated a second
    // time: the orchestrator seeds its dedupe set from these prompts.
    async getAcceptedPrompts() {
      const rows = await client.generatedQuestion.findMany({
        where: { generationId },
        select: { prompt: true },
      });
      return rows.map((row) => row.prompt);
    },

    // Cancellation is cooperative: the flag is set by the HTTP handler, observed here between
    // attempts. There is no way to recall a request already in flight at the provider.
    async isCancelled() {
      const row = await client.quizGeneration.findUnique({
        where: { id: generationId },
        select: { cancelRequested: true },
      });
      return row?.cancelRequested === true;
    },
  };
}
