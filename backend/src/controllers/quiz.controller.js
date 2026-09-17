import { prisma } from '../lib/prismaClient.js';
import { generateValidatedQuiz } from '../services/quizGenerationService.js';
import { getProvider } from '../providers/index.js';
import { scoreAnswer, computeAttemptScore } from '../services/quizScoringService.js';
import { recordActivityAndGetStreak } from '../services/streakService.js';
import { evaluateAndAwardBadges } from '../services/badgeService.js';
import { computeAttemptXP } from '../services/leaderboardService.js';
import { toJsonOrNull, fromJsonOrNull } from '../lib/serialization.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { DIFFICULTIES, QUESTION_TYPES, AI_PROVIDERS, MIN_QUESTIONS, MAX_QUESTIONS } from '../constants/enums.js';
import { validateQuestion } from '../validation/quizSchema.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeNotes(notes) {
  if (typeof notes !== 'string') return null;
  const stripped = notes.replace(/<[^>]*>/g, '').trim().slice(0, 20000);
  return stripped || null;
}

export async function generate(req, res, next) {
  try {
    const { topic, notes, difficulty = 'beginner', numQuestions = 5, typeMix, provider, tags } = req.body || {};

    if (!isNonEmptyString(topic)) {
      throw new BadRequestError('topic is required');
    }
    if (!DIFFICULTIES.includes(difficulty)) {
      throw new BadRequestError(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
    }
    const count = Number(numQuestions);
    if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
      throw new BadRequestError(`numQuestions must be an integer between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}`);
    }
    if (typeMix !== undefined) {
      const isValidTypeMix =
        Array.isArray(typeMix) && typeMix.length > 0 && typeMix.every((t) => QUESTION_TYPES.includes(t));
      if (!isValidTypeMix) {
        throw new BadRequestError(`typeMix must be a non-empty array drawn from ${QUESTION_TYPES.join(', ')}`);
      }
    }
    if (provider !== undefined && !AI_PROVIDERS.includes(provider)) {
      throw new BadRequestError(`provider must be one of ${AI_PROVIDERS.join(', ')}`);
    }
    if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === 'string'))) {
      throw new BadRequestError('tags must be an array of strings');
    }

    const cleanTopic = topic.trim();
    const cleanNotes = sanitizeNotes(notes);
    const cleanTags = [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))];

    const { quiz: rawQuiz, providerUsed } = await generateValidatedQuiz({
      topic: cleanTopic,
      notes: cleanNotes,
      difficulty,
      numQuestions: count,
      typeMix,
      provider,
    });

    let topicRow = await prisma.topic.findUnique({ where: { name: cleanTopic } });
    if (!topicRow) {
      topicRow = await prisma.topic.create({ data: { name: cleanTopic } });
    }
    if (cleanTags.length > 0) {
      await prisma.topic.update({
        where: { id: topicRow.id },
        data: {
          tags: { connectOrCreate: cleanTags.map((name) => ({ where: { name }, create: { name } })) },
        },
      });
    }

    const quiz = await prisma.quiz.create({
      data: {
        userId: req.user.id,
        topicId: topicRow.id,
        difficulty,
        providerUsed,
        sourceNotes: cleanNotes,
        questions: {
          create: rawQuiz.questions.map((q, index) => ({
            type: q.type,
            prompt: q.prompt,
            optionsJson: toJsonOrNull(q.options ?? null),
            starterCode: q.starterCode ?? null,
            correctAnswer: JSON.stringify(q.correctAnswer),
            explanation: q.explanation,
            orderIndex: index,
          })),
        },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });

    res.status(201).json({
      quizId: quiz.id,
      topic: cleanTopic,
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
    const graded = [];
    for (const question of quiz.questions) {
      const userAnswer = answerByQuestionId.has(question.id) ? answerByQuestionId.get(question.id) : null;
      const correctAnswer = fromJsonOrNull(question.correctAnswer);
      const { isCorrect, scoreFraction, aiFeedback } = await scoreAnswer(
        { ...question, correctAnswer },
        userAnswer,
        provider
      );
      graded.push({ question, userAnswer, correctAnswer, isCorrect, scoreFraction, aiFeedback });
    }

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
