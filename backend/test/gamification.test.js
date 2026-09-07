import { describe, it, expect } from 'vitest';
import { applyStreakActivity } from '../src/services/streakService.js';
import { evaluateRule } from '../src/services/badgeService.js';
import { computeAttemptXP, computeStreakBonus } from '../src/services/leaderboardService.js';

describe('applyStreakActivity', () => {
  it('starts a new streak at 1 on first-ever activity', () => {
    const result = applyStreakActivity(null, new Date('2026-06-15T12:00:00Z'));
    expect(result).toEqual({ currentStreak: 1, longestStreak: 1, lastActiveDate: '2026-06-15' });
  });

  it('is a no-op for a second activity on the same UTC day', () => {
    const current = { currentStreak: 3, longestStreak: 5, lastActiveDate: '2026-06-15' };
    const result = applyStreakActivity(current, new Date('2026-06-15T23:59:00Z'));
    expect(result).toEqual(current);
  });

  it('increments on the very next UTC day', () => {
    const current = { currentStreak: 3, longestStreak: 5, lastActiveDate: '2026-06-15' };
    const result = applyStreakActivity(current, new Date('2026-06-16T00:05:00Z'));
    expect(result).toEqual({ currentStreak: 4, longestStreak: 5, lastActiveDate: '2026-06-16' });
  });

  it('raises longestStreak once currentStreak surpasses it', () => {
    const current = { currentStreak: 5, longestStreak: 5, lastActiveDate: '2026-06-15' };
    const result = applyStreakActivity(current, new Date('2026-06-16T00:05:00Z'));
    expect(result).toEqual({ currentStreak: 6, longestStreak: 6, lastActiveDate: '2026-06-16' });
  });

  it('resets to 1 (not 0) after a gap of 2+ days', () => {
    const current = { currentStreak: 10, longestStreak: 10, lastActiveDate: '2026-06-10' };
    const result = applyStreakActivity(current, new Date('2026-06-15T00:05:00Z'));
    expect(result).toEqual({ currentStreak: 1, longestStreak: 10, lastActiveDate: '2026-06-15' });
  });
});

describe('evaluateRule (badges)', () => {
  const streak = { currentStreak: 7 };
  const emptySnapshot = { totalQuizzesTaken: 0, totalQuestionsAnswered: 0, hasPerfectScore: false, topicStats: [] };

  it('first_quiz', () => {
    expect(evaluateRule({ type: 'first_quiz' }, { ...emptySnapshot, totalQuizzesTaken: 1 }, streak)).toBe(true);
    expect(evaluateRule({ type: 'first_quiz' }, emptySnapshot, streak)).toBe(false);
  });

  it('streak_days boundary', () => {
    const snapshot = { ...emptySnapshot, totalQuizzesTaken: 1 };
    expect(evaluateRule({ type: 'streak_days', threshold: 7 }, snapshot, { currentStreak: 7 })).toBe(true);
    expect(evaluateRule({ type: 'streak_days', threshold: 7 }, snapshot, { currentStreak: 6 })).toBe(false);
  });

  it('questions_answered_total boundary', () => {
    const snapshotAt = (n) => ({ ...emptySnapshot, totalQuestionsAnswered: n });
    expect(evaluateRule({ type: 'questions_answered_total', threshold: 100 }, snapshotAt(100), streak)).toBe(true);
    expect(evaluateRule({ type: 'questions_answered_total', threshold: 100 }, snapshotAt(99), streak)).toBe(false);
  });

  it('perfect_score', () => {
    expect(evaluateRule({ type: 'perfect_score' }, { ...emptySnapshot, hasPerfectScore: true }, streak)).toBe(true);
    expect(evaluateRule({ type: 'perfect_score' }, { ...emptySnapshot, hasPerfectScore: false }, streak)).toBe(
      false
    );
  });

  it('topic_mastery requires both the accuracy and quiz-count thresholds', () => {
    const rule = { type: 'topic_mastery', minAccuracy: 0.9, minQuizzes: 3 };
    const withTopicStats = (topicStats) => ({ ...emptySnapshot, topicStats });

    expect(evaluateRule(rule, withTopicStats([{ topic: 'SQL', quizzesTaken: 3, accuracy: 0.9 }]), streak)).toBe(true);
    expect(evaluateRule(rule, withTopicStats([{ topic: 'SQL', quizzesTaken: 2, accuracy: 0.95 }]), streak)).toBe(
      false
    ); // not enough quizzes yet
    expect(evaluateRule(rule, withTopicStats([{ topic: 'SQL', quizzesTaken: 3, accuracy: 0.8 }]), streak)).toBe(
      false
    ); // not accurate enough
  });

  it('returns false for an unrecognized rule type instead of throwing', () => {
    expect(evaluateRule({ type: 'not_a_real_rule' }, emptySnapshot, streak)).toBe(false);
  });
});

describe('leaderboard XP', () => {
  it('computeAttemptXP: numQuestions * difficultyWeight * accuracy', () => {
    expect(computeAttemptXP({ difficulty: 'beginner', numQuestions: 10, accuracy: 0.8 })).toBeCloseTo(8);
    expect(computeAttemptXP({ difficulty: 'intermediate', numQuestions: 10, accuracy: 0.8 })).toBeCloseTo(12);
    expect(computeAttemptXP({ difficulty: 'advanced', numQuestions: 10, accuracy: 0.8 })).toBeCloseTo(16);
  });

  it('computeStreakBonus: 2 points per streak day, capped at 30 days', () => {
    expect(computeStreakBonus(5)).toBe(10);
    expect(computeStreakBonus(30)).toBe(60);
    expect(computeStreakBonus(45)).toBe(60); // capped
    expect(computeStreakBonus(0)).toBe(0);
  });
});
