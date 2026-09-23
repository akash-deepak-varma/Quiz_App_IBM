import { env } from '../config/env.js';

/**
 * Structured generation telemetry. Matches the `[provider]`-prefixed single-object style
 * `claudeProvider.js` already uses, so the whole AI path reads the same way in a log tail.
 *
 * This is the console half of the observability story; the durable half is the
 * `QuizGeneration` / `GenerationBatch` rows, which outlive the process.
 */
export function logBatchAttempt(record) {
  if (!env.generationLogEnabled) return;

  const line = {
    event: 'batch_attempt',
    generationId: record.generationId ?? null,
    batchId: record.batchId,
    types: record.types,
    requested: record.requested,
    accepted: record.accepted,
    rejected: record.rejected ?? 0,
    duplicates: record.duplicates ?? 0,
    attempt: record.attempt,
    status: record.status,
    durationMs: record.durationMs,
    failureCategory: record.failureCategory ?? null,
    failureReason: record.failureReason ?? null,
  };
  if (record.status === 'SUCCEEDED') {
    console.log('[GEN] batch', line);
  } else {
    console.warn('[GEN] batch', line);
  }
}

/**
 * One line per finished generation.
 *
 * For a background job this is emitted by the worker, not the orchestrator: a resumed job runs
 * `runGeneration` over its shortfall alone, so only the worker knows the totals the user actually
 * asked for. `resumed` says which kind of run produced the line, and `elapsedMs` appears whenever it
 * differs from `durationMs` -- see the call site in `generation/worker.js` for what each one means.
 */
export function logJobSummary(record) {
  if (!env.generationLogEnabled) return;

  const line = {
    event: 'generation_finished',
    generationId: record.generationId ?? null,
    provider: record.provider,
    status: record.status,
    requested: record.requested,
    generated: record.generated,
    batches: record.batches,
    attempts: record.attempts,
    durationMs: record.durationMs,
    ...(record.elapsedMs != null && record.elapsedMs !== record.durationMs
      ? { elapsedMs: record.elapsedMs }
      : {}),
    ...(record.resumed ? { resumed: true } : {}),
    failureCategory: record.failureCategory ?? null,
  };
  if (record.status === 'READY') {
    console.log('[GEN] generation', line);
  } else {
    console.warn('[GEN] generation', line);
  }
}
