export default function LeaderboardTable({ rows, currentUserId }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">No scores yet for this period.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Rank</th>
            <th className="py-2">Name</th>
            <th className="py-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.userId}
              className={`border-b border-slate-100 ${row.userId === currentUserId ? 'bg-amber-50 font-medium' : ''}`}
            >
              <td className="py-2">#{row.rank}</td>
              <td className="py-2">{row.name}</td>
              <td className="py-2 text-right">{row.score.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
