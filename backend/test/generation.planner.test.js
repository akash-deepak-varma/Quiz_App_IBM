import { describe, it, expect } from 'vitest';
import { buildGenerationPlan, planBatches, pickContextMode, CONTEXT_MODES } from '../src/services/generation/planner.js';
import { QUESTION_GENERATION_PROFILE, MAX_BATCH_QUESTIONS, countOf } from '../src/services/generation/profile.js';

const totalOf = (plan) => plan.batches.reduce((sum, batch) => sum + batch.count, 0);

function countsByType(plan) {
  const totals = {};
  for (const batch of plan.batches) {
    for (const [type, count] of Object.entries(batch.counts)) {
      totals[type] = (totals[type] ?? 0) + count;
    }
  }
  return totals;
}

describe('buildGenerationPlan', () => {
  it('plans exactly the requested number of questions', () => {
    for (const numQuestions of [1, 2, 3, 5, 7, 10, 13, 20]) {
      const plan = buildGenerationPlan({ numQuestions });
      expect(totalOf(plan)).toBe(numQuestions);
      expect(plan.totalQuestions).toBe(numQuestions);
    }
  });

  it('preserves the round-robin type distribution the single-call generator produced', () => {
    const typeMix = ['mcq', 'debug', 'true_false'];
    const plan = buildGenerationPlan({ numQuestions: 10, typeMix });

    // 10 questions over 3 types via `types[i % 3]` => 4 mcq, 3 debug, 3 true_false.
    expect(countsByType(plan)).toEqual({ mcq: 4, debug: 3, true_false: 3 });
  });

  it('never exceeds a type\'s batch size within a single batch', () => {
    const plan = buildGenerationPlan({ numQuestions: 20 });
    for (const batch of plan.batches) {
      for (const [type, count] of Object.entries(batch.counts)) {
        expect(count).toBeLessThanOrEqual(QUESTION_GENERATION_PROFILE[type].batchSize);
      }
      expect(batch.count).toBeLessThanOrEqual(MAX_BATCH_QUESTIONS);
    }
  });

  it('keeps heavy types in small batches and light types in larger ones', () => {
    expect(buildGenerationPlan({ numQuestions: 6, typeMix: ['debug'] }).batches.map((b) => b.count)).toEqual([2, 2, 2]);
    expect(buildGenerationPlan({ numQuestions: 10, typeMix: ['true_false'] }).batches.map((b) => b.count)).toEqual([5, 5]);
  });

  // Without merging, the default six-type mix would emit one call per question -- the shape
  // problems.md section 26 warns against.
  it('packs small per-type groups together instead of one call per question', () => {
    const plan = buildGenerationPlan({ numQuestions: 6 });
    expect(plan.batches.length).toBeLessThan(6);
    expect(totalOf(plan)).toBe(6);
  });

  it('assigns non-overlapping, monotonically increasing start indices', () => {
    const plan = buildGenerationPlan({ numQuestions: 20 });
    let expected = 0;
    for (const batch of plan.batches) {
      expect(batch.startIndex).toBe(expected);
      expected += batch.count;
    }
    expect(expected).toBe(20);
  });

  it('handles a single question and an unspecified type mix', () => {
    const plan = buildGenerationPlan({ numQuestions: 1 });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].count).toBe(1);
    expect(plan.types.length).toBeGreaterThan(1);
  });

  it('de-duplicates a repeated type instead of double-counting its share', () => {
    const plan = buildGenerationPlan({ numQuestions: 4, typeMix: ['mcq', 'mcq'] });
    expect(plan.types).toEqual(['mcq']);
    expect(countsByType(plan)).toEqual({ mcq: 4 });
  });

  it('plans nothing for zero questions rather than throwing', () => {
    expect(buildGenerationPlan({ numQuestions: 0 }).batches).toEqual([]);
  });
});

describe('planBatches', () => {
  it('batches an explicit shortfall map by the same rules, from a given start index', () => {
    const batches = planBatches({ debug: 3, true_false: 1 }, { startIndex: 12, idPrefix: 't' });
    expect(batches.reduce((sum, b) => sum + b.count, 0)).toBe(4);
    expect(batches[0].startIndex).toBe(12);
    expect(batches.every((b) => b.id.startsWith('t'))).toBe(true);
  });
});

describe('pickContextMode', () => {
  it('uses DIRECT for pasted-notes-sized input and escalates with size', () => {
    expect(pickContextMode(undefined)).toBe(CONTEXT_MODES.DIRECT);
    expect(pickContextMode('short notes')).toBe(CONTEXT_MODES.DIRECT);
    expect(pickContextMode('x'.repeat(20000))).toBe(CONTEXT_MODES.DISTILLED);
    expect(pickContextMode('x'.repeat(50000))).toBe(CONTEXT_MODES.RETRIEVAL);
  });
});

describe('countOf', () => {
  it('sums a per-type count map', () => {
    expect(countOf({ mcq: 2, debug: 1 })).toBe(3);
    expect(countOf({})).toBe(0);
  });
});
