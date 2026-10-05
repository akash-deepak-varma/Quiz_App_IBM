import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { ErrorBanner } from '../components/AsyncState.jsx';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const QUESTION_TYPES = ['mcq', 'code_completion', 'debug', 'short_answer', 'ordering', 'true_false'];

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
  const location = useLocation();
  // Read once on mount -- a subsequent client-side re-render of this same page (e.g. after
  // a failed submit) shouldn't keep re-showing a notice from an earlier navigation.
  const [notice] = useState(location.state?.notice ?? null);
  const [topic, setTopic] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState('beginner');
  const [numQuestions, setNumQuestions] = useState(5);
  const [typeMix, setTypeMix] = useState([]);
  // Provider is a saved preference now (AI Settings), not a per-request choice. The only override
  // worth keeping is "don't spend my quota on this one", which is what useMock is.
  const [aiConfig, setAiConfig] = useState(null);
  const [useMock, setUseMock] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Never blocks the form: if this fails (a cold backend, say), the checkbox below still works and
  // the submit's own error reporting handles whatever goes wrong.
  useEffect(() => {
    apiFetch('/me/ai-config')
      .then(setAiConfig)
      .catch(() => setAiConfig(null));
  }, []);

  const toggleType = (type) => {
    setTypeMix((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Queues the work and returns immediately; the progress page follows the job from there.
      // The old call generated the whole quiz inside this request, which is why a 20-question quiz
      // meant minutes on a spinner that could still end in "Something went wrong".
      const job = await apiFetch('/quiz/generations', {
        method: 'POST',
        body: {
          topic,
          notes: notes || undefined,
          difficulty,
          numQuestions: Number(numQuestions),
          typeMix: typeMix.length > 0 ? typeMix : undefined,
          // Omitted unless overriding: parseGenerateRequest treats an absent provider as "use the
          // user's saved one", which the backend then records on the job.
          provider: useMock ? 'mock' : undefined,
          tags: tags.trim() ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        },
      });
      navigate(`/quiz/generating/${job.generationId}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg bg-white p-5 shadow sm:p-8">
        <h1 className="text-2xl font-semibold text-slate-800">Generate a quiz</h1>
        {notice && <ErrorBanner message={notice} />}
        {error && <ErrorBanner message={error} />}

        <div>
          <label className="block text-sm font-medium text-slate-700">Topic</label>
          <input
            type="text"
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. JavaScript closures"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Tags (optional, comma-separated)</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. interview-prep, week-3"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Paste any notes you'd like the quiz based on..."
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
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
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
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

        <div className="space-y-2">
          {aiConfig && (
            <p className="text-sm text-slate-600">
              Using <span className="font-medium">{aiConfig.provider}</span> from your{' '}
              <Link to="/settings/ai" className="underline hover:text-slate-800">
                AI settings
              </Link>
              .
            </p>
          )}

          {aiConfig && aiConfig.provider !== 'mock' && !aiConfig.hasApiKey && !aiConfig.envFallbackEnabled && (
            <ErrorBanner message="You have not added an API key yet. Add one in AI Settings, or tick the mock option below." />
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={useMock}
              onChange={(e) => setUseMock(e.target.checked)}
              className="focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            Use the mock provider for this quiz (no API calls, no cost)
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? 'Starting...' : 'Generate quiz'}
        </button>
      </form>
    </div>
  );
}
