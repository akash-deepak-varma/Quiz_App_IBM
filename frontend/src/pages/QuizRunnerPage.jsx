import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QuizRunnerProvider, useQuizRunner } from '../context/QuizRunnerContext.jsx';
import QuestionRenderer from '../components/questions/QuestionRenderer.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { apiFetch } from '../api/client.js';

function QuizRunnerInner() {
  const navigate = useNavigate();
  const { quiz, currentIndex, currentQuestion, totalQuestions, answers, setAnswer, goNext, goBack, getElapsedSeconds } =
    useQuizRunner();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isLast = currentIndex === totalQuestions - 1;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        answers: quiz.questions.map((q) => ({ questionId: q.id, userAnswer: answers[q.id] ?? null })),
        timeSpentSeconds: getElapsedSeconds(),
      };
      const result = await apiFetch(`/quiz/${quiz.quizId}/submit`, { method: 'POST', body: payload });
      navigate(`/quiz/${quiz.quizId}/results/${result.attemptId}`, { state: { result } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <ProgressBar current={currentIndex} total={totalQuestions} />
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <div className="rounded-lg bg-white p-4 shadow sm:p-6">
        <QuestionRenderer
          question={currentQuestion}
          value={answers[currentQuestion.id]}
          onChange={(val) => setAnswer(currentQuestion.id, val)}
        />
      </div>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={currentIndex === 0}
          className="rounded border border-slate-300 px-4 py-2 disabled:opacity-30"
        >
          Back
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Quiz'}
          </button>
        ) : (
          <button type="button" onClick={goNext} className="rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700">
            Next
          </button>
        )}
      </div>
    </div>
  );
}

export default function QuizRunnerPage() {
  const location = useLocation();
  const quiz = location.state?.quiz;

  // No GET /api/quiz/:id endpoint exists to recover this on a hard refresh or direct visit --
  // the quiz can only arrive via in-app navigation carrying it in route state.
  if (!quiz) {
    return <Navigate to="/" replace />;
  }

  return (
    <QuizRunnerProvider quiz={quiz}>
      <QuizRunnerInner />
    </QuizRunnerProvider>
  );
}
