import { prisma } from '../lib/prismaClient.js';
import { fromJsonOrNull } from '../lib/serialization.js';
import { NotFoundError } from '../lib/errors.js';

export async function getAttempt(req, res, next) {
  try {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: { answerLogs: { include: { question: true } } },
    });
    if (!attempt || attempt.userId !== req.user.id) {
      throw new NotFoundError('Attempt not found');
    }

    res.json({
      attemptId: attempt.id,
      score: attempt.score,
      results: attempt.answerLogs.map((log) => ({
        questionId: log.questionId,
        type: log.question.type,
        isCorrect: log.isCorrect,
        correctAnswer: fromJsonOrNull(log.question.correctAnswer),
        explanation: log.question.explanation,
        userAnswer: fromJsonOrNull(log.userAnswer),
        aiFeedback: log.aiFeedback,
      })),
    });
  } catch (err) {
    next(err);
  }
}
