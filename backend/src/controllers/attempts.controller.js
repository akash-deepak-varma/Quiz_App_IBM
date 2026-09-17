import { prisma } from '../lib/prismaClient.js';
import { fromJsonOrNull } from '../lib/serialization.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { getProvider } from '../providers/index.js';

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
        prompt: log.question.prompt,
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

export async function explainMistake(req, res, next) {
  try {
    const { id, questionId } = req.params;

    const answerLog = await prisma.answerLog.findFirst({
      where: { attemptId: id, questionId },
      include: { question: true, attempt: { include: { quiz: true } } },
    });
    if (!answerLog || answerLog.attempt.userId !== req.user.id) {
      throw new NotFoundError('Answer not found');
    }
    if (answerLog.isCorrect) {
      throw new BadRequestError('This question was answered correctly -- nothing to explain');
    }

    const { question, attempt } = answerLog;
    const provider = getProvider(attempt.quiz.providerUsed);
    const { explanation } = await provider.explainMistake({
      type: question.type,
      prompt: question.prompt,
      options: fromJsonOrNull(question.optionsJson),
      starterCode: question.starterCode,
      correctAnswer: fromJsonOrNull(question.correctAnswer),
      explanation: question.explanation,
      userAnswer: fromJsonOrNull(answerLog.userAnswer),
    });

    res.json({ explanation });
  } catch (err) {
    next(err);
  }
}
