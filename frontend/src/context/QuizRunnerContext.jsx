import { createContext, useContext, useRef, useState, useCallback, useMemo } from 'react';

const QuizRunnerContext = createContext(null);

export function QuizRunnerProvider({ quiz: initialQuiz, children }) {
  const [quiz, setQuiz] = useState(initialQuiz);
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

  // Only the display fields (id/type/prompt/options/starterCode) are kept -- correctAnswer/
  // explanation come back from the edit/regenerate endpoints but must not linger in state any
  // longer than the edit form needs them, since this is the same shape generate/retake expose.
  const replaceQuestion = useCallback((questionId, displayFields) => {
    setQuiz((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.id === questionId ? { ...q, ...displayFields } : q)),
    }));
  }, []);

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
      replaceQuestion,
    }),
    [quiz, currentIndex, answers, setAnswer, goNext, goBack, getElapsedSeconds, replaceQuestion]
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
