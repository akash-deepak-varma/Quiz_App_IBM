import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QuizRunnerProvider, useQuizRunner } from '../context/QuizRunnerContext.jsx';
import QuestionRenderer from '../components/questions/QuestionRenderer.jsx';
import QuestionEditPanel from '../components/questions/QuestionEditPanel.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { apiFetch } from '../api/client.js';
import { ErrorBanner } from '../components/AsyncState.jsx';

// Editing/regenerating a question is only allowed while its quiz has zero attempts (the
// backend 409s otherwise) -- canEdit mirrors that so the controls don't appear only to fail.
function QuizRunnerInner({ canEdit }) {
  const navigate = useNavigate();
  const {
    quiz,
    currentIndex,
    currentQuestion,
    totalQuestions,
    answers,
    setAnswer,
    goNext,
    goBack,
    getElapsedSeconds,
    replaceQuestion,
  } = useQuizRunner();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [editingQuestionId, setEditingQuestionId] = useState(null);

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
      {error && <ErrorBanner message={error} />}
      <div className="rounded-lg bg-white p-4 shadow sm:p-6">
        <QuestionRenderer
          question={currentQuestion}
          value={answers[currentQuestion.id]}
          onChange={(val) => setAnswer(currentQuestion.id, val)}
        />
        {canEdit && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            {editingQuestionId === currentQuestion.id ? (
              <QuestionEditPanel
                quizId={quiz.quizId}
                questionId={currentQuestion.id}
                onSaved={(displayFields) => {
                  replaceQuestion(currentQuestion.id, displayFields);
                  setEditingQuestionId(null);
                }}
                onCancel={() => setEditingQuestionId(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingQuestionId(currentQuestion.id)}
                className="text-sm text-slate-500 underline hover:text-slate-700"
              >
                Edit or regenerate this question
              </button>
            )}
          </div>
        )}
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
  // Freshly generated quizzes have no attempts yet; a retake from the library carries its
  // own attemptCount so editing controls stay hidden once history exists for it.
  const attemptCount = location.state?.attemptCount ?? 0;

  // A hard refresh or direct visit loses route state -- GET /api/quiz/:id exists for
  // retakes, but only the library page uses it; this page still only accepts the quiz
  // via in-app navigation carrying it in route state.
  if (!quiz) {
    return <Navigate to="/" replace state={{ notice: 'That quiz session was not found — generate a new one.' }} />;
  }

  return (
    <QuizRunnerProvider quiz={quiz}>
      <QuizRunnerInner canEdit={attemptCount === 0} />
    </QuizRunnerProvider>
  );
}
