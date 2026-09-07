// Strips '#' and '//' line comments and '/* */' block comments while respecting string
// literals (so `"#000000"` or `"http://x"` survive intact) -- a full parser isn't needed
// since this only feeds a fast-path equality check that falls back to AI grading anyway.
function stripComments(code) {
  let result = '';
  let inString = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      result += ch;
      if (ch === '\\') {
        result += code[++i] ?? '';
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      result += ch;
      continue;
    }
    if (ch === '#' || (ch === '/' && code[i + 1] === '/')) {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i++;
      continue;
    }
    result += ch;
  }
  return result;
}

function normalizeCode(text) {
  return stripComments(text || '').trim().replace(/\s+/g, ' ');
}

function normalizeText(text) {
  return (text || '').trim().toLowerCase();
}

function arraysEqualInOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

function sameMultiset(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((item, i) => item === sortedB[i]);
}

// Exact-match scoring for every question type except short_answer, which needs the AI
// provider's rubric-based grading instead (see scoreAnswer below). Throws if asked to
// score short_answer so that mistake fails loudly rather than producing a bogus score.
export function scoreExactMatch(question, userAnswer) {
  const { correctAnswer } = question;

  switch (question.type) {
    case 'mcq': {
      const isCorrect = Array.isArray(correctAnswer)
        ? sameMultiset(userAnswer, correctAnswer)
        : typeof userAnswer === 'string' && userAnswer === correctAnswer;
      return { isCorrect, scoreFraction: isCorrect ? 1 : 0 };
    }
    case 'true_false': {
      const isCorrect = normalizeText(userAnswer) === normalizeText(correctAnswer);
      return { isCorrect, scoreFraction: isCorrect ? 1 : 0 };
    }
    case 'ordering': {
      const isCorrect = arraysEqualInOrder(userAnswer, correctAnswer);
      return { isCorrect, scoreFraction: isCorrect ? 1 : 0 };
    }
    case 'code_completion':
    case 'debug': {
      const isCorrect = normalizeCode(userAnswer) === normalizeCode(correctAnswer);
      return { isCorrect, scoreFraction: isCorrect ? 1 : 0 };
    }
    default:
      throw new Error(`scoreExactMatch cannot score question type "${question.type}"`);
  }
}

// A real AI provider's JSON output isn't guaranteed to match the {isCorrect, score,
// feedback} shape the way the mock provider's always does -- clamp/coerce it here so a
// malformed grade can't push a non-number into computeAttemptScore's arithmetic.
function normalizeGrade(grade) {
  const rawScore = Number(grade?.score);
  const score = Number.isFinite(rawScore) ? Math.min(1, Math.max(0, rawScore)) : 0;
  return {
    isCorrect: typeof grade?.isCorrect === 'boolean' ? grade.isCorrect : score >= 0.5,
    score,
    feedback: typeof grade?.feedback === 'string' && grade.feedback.trim() ? grade.feedback : 'No feedback available.',
  };
}

export async function scoreAnswer(question, userAnswer, provider) {
  if (question.type === 'short_answer') {
    const rawGrade = await provider.gradeShortAnswer({
      prompt: question.prompt,
      correctAnswer: question.correctAnswer,
      userAnswer,
    });
    const grade = normalizeGrade(rawGrade);
    return { isCorrect: grade.isCorrect, scoreFraction: grade.score, aiFeedback: grade.feedback };
  }

  const { isCorrect, scoreFraction } = scoreExactMatch(question, userAnswer);

  // Comment/whitespace-normalized equality already failed -- give the AI provider a
  // chance to recognize a functionally correct but differently-written solution before
  // giving up. gradeCode is only ever reached here, so the mock provider's always-false
  // response is consistent, not a regression.
  if (!isCorrect && (question.type === 'code_completion' || question.type === 'debug')) {
    const rawGrade = await provider.gradeCode({
      prompt: question.prompt,
      starterCode: question.starterCode,
      correctAnswer: question.correctAnswer,
      userAnswer,
    });
    const grade = normalizeGrade(rawGrade);
    return { isCorrect: grade.isCorrect, scoreFraction: grade.score, aiFeedback: grade.feedback };
  }

  return { isCorrect, scoreFraction, aiFeedback: null };
}

// Mean of per-question score fractions, not a correct-count ratio -- this is what lets
// short_answer partial credit actually move an attempt's score.
export function computeAttemptScore(scoreFractions) {
  if (scoreFractions.length === 0) return 0;
  const sum = scoreFractions.reduce((total, fraction) => total + fraction, 0);
  return sum / scoreFractions.length;
}
