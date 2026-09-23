import { prisma } from '../lib/prismaClient.js';
import { generateValidatedQuiz } from '../services/quizGenerationService.js';
import { getProvider } from '../providers/index.js';
import { scoreAnswer, computeAttemptScore } from '../services/quizScoringService.js';
import { recordActivityAndGetStreak } from '../services/streakService.js';
import { evaluateAndAwardBadges } from '../services/badgeService.js';
import { computeAttemptXP } from '../services/leaderboardService.js';
import { materializeQuiz } from '../services/quizMaterializationService.js';
import { mapWithConcurrency } from '../services/generation/pool.js';
import { toJsonOrNull, fromJsonOrNull } from '../lib/serialization.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { validateQuestion } from '../validation/quizSchema.js';
import { parseGenerateRequest } from '../validation/generateRequest.js';

// Grading fans out over the same bounded pool generation uses. Kept modest on purpose: a 20-question
// submission where every answer needs the provider should not open 20 simultaneous requests.
const GRADING_CONCURRENCY = 3;

export async function generate(req, res, next) {
  try {
    const { topic, notes, difficulty, numQuestions, typeMix, provider, tags } = parseGenerateRequest(req.body);

    const { quiz: rawQuiz, providerUsed } = await generateValidatedQuiz({
      topic,
      notes,
      difficulty,
      numQuestions,
      typeMix,
      provider,
    });

    const quiz = await materializeQuiz({
      userId: req.user.id,
      topic,
      difficulty,
      providerUsed,
      notes,
      tags,
      questions: rawQuiz.questions,
    });

    res.status(201).json({
      quizId: quiz.id,
      topic,
      difficulty: quiz.difficulty,
      providerUsed: quiz.providerUsed,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: fromJsonOrNull(q.optionsJson),
        starterCode: q.starterCode,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function getForRetake(req, res, next) {
  try {
    const { id } = req.params;
    const quiz = await prisma.quiz.findUnique({
      where: { id },
      include: { topic: true, questions: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!quiz || quiz.userId !== req.user.id) {
      throw new NotFoundError('Quiz not found');
    }

    res.json({
      quizId: quiz.id,
      topic: quiz.topic.name,
      difficulty: quiz.difficulty,
      providerUsed: quiz.providerUsed,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: fromJsonOrNull(q.optionsJson),
        starterCode: q.starterCode,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function submit(req, res, next) {
  try {
    const { id } = req.params;
    const { answers, timeSpentSeconds } = req.body || {};

    if (!Array.isArray(answers) || answers.length === 0) {
      throw new BadRequestError('answers must be a non-empty array');
    }

    const quiz = await prisma.quiz.findUnique({
      where: { id },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!quiz || quiz.userId !== req.user.id) {
      throw new NotFoundError('Quiz not found');
    }

    const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a.userAnswer]));
    const provider = getProvider(quiz.providerUsed);

    // Iterate the quiz's own question list, not the client-submitted answers -- otherwise
    // a client could omit a question entirely and have it silently excluded from the
    // score average instead of counted as incorrect.
    //
    // Graded concurrently but in order: only short_answer and code questions that failed the exact
    // match actually call the provider, and grading them one after another made a submission as
    // slow as the sum of those calls. `mapWithConcurrency` preserves position, which matters --
    // `computeAttemptScore` and the `answerLogs` rows both read this array by index.
    const graded = await mapWithConcurrency(quiz.questions, GRADING_CONCURRENCY, async (question) => {
      const userAnswer = answerByQuestionId.has(question.id) ? answerByQuestionId.get(question.id) : null;
      const correctAnswer = fromJsonOrNull(question.correctAnswer);
      const { isCorrect, scoreFraction, aiFeedback } = await scoreAnswer(
        { ...question, correctAnswer },
        userAnswer,
        provider
      );
      return { question, userAnswer, correctAnswer, isCorrect, scoreFraction, aiFeedback };
    });

    const parsedTimeSpent = Number(timeSpentSeconds);
    const attemptScore = computeAttemptScore(graded.map((g) => g.scoreFraction));

    const attempt = await prisma.attempt.create({
      data: {
        quizId: quiz.id,
        userId: req.user.id,
        completedAt: new Date(),
        score: attemptScore,
        xp: computeAttemptXP({ difficulty: quiz.difficulty, numQuestions: graded.length, accuracy: attemptScore }),
        timeSpentSeconds: Number.isFinite(parsedTimeSpent) ? parsedTimeSpent : null,
        answerLogs: {
          create: graded.map((g) => ({
            questionId: g.question.id,
            userAnswer: JSON.stringify(g.userAnswer),
            isCorrect: g.isCorrect,
            scoreFraction: g.scoreFraction,
            aiFeedback: g.aiFeedback,
          })),
        },
      },
    });

    const streak = await recordActivityAndGetStreak(req.user.id);
    const newBadges = await evaluateAndAwardBadges(req.user.id, streak);

    res.json({
      attemptId: attempt.id,
      score: attempt.score,
      results: graded.map((g) => ({
        questionId: g.question.id,
        type: g.question.type,
        prompt: g.question.prompt,
        isCorrect: g.isCorrect,
        correctAnswer: g.correctAnswer,
        explanation: g.question.explanation,
        userAnswer: g.userAnswer,
        aiFeedback: g.aiFeedback,
      })),
      newBadges: newBadges.map((b) => ({ id: b.id, name: b.name, description: b.description })),
      streak: { current: streak.currentStreak, longest: streak.longestStreak },
    });
  } catch (err) {
    next(err);
  }
}

function serializeEditableQuestion(question) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    options: fromJsonOrNull(question.optionsJson),
    starterCode: question.starterCode,
    correctAnswer: fromJsonOrNull(question.correctAnswer),
    explanation: question.explanation,
  };
}

async function loadOwnedQuizQuestion(userId, quizId, questionId) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: { topic: true } });
  if (!quiz || quiz.userId !== userId) {
    throw new NotFoundError('Quiz not found');
  }
  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question || question.quizId !== quizId) {
    throw new NotFoundError('Question not found');
  }
  const attemptCount = await prisma.attempt.count({ where: { quizId } });
  if (attemptCount > 0) {
    throw new ConflictError('This quiz already has attempts -- its questions can no longer be edited');
  }
  return { quiz, question };
}

export async function getEditableQuestion(req, res, next) {
  try {
    const { quizId, questionId } = req.params;
    const { question } = await loadOwnedQuizQuestion(req.user.id, quizId, questionId);
    res.json(serializeEditableQuestion(question));
  } catch (err) {
    next(err);
  }
}

export async function updateQuestion(req, res, next) {
  try {
    const { quizId, questionId } = req.params;
    const { question } = await loadOwnedQuizQuestion(req.user.id, quizId, questionId);

    const { prompt, options, starterCode, correctAnswer, explanation } = req.body || {};
    const merged = {
      type: question.type,
      prompt: prompt !== undefined ? prompt : question.prompt,
      options: options !== undefined ? options : fromJsonOrNull(question.optionsJson),
      starterCode: starterCode !== undefined ? starterCode : question.starterCode,
      correctAnswer: correctAnswer !== undefined ? correctAnswer : fromJsonOrNull(question.correctAnswer),
      explanation: explanation !== undefined ? explanation : question.explanation,
    };

    const errors = [];
    validateQuestion(merged, 0, errors);
    if (errors.length > 0) {
      throw new BadRequestError(errors.join('; '));
    }

    const updated = await prisma.question.update({
      where: { id: questionId },
      data: {
        prompt: merged.prompt,
        optionsJson: toJsonOrNull(merged.options),
        starterCode: merged.starterCode,
        correctAnswer: JSON.stringify(merged.correctAnswer),
        explanation: merged.explanation,
      },
    });

    res.json(serializeEditableQuestion(updated));
  } catch (err) {
    next(err);
  }
}

export async function regenerateQuestion(req, res, next) {
  try {
    const { quizId, questionId } = req.params;
    const { quiz, question } = await loadOwnedQuizQuestion(req.user.id, quizId, questionId);

    const { quiz: rawQuiz } = await generateValidatedQuiz({
      topic: quiz.topic.name,
      notes: quiz.sourceNotes,
      difficulty: quiz.difficulty,
      numQuestions: 1,
      typeMix: [question.type],
      provider: quiz.providerUsed,
    });
    const regenerated = rawQuiz.questions[0];

    const updated = await prisma.question.update({
      where: { id: questionId },
      data: {
        type: regenerated.type,
        prompt: regenerated.prompt,
        optionsJson: toJsonOrNull(regenerated.options ?? null),
        starterCode: regenerated.starterCode ?? null,
        correctAnswer: JSON.stringify(regenerated.correctAnswer),
        explanation: regenerated.explanation,
      },
    });

    res.json(serializeEditableQuestion(updated));
  } catch (err) {
    next(err);
  }
}
