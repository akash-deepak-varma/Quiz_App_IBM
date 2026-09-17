import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import AttemptResultsList from '../components/AttemptResultsList.jsx';
import { LoadingIndicator, PageError } from '../components/AsyncState.jsx';

export default function ResultsPage() {
  const location = useLocation();
  const { attemptId } = useParams();
  // The submit response (with newBadges/streak) arrives via route state on the normal path.
  // On a refresh or direct visit, fall back to GET /api/attempts/:id -- it has score/results
  // but not newBadges/streak, which is fine: those are one-time submission events, not
  // stable facts worth redisplaying on a later refetch.
  const [result, setResult] = useState(location.state?.result ?? null);
  const [loading, setLoading] = useState(!location.state?.result);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (result) return;
    apiFetch(`/attempts/${attemptId}`)
      .then(setResult)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [attemptId, result]);

  if (loading) return <LoadingIndicator label="Loading results..." fullPage />;
  if (error) return <PageError message={error} />;
  if (!result) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="rounded-lg bg-white p-4 shadow sm:p-6">
        <h1 className="text-2xl font-semibold text-slate-800">Quiz Results</h1>
        <p className="mt-2 text-lg text-slate-600">
          Score: <span className="font-semibold">{Math.round(result.score * 100)}%</span>
        </p>
        {result.streak && (
          <p className="mt-1 text-sm text-slate-500">
            Streak: {result.streak.current} day{result.streak.current === 1 ? '' : 's'} (longest {result.streak.longest})
          </p>
        )}
        {result.newBadges?.length > 0 && (
          <div className="mt-4 rounded bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-800">
              New badge{result.newBadges.length > 1 ? 's' : ''} earned!
            </p>
            <ul className="mt-1 list-inside list-disc text-sm text-amber-700">
              {result.newBadges.map((b) => (
                <li key={b.id}>
                  {b.name} — {b.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <AttemptResultsList results={result.results} attemptId={attemptId} />

      <Link to="/" className="inline-block rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700">
        Generate another quiz
      </Link>
    </div>
  );
}
