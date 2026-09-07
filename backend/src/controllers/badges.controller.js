import { prisma } from '../lib/prismaClient.js';

export async function listBadges(req, res, next) {
  try {
    const [allBadges, userBadges] = await Promise.all([
      prisma.badge.findMany(),
      prisma.userBadge.findMany({ where: { userId: req.user.id } }),
    ]);

    const earnedAtByBadgeId = new Map(userBadges.map((ub) => [ub.badgeId, ub.earnedAt]));

    res.json({
      badges: allBadges.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        earned: earnedAtByBadgeId.has(b.id),
        earnedAt: earnedAtByBadgeId.get(b.id) ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
}
