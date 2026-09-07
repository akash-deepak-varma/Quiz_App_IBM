export default function ProgressBar({ current, total }) {
  const percent = total > 0 ? Math.round(((current + 1) / total) * 100) : 0;

  return (
    <div>
      <div className="flex justify-between text-sm text-slate-500">
        <span>
          Question {current + 1} of {total}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-slate-800 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
