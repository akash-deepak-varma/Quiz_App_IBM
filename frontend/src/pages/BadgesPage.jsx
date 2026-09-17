import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import BadgeCard from '../components/BadgeCard.jsx';
import { LoadingIndicator, ErrorBanner } from '../components/AsyncState.jsx';

export default function BadgesPage() {
  const [badges, setBadges] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/badges')
      .then((data) => setBadges(data.badges))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-slate-800">Badge Cabinet</h1>
      {error && <ErrorBanner message={error} />}
      {badges === null ? (
        <LoadingIndicator />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {badges.map((badge) => (
            <BadgeCard key={badge.id} badge={badge} />
          ))}
        </div>
      )}
    </div>
  );
}
