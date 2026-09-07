import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const QUESTION_TYPES = ['mcq', 'code_completion', 'debug', 'short_answer', 'ordering', 'true_false'];
const PROVIDERS = ['mock', 'claude', 'openai'];

const TYPE_LABELS = {
  mcq: 'Multiple choice',
  code_completion: 'Code completion',
  debug: 'Debug',
  short_answer: 'Short answer',
  ordering: 'Ordering',
  true_false: 'True / False',
};

export default function GenerateQuizPage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState('beginner');
  const [numQuestions, setNumQuestions] = useState(5);
  const [typeMix, setTypeMix] = useState([]);
  const [provider, setProvider] = useState('mock');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleType = (type) => {
    setTypeMix((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const quiz = await apiFetch('/quiz/generate', {
        method: 'POST',
        body: {
          topic,
          notes: notes || undefined,
          difficulty,
          numQuestions: Number(numQuestions),
          typeMix: typeMix.length > 0 ? typeMix : undefined,
          provider,
        },
      });
      navigate(`/quiz/${quiz.quizId}/run`, { state: { quiz } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg bg-white p-5 shadow sm:p-8">
        <h1 className="text-2xl font-semibold text-slate-800">Generate a quiz</h1>
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div>
          <label className="block text-sm font-medium text-slate-700">Topic</label>
          <input
            type="text"
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. JavaScript closures"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Paste any notes you'd like the quiz based on..."
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Number of questions</label>
            <input
              type="number"
              min={1}
              max={20}
              value={numQuestions}
              onChange={(e) => setNumQuestions(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Question types (optional — leave all unchecked for a mix)
          </label>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {QUESTION_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={typeMix.includes(type)} onChange={() => toggleType(type)} />
                {TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">AI provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? 'Generating...' : 'Generate quiz'}
        </button>
      </form>
    </div>
  );
}
