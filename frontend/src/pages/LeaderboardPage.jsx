import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LeaderboardTable from '../components/LeaderboardTable.jsx';
import { LoadingIndicator, ErrorBanner } from '../components/AsyncState.jsx';

const RANGES = [
  { value: 'week', label: 'This week' },
  { value: 'alltime', label: 'All time' },
];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [range, setRange] = useState('week');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRows(null);
    apiFetch(`/leaderboard?range=${range}`)
      .then((data) => setRows(data.rows))
      .catch((err) => setError(err.message));
  }, [range]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-slate-800">Leaderboard</h1>

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRange(r.value)}
            className={`rounded px-3 py-1 text-sm ${
              range === r.value ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="rounded-lg bg-white p-4 shadow">
        {rows === null ? (
          <LoadingIndicator />
        ) : (
          <LeaderboardTable rows={rows} currentUserId={user?.id} />
        )}
      </div>
    </div>
  );
}
