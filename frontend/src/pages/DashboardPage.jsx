import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import AccuracyTrendChart from '../components/charts/AccuracyTrendChart.jsx';
import TopicAccuracyChart from '../components/charts/TopicAccuracyChart.jsx';
import AttemptResultsList from '../components/AttemptResultsList.jsx';
import { LoadingIndicator, PageError } from '../components/AsyncState.jsx';

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg bg-white p-4 text-center shadow">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState(null);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    Promise.all([apiFetch('/dashboard/summary'), apiFetch('/dashboard/history')])
      .then(([s, h]) => {
        setSummary(s);
        setHistory(h.attempts);
      })
      .catch((err) => setError(err.message));
  }, []);

  const viewAttempt = async (attemptId) => {
    if (selectedAttemptId === attemptId) {
      setSelectedAttemptId(null);
      setSelectedAttempt(null);
      return;
    }
    setSelectedAttemptId(attemptId);
    setSelectedAttempt(null);
    setDetailLoading(true);
    try {
      const detail = await apiFetch(`/attempts/${attemptId}`);
      setSelectedAttempt(detail);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  if (error) return <PageError message={error} />;
  if (!summary || !history) return <LoadingIndicator label="Loading dashboard..." fullPage />;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-slate-800">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Quizzes taken" value={summary.quizzesTaken} />
        <StatCard label="Overall accuracy" value={`${Math.round(summary.overallAccuracy * 100)}%`} />
        <StatCard label="Time spent" value={formatDuration(summary.totalTimeSpentSeconds)} />
        <StatCard label="Streak" value={`${summary.streak.current} (best ${summary.streak.longest})`} />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-4 shadow">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Accuracy over time</h2>
          <AccuracyTrendChart data={summary.accuracyTrend} />
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Accuracy by topic</h2>
          <TopicAccuracyChart data={summary.byTopic} />
        </div>
      </div>

      {summary.weakestTopics.length > 0 && (
        <div className="rounded-lg bg-white p-4 shadow">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Weakest topics</h2>
          <ul className="space-y-1 text-sm text-slate-600">
            {summary.weakestTopics.map((t) => (
              <li key={t.topic}>
                {t.topic} — {Math.round(t.accuracy * 100)}%
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">No quizzes taken yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((a) => (
              <li key={a.attemptId}>
                <button
                  type="button"
                  onClick={() => viewAttempt(a.attemptId)}
                  className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    {a.topic} <span className="text-slate-400">({a.difficulty})</span>
                  </span>
                  <span className="text-slate-500">
                    {Math.round(a.score * 100)}% · {new Date(a.completedAt).toLocaleDateString()}
                  </span>
                </button>
                {selectedAttemptId === a.attemptId && (
                  <div className="border-t border-slate-100 py-3">
                    {detailLoading ? (
                      <LoadingIndicator />
                    ) : (
                      selectedAttempt && (
                        <AttemptResultsList results={selectedAttempt.results} attemptId={selectedAttemptId} />
                      )
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
