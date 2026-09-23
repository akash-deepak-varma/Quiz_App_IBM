import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { ErrorBanner, LoadingIndicator } from '../components/AsyncState.jsx';
import { retakeQuiz } from '../utils/retake.js';

/**
 * Where the learner waits while a quiz is generated.
 *
 * Generation used to happen inside the POST that asked for it, so the browser sat on a hanging
 * request for minutes with nothing to show and no way to leave. Now the POST returns a job id and
 * this page polls it: the count is real progress read from the staging table, and closing the tab
 * no longer cancels anything.
 *
 * Polled with a `setTimeout` chain rather than `setInterval` -- the next poll is scheduled only
 * after the previous one resolves, so a slow response can never stack up requests behind it.
 * Server-sent events would avoid the polling entirely, but `EventSource` cannot send an
 * Authorization header, and every other call in this app is Bearer-authenticated.
 */

const POLL_INTERVAL_MS = 1500;

// What to tell the learner, per failure category from the backend's taxonomy. The distinction that
// matters to them is only ever "try again" vs "change something", so several categories share a line.
const FAILURE_MESSAGES = {
  PROVIDER_RATE_LIMIT: 'The AI provider is rate limiting us right now. Waiting a minute usually clears it.',
  PROVIDER_TIMEOUT: 'The AI provider took too long to respond. Trying again usually works.',
  PROVIDER_5XX: 'The AI provider had a problem on its side. Trying again usually works.',
  NETWORK_ERROR: 'We could not reach the AI provider. Check your connection and try again.',
  PROVIDER_4XX: 'The AI provider rejected the request. Check the provider configuration before retrying.',
  OUTPUT_TRUNCATED: 'The AI kept running out of room. Try fewer questions, or split the topic in two.',
  PARSE_ERROR: 'The AI did not return usable questions this time. Trying again usually works.',
  SCHEMA_INVALID: 'The AI did not return usable questions this time. Trying again usually works.',
  CANCELLED: 'This generation was cancelled.',
};

const DEFAULT_FAILURE_MESSAGE = 'Generation did not finish. Trying again usually works.';

const TERMINAL_STATUSES = new Set(['READY', 'PARTIAL', 'FAILED', 'CANCELLED']);

const STATUS_LABELS = {
  PENDING: 'Queued…',
  GENERATING: 'Writing your questions…',
  READY: 'Ready — opening your quiz…',
};

export default function GenerationProgressPage() {
  const { generationId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // Guards the one-shot handoff to the runner: a poll already in flight when READY arrives must not
  // navigate a second time.
  const handedOff = useRef(false);

  useEffect(() => {
    let timer = null;
    let active = true;

    const poll = async () => {
      try {
        const next = await apiFetch(`/quiz/generations/${generationId}`);
        if (!active) return;
        setJob(next);

        if (next.status === 'READY' && next.quizId) {
          if (handedOff.current) return;
          handedOff.current = true;
          // The same handoff the library and dashboard use: refetch the quiz in the runner's shape
          // and navigate with it in route state.
          await retakeQuiz(navigate, next.quizId, 0);
          return;
        }

        if (TERMINAL_STATUSES.has(next.status)) return;

        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (!active) return;
        setError(err.message);
      }
    };

    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [generationId, navigate]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      const cancelled = await apiFetch(`/quiz/generations/${generationId}/cancel`, { method: 'POST' });
      setJob(cancelled);
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  }, [generationId]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <ErrorBanner message={error} />
        <Link to="/" className="text-sm text-slate-600 underline">
          Back to generate a quiz
        </Link>
      </div>
    );
  }

  if (!job) {
    return <LoadingIndicator label="Loading your quiz…" fullPage />;
  }

  // PARTIAL is a real backend state but not an offer we make yet: a half-finished quiz is not
  // something to sit an attempt on, so the learner is told to try again like any other shortfall.
  const failed = job.status === 'FAILED' || job.status === 'PARTIAL' || job.status === 'CANCELLED';
  const percent = job.requested > 0 ? Math.min(100, Math.round((job.generated / job.requested) * 100)) : 0;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="space-y-5 rounded-lg bg-white p-5 shadow sm:p-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {failed ? 'Generation stopped' : 'Building your quiz'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {job.topic} · {job.difficulty}
          </p>
        </div>

        {failed ? (
          <>
            <ErrorBanner message={FAILURE_MESSAGES[job.failureCategory] ?? DEFAULT_FAILURE_MESSAGE} />
            <Link
              to="/"
              className="inline-block rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
            >
              Try again
            </Link>
          </>
        ) : (
          <>
            <div>
              <div className="flex items-baseline justify-between text-sm text-slate-600">
                <span>{STATUS_LABELS[job.status] ?? 'Working…'}</span>
                <span aria-label="questions ready">
                  {job.generated} / {job.requested}
                </span>
              </div>
              {/* Not components/ProgressBar.jsx: that one is the runner's "Question 3 of 10"
                  position indicator, which counts from a zero-based index. This counts finished
                  work, so 0 of 10 is a real state it has to be able to show. */}
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-valuenow={job.generated}
                aria-valuemin={0}
                aria-valuemax={job.requested}
              >
                <div
                  className="h-full bg-slate-800 transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <p className="text-sm text-slate-500">
              Questions are written in small batches, so this keeps going even if you refresh or come
              back later.
            </p>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="rounded border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
              <Link to="/library" className="text-sm text-slate-600 underline">
                Leave this running
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
