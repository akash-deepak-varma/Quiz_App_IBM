import { useState } from 'react';
import { apiFetch } from '../api/client.js';
import MathText from './MathText.jsx';

function formatAnswer(answer) {
  if (answer === null || answer === undefined) return '(no answer)';
  if (Array.isArray(answer)) return answer.join(' → ');
  return String(answer);
}

function ResultRow({ result: r, index, attemptId }) {
  const [explainState, setExplainState] = useState('idle'); // idle | loading | loaded | error
  const [mistakeExplanation, setMistakeExplanation] = useState(null);
  const [explainError, setExplainError] = useState(null);

  const handleExplain = async () => {
    setExplainState('loading');
    setExplainError(null);
    try {
      const data = await apiFetch(`/attempts/${attemptId}/questions/${r.questionId}/explain`, { method: 'POST' });
      setMistakeExplanation(data.explanation);
      setExplainState('loaded');
    } catch (err) {
      setExplainError(err.message);
      setExplainState('error');
    }
  };

  return (
    <div className={`rounded-lg border p-4 ${r.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <p className="text-sm font-medium text-slate-500">Question {index + 1}</p>
      <MathText as="p" className="mt-1 font-medium text-slate-800" text={r.prompt} />
      <p className={`mt-2 font-semibold ${r.isCorrect ? 'text-green-700' : 'text-red-700'}`}>
        {r.isCorrect ? 'Correct' : 'Incorrect'}
      </p>
      <div className="mt-2 space-y-1 text-sm text-slate-600">
        <p>Your answer:</p>
        <pre className="whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-xs">{formatAnswer(r.userAnswer)}</pre>
        <p>Correct answer:</p>
        <pre className="whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-xs">{formatAnswer(r.correctAnswer)}</pre>
      </div>
      {r.aiFeedback && <MathText as="p" className="mt-2 text-sm italic text-slate-500" text={r.aiFeedback} />}
      <MathText as="p" className="mt-2 text-sm text-slate-700" text={r.explanation} />

      {!r.isCorrect && (
        <div className="mt-3">
          {explainState !== 'loaded' && (
            <button
              type="button"
              onClick={handleExplain}
              disabled={explainState === 'loading'}
              className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              {explainState === 'loading' ? 'Thinking...' : 'Help me understand my mistake'}
            </button>
          )}
          {explainState === 'error' && <p className="mt-2 text-sm text-red-600">{explainError}</p>}
          {explainState === 'loaded' && (
            <div className="mt-2 rounded border border-red-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase text-red-500">Understanding your mistake</p>
              <MathText as="p" className="mt-1 text-sm text-slate-700" text={mistakeExplanation} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AttemptResultsList({ results, attemptId }) {
  return (
    <div className="space-y-4">
      {results.map((r, index) => (
        <ResultRow key={r.questionId} result={r} index={index} attemptId={attemptId} />
      ))}
    </div>
  );
}
