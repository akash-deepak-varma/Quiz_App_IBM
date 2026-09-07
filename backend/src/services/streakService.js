import { prisma } from '../lib/prismaClient.js';

export function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function utcYesterday(dateString) {
  const d = new Date(`${dateString}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDateString(d);
}

// Pure state transition, no I/O -- `current` is the existing {currentStreak, longestStreak,
// lastActiveDate} shape (or null/undefined for a user's first-ever activity). Kept separate
// from recordActivityAndGetStreak below so the day-boundary logic is unit-testable without a DB.
export function applyStreakActivity(current, now = new Date()) {
  const today = utcDateString(now);

  if (!current || !current.lastActiveDate) {
    return { currentStreak: 1, longestStreak: 1, lastActiveDate: today };
  }
  if (current.lastActiveDate === today) {
    return { currentStreak: current.currentStreak, longestStreak: current.longestStreak, lastActiveDate: today };
  }

  const nextStreak = current.lastActiveDate === utcYesterday(today) ? current.currentStreak + 1 : 1;

  return {
    currentStreak: nextStreak,
    longestStreak: Math.max(current.longestStreak, nextStreak),
    lastActiveDate: today,
  };
}

export async function recordActivityAndGetStreak(userId, now = new Date()) {
  const existing = await prisma.streak.findUnique({ where: { userId } });
  const next = applyStreakActivity(existing, now);

  return prisma.streak.upsert({
    where: { userId },
    update: next,
    create: { userId, ...next },
  });
}
