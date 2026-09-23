import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GenerationProgressPage from './GenerationProgressPage.jsx';
import { apiFetch } from '../api/client.js';

vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }));

const JOB = {
  generationId: 'gen1',
  status: 'GENERATING',
  requested: 10,
  generated: 6,
  topic: 'Closures',
  difficulty: 'intermediate',
  provider: 'mock',
  quizId: null,
  failureCategory: null,
};

const QUIZ = { quizId: 'q1', topic: 'Closures', difficulty: 'intermediate', questions: [] };

// The runner is the navigation target; rendering a stand-in is enough to prove we got there.
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/quiz/generating/gen1']}>
      <Routes>
        <Route path="/quiz/generating/:generationId" element={<GenerationProgressPage />} />
        <Route path="/quiz/:id/run" element={<p>Runner for q1</p>} />
        <Route path="/" element={<p>Generate a quiz</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GenerationProgressPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows how many questions are ready while the job runs', async () => {
    apiFetch.mockResolvedValue(JOB);

    renderPage();

    expect(await screen.findByText('6 / 10')).toBeInTheDocument();
    expect(screen.getByText(/Writing your questions/)).toBeInTheDocument();
    expect(screen.getByText(/Closures/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
  });

  it('keeps polling until the job finishes, then hands the quiz to the runner', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiFetch
      .mockResolvedValueOnce({ ...JOB, generated: 2 })
      .mockResolvedValueOnce({ ...JOB, status: 'READY', generated: 10, quizId: 'q1' })
      .mockResolvedValueOnce(QUIZ); // retakeQuiz's GET /quiz/q1

    renderPage();

    expect(await screen.findByText('2 / 10')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));

    expect(await screen.findByText('Runner for q1')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/quiz/q1');
    // Three calls, not four: the chain stops at READY rather than polling a finished job forever.
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  // The page holds no state of its own: the job id comes from the URL and everything else from the
  // server. That is what makes a refresh -- or opening the link an hour later -- land on the quiz
  // rather than on an empty spinner, so a job that finished while the tab was closed still opens.
  it('opens the quiz straight away when the job finished before the page loaded', async () => {
    apiFetch
      .mockResolvedValueOnce({ ...JOB, status: 'READY', generated: 10, quizId: 'q1' })
      .mockResolvedValueOnce(QUIZ);

    renderPage();

    expect(await screen.findByText('Runner for q1')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/quiz/generations/gen1');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('explains a failure in terms of what the learner can do about it', async () => {
    apiFetch.mockResolvedValue({
      ...JOB,
      status: 'FAILED',
      generated: 0,
      failureCategory: 'PROVIDER_RATE_LIMIT',
    });

    renderPage();

    expect(await screen.findByText(/rate limiting us right now/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  // PARTIAL exists in the backend's model but is deliberately not offered as a shorter quiz yet.
  it('treats a partial job as a failure rather than opening a short quiz', async () => {
    apiFetch.mockResolvedValue({ ...JOB, status: 'PARTIAL', generated: 4, failureCategory: 'SCHEMA_INVALID' });

    renderPage();

    expect(await screen.findByText('Generation stopped')).toBeInTheDocument();
    expect(screen.queryByText('Runner for q1')).not.toBeInTheDocument();
  });

  it('stops polling and reports the new status when the learner cancels', async () => {
    apiFetch.mockImplementation((path, opts) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ...JOB, status: 'CANCELLED', failureCategory: 'CANCELLED' });
      }
      return Promise.resolve(JOB);
    });
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('This generation was cancelled.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/quiz/generations/gen1/cancel', { method: 'POST' });
  });

  it('surfaces a failed poll instead of spinning silently', async () => {
    apiFetch.mockRejectedValue(new Error('Generation not found'));

    renderPage();

    expect(await screen.findByText('Generation not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to generate a quiz/ })).toBeInTheDocument();
  });

  it('does not leave a poll scheduled after unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiFetch.mockResolvedValue(JOB);

    const { unmount } = renderPage();
    await screen.findByText('6 / 10');

    unmount();
    const callsAtUnmount = apiFetch.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5000));

    expect(apiFetch).toHaveBeenCalledTimes(callsAtUnmount);
  });
});
