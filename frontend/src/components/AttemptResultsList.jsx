function formatAnswer(answer) {
  if (answer === null || answer === undefined) return '(no answer)';
  if (Array.isArray(answer)) return answer.join(' → ');
  return String(answer);
}

export default function AttemptResultsList({ results }) {
  return (
    <div className="space-y-4">
      {results.map((r, index) => (
        <div
          key={r.questionId}
          className={`rounded-lg border p-4 ${r.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
        >
          <p className="text-sm font-medium text-slate-500">Question {index + 1}</p>
          <p className={`mt-1 font-semibold ${r.isCorrect ? 'text-green-700' : 'text-red-700'}`}>
            {r.isCorrect ? 'Correct' : 'Incorrect'}
          </p>
          <div className="mt-2 space-y-1 text-sm text-slate-600">
            <p>Your answer:</p>
            <pre className="whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-xs">{formatAnswer(r.userAnswer)}</pre>
            <p>Correct answer:</p>
            <pre className="whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-xs">{formatAnswer(r.correctAnswer)}</pre>
          </div>
          {r.aiFeedback && <p className="mt-2 text-sm italic text-slate-500">{r.aiFeedback}</p>}
          <p className="mt-2 text-sm text-slate-700">{r.explanation}</p>
        </div>
      ))}
    </div>
  );
}
