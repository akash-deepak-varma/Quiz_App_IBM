import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { retakeQuiz } from '../utils/retake.js';
import { LoadingIndicator, ErrorBanner, PageError } from '../components/AsyncState.jsx';

function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export default function QuizLibraryPage() {
  const navigate = useNavigate();
  const [topics, setTopics] = useState([]);
  const [quizzes, setQuizzes] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState('');
  const [tag, setTag] = useState('');
  const [retakingId, setRetakingId] = useState(null);

  useEffect(() => {
    apiFetch('/topics')
      .then((res) => setTopics(res.topics))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setError(null);
    apiFetch(`/quiz/library${buildQuery({ q, topic, tag })}`)
      .then((res) => setQuizzes(res.quizzes))
      .catch((err) => setError(err.message));
  }, [q, topic, tag]);

  const allTags = [...new Set(topics.flatMap((t) => t.tags))].sort();

  const toggleFavorite = async (quiz) => {
    setActionError(null);
    try {
      await apiFetch(`/quiz/${quiz.quizId}/favorite`, { method: quiz.isFavorited ? 'DELETE' : 'POST' });
      setQuizzes((prev) => prev.map((qz) => (qz.quizId === quiz.quizId ? { ...qz, isFavorited: !qz.isFavorited } : qz)));
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleRetake = async (quiz) => {
    setActionError(null);
    setRetakingId(quiz.quizId);
    try {
      await retakeQuiz(navigate, quiz.quizId, quiz.attemptCount);
    } catch (err) {
      setActionError(err.message);
      setRetakingId(null);
    }
  };

  if (error) return <PageError message={error} />;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-slate-800">Quiz library</h1>

      {actionError && <ErrorBanner message={actionError} />}

      <div className="grid grid-cols-1 gap-3 rounded-lg bg-white p-4 shadow sm:grid-cols-3">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search topics..."
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        <select
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        >
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name} ({t.quizCount})
            </option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {!quizzes ? (
        <LoadingIndicator label="Loading library..." fullPage />
      ) : quizzes.length === 0 ? (
        <p className="text-sm text-slate-400">No quizzes match these filters.</p>
      ) : (
        <ul className="space-y-3">
          {quizzes.map((quiz) => (
            <li key={quiz.quizId} className="rounded-lg bg-white p-4 shadow">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-800">
                    {quiz.topic} <span className="text-sm text-slate-400">({quiz.difficulty})</span>
                  </p>
                  {quiz.tags.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {quiz.tags.map((t) => (
                        <span key={t} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {t}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-slate-500">
                    {quiz.questionCount} questions · {quiz.attemptCount} attempt{quiz.attemptCount === 1 ? '' : 's'}
                    {quiz.bestScore !== null && ` · best ${Math.round(quiz.bestScore * 100)}%`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(quiz)}
                    aria-pressed={quiz.isFavorited}
                    className={`rounded border px-3 py-1.5 text-sm ${
                      quiz.isFavorited
                        ? 'border-amber-400 bg-amber-50 text-amber-700'
                        : 'border-slate-300 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {quiz.isFavorited ? 'Favorited' : 'Favorite'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRetake(quiz)}
                    disabled={retakingId === quiz.quizId}
                    className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {retakingId === quiz.quizId ? 'Loading...' : 'Retake'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
