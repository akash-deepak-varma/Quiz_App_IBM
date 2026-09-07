export default function BadgeCard({ badge }) {
  return (
    <div
      className={`rounded-lg border p-4 text-center ${
        badge.earned ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50 opacity-60'
      }`}
    >
      <p className="font-semibold text-slate-800">{badge.name}</p>
      <p className="mt-1 text-xs text-slate-500">{badge.description}</p>
      <p className={`mt-2 text-xs font-medium uppercase tracking-wide ${badge.earned ? 'text-amber-600' : 'text-slate-400'}`}>
        {badge.earned ? 'Earned' : 'Locked'}
      </p>
      {badge.earned && badge.earnedAt && (
        <p className="mt-1 text-xs text-slate-400">{new Date(badge.earnedAt).toLocaleDateString()}</p>
      )}
    </div>
  );
}
