import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { ErrorBanner, LoadingIndicator } from '../AsyncState.jsx';

// correctAnswer/options are string[] for mcq(multi)/ordering, string otherwise -- one item
// per line in the textarea keeps the editor generic across question types without bespoke
// per-type form fields.
function linesToValue(text, wasArray) {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (wasArray) return lines;
  return lines[0] ?? '';
}

function valueToLines(value) {
  if (Array.isArray(value)) return value.join('\n');
  return value ?? '';
}

export default function QuestionEditPanel({ quizId, questionId, onSaved, onCancel }) {
  const [question, setQuestion] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [explanation, setExplanation] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [starterCode, setStarterCode] = useState('');
  const [correctAnswerText, setCorrectAnswerText] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch(`/quiz/${quizId}/questions/${questionId}`)
      .then((q) => {
        setQuestion(q);
        setPrompt(q.prompt);
        setExplanation(q.explanation ?? '');
        setOptionsText(valueToLines(q.options));
        setStarterCode(q.starterCode ?? '');
        setCorrectAnswerText(valueToLines(q.correctAnswer));
      })
      .catch((err) => setLoadError(err.message));
  }, [quizId, questionId]);

  if (loadError) {
    return (
      <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-4">
        <ErrorBanner message={loadError} />
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">
          Close
        </button>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-4">
        <LoadingIndicator label="Loading question..." />
      </div>
    );
  }

  const hasOptions = question.options !== null && question.options !== undefined;
  const hasStarterCode = question.starterCode !== null && question.starterCode !== undefined;
  const correctAnswerWasArray = Array.isArray(question.correctAnswer);

  const applyDisplayFields = (updated) => {
    onSaved({
      id: updated.id,
      type: updated.type,
      prompt: updated.prompt,
      options: updated.options,
      starterCode: updated.starterCode,
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiFetch(`/quiz/${quizId}/questions/${questionId}`, {
        method: 'PATCH',
        body: {
          prompt,
          explanation,
          options: hasOptions ? linesToValue(optionsText, true) : undefined,
          starterCode: hasStarterCode ? starterCode : undefined,
          correctAnswer: linesToValue(correctAnswerText, correctAnswerWasArray),
        },
      });
      applyDisplayFields(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setError(null);
    setRegenerating(true);
    try {
      const updated = await apiFetch(`/quiz/${quizId}/questions/${questionId}/regenerate`, { method: 'POST' });
      applyDisplayFields(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-3 rounded border border-slate-200 bg-slate-50 p-4">
      {error && <ErrorBanner message={error} />}

      <div>
        <label className="block text-xs font-medium text-slate-600">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      {hasOptions && (
        <div>
          <label className="block text-xs font-medium text-slate-600">Options (one per line)</label>
          <textarea
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
      )}

      {hasStarterCode && (
        <div>
          <label className="block text-xs font-medium text-slate-600">Starter code</label>
          <textarea
            value={starterCode}
            onChange={(e) => setStarterCode(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Correct answer{correctAnswerWasArray ? ' (one per line, in order)' : ''}
        </label>
        <textarea
          value={correctAnswerText}
          onChange={(e) => setCorrectAnswerText(e.target.value)}
          rows={correctAnswerWasArray ? 3 : 1}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Explanation</label>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || regenerating}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={saving || regenerating}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating...' : 'Regenerate with AI'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving || regenerating}
          className="rounded px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
