import { createContext, useContext, useRef, useState, useCallback, useMemo } from 'react';

const QuizRunnerContext = createContext(null);

export function QuizRunnerProvider({ quiz, children }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const startedAtRef = useRef(Date.now());

  const setAnswer = useCallback((questionId, userAnswer) => {
    setAnswers((prev) => ({ ...prev, [questionId]: userAnswer }));
  }, []);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, quiz.questions.length - 1));
  }, [quiz.questions.length]);

  const goBack = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const getElapsedSeconds = useCallback(() => Math.round((Date.now() - startedAtRef.current) / 1000), []);

  const value = useMemo(
    () => ({
      quiz,
      currentIndex,
      currentQuestion: quiz.questions[currentIndex],
      totalQuestions: quiz.questions.length,
      answers,
      setAnswer,
      goNext,
      goBack,
      getElapsedSeconds,
    }),
    [quiz, currentIndex, answers, setAnswer, goNext, goBack, getElapsedSeconds]
  );

  return <QuizRunnerContext.Provider value={value}>{children}</QuizRunnerContext.Provider>;
}

export function useQuizRunner() {
  const ctx = useContext(QuizRunnerContext);
  if (!ctx) {
    throw new Error('useQuizRunner must be used within a QuizRunnerProvider');
  }
  return ctx;
}
