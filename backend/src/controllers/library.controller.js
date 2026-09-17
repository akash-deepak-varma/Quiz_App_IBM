import { prisma } from '../lib/prismaClient.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

export async function listLibrary(req, res, next) {
  try {
    const { topic, tag, q, take, skip } = req.query;

    const takeNum = take !== undefined ? Number(take) : DEFAULT_TAKE;
    const skipNum = skip !== undefined ? Number(skip) : 0;
    if (!Number.isInteger(takeNum) || takeNum < 1 || takeNum > MAX_TAKE) {
      throw new BadRequestError(`take must be an integer between 1 and ${MAX_TAKE}`);
    }
    if (!Number.isInteger(skipNum) || skipNum < 0) {
      throw new BadRequestError('skip must be a non-negative integer');
    }

    const topicFilter = {};
    if (typeof q === 'string' && q.trim()) {
      topicFilter.name = { contains: q.trim(), mode: 'insensitive' };
    } else if (typeof topic === 'string' && topic.trim()) {
      topicFilter.name = topic.trim();
    }
    if (typeof tag === 'string' && tag.trim()) {
      topicFilter.tags = { some: { name: tag.trim() } };
    }

    const where = {
      userId: req.user.id,
      ...(Object.keys(topicFilter).length > 0 ? { topic: topicFilter } : {}),
    };

    const [quizzes, total] = await Promise.all([
      prisma.quiz.findMany({
        where,
        include: {
          topic: { include: { tags: true } },
          questions: { select: { id: true } },
          attempts: { where: { completedAt: { not: null } }, select: { score: true, completedAt: true } },
          favorites: { where: { userId: req.user.id }, select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: takeNum,
        skip: skipNum,
      }),
      prisma.quiz.count({ where }),
    ]);

    res.json({
      total,
      quizzes: quizzes.map((quiz) => {
        const scores = quiz.attempts.map((a) => a.score).filter((s) => s !== null);
        const lastAttempt = quiz.attempts.reduce(
          (latest, a) => (!latest || a.completedAt > latest.completedAt ? a : latest),
          null
        );
        return {
          quizId: quiz.id,
          topic: quiz.topic.name,
          tags: quiz.topic.tags.map((t) => t.name),
          difficulty: quiz.difficulty,
          createdAt: quiz.createdAt,
          questionCount: quiz.questions.length,
          attemptCount: quiz.attempts.length,
          bestScore: scores.length > 0 ? Math.max(...scores) : null,
          lastScore: lastAttempt?.score ?? null,
          isFavorited: quiz.favorites.length > 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

export async function listTopics(req, res, next) {
  try {
    const topics = await prisma.topic.findMany({
      where: { quizzes: { some: { userId: req.user.id } } },
      include: {
        tags: true,
        _count: { select: { quizzes: { where: { userId: req.user.id } } } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      topics: topics.map((t) => ({
        id: t.id,
        name: t.name,
        tags: t.tags.map((tag) => tag.name),
        quizCount: t._count.quizzes,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function favoriteQuiz(req, res, next) {
  try {
    const { id } = req.params;
    const quiz = await prisma.quiz.findUnique({ where: { id } });
    if (!quiz || quiz.userId !== req.user.id) {
      throw new NotFoundError('Quiz not found');
    }
    await prisma.favorite.upsert({
      where: { userId_quizId: { userId: req.user.id, quizId: id } },
      create: { userId: req.user.id, quizId: id },
      update: {},
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function unfavoriteQuiz(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.favorite.deleteMany({ where: { userId: req.user.id, quizId: id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
