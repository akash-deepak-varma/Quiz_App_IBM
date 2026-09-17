import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage.jsx';
import { apiFetch } from '../api/client.js';

vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }));

// AccuracyTrendChart/TopicAccuracyChart pull in a real chart lib that has no jsdom canvas
// support -- swap in a plain stand-in so DashboardPage can render in tests.
vi.mock('../components/charts/AccuracyTrendChart.jsx', () => ({ default: () => <div /> }));
vi.mock('../components/charts/TopicAccuracyChart.jsx', () => ({ default: () => <div /> }));

const SUMMARY = {
  quizzesTaken: 3,
  overallAccuracy: 0.75,
  totalTimeSpentSeconds: 90,
  streak: { current: 1, longest: 2 },
  accuracyTrend: [],
  byTopic: [],
  weakestTopics: [],
};

const HISTORY = { attempts: [] };

const HARDEST = {
  questions: [{ questionId: 'h1', prompt: 'What is a closure?', topic: 'JavaScript', quizId: 'quiz1' }],
};

const REVIEW = {
  questions: [{ questionId: 'r1', prompt: 'What is hoisting?', topic: 'JavaScript', quizId: 'quiz2' }],
};

function mockDashboardFetches({ hardest = HARDEST, review = REVIEW } = {}) {
  apiFetch.mockImplementation((path) => {
    if (path === '/dashboard/summary') return Promise.resolve(SUMMARY);
    if (path === '/dashboard/history') return Promise.resolve(HISTORY);
    if (path === '/analytics/hardest-questions') return Promise.resolve(hardest);
    if (path === '/analytics/review-queue') return Promise.resolve(review);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage analytics sections', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('renders hardest questions and the review queue', async () => {
    mockDashboardFetches();

    renderPage();

    expect(await screen.findByText(/What is a closure\?/)).toBeInTheDocument();
    expect(screen.getByText(/What is hoisting\?/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retake this quiz' })).toHaveLength(2);
  });

  it('shows placeholder copy when there is nothing to review', async () => {
    mockDashboardFetches({ hardest: { questions: [] }, review: { questions: [] } });

    renderPage();

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/analytics/review-queue'));
    expect(screen.getAllByText('Nothing here right now.')).toHaveLength(2);
  });

  it('navigates to the runner with the refetched quiz when retaking a hard question', async () => {
    mockDashboardFetches();
    apiFetch.mockImplementation((path) => {
      if (path === '/dashboard/summary') return Promise.resolve(SUMMARY);
      if (path === '/dashboard/history') return Promise.resolve(HISTORY);
      if (path === '/analytics/hardest-questions') return Promise.resolve(HARDEST);
      if (path === '/analytics/review-queue') return Promise.resolve(REVIEW);
      if (path === '/quiz/quiz1') return Promise.resolve({ quizId: 'quiz1', questions: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText(/What is a closure\?/);

    await user.click(screen.getAllByRole('button', { name: 'Retake this quiz' })[0]);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/quiz/quiz1'));
  });

  it('shows an error banner when a retake fails', async () => {
    mockDashboardFetches();
    apiFetch.mockImplementation((path) => {
      if (path === '/dashboard/summary') return Promise.resolve(SUMMARY);
      if (path === '/dashboard/history') return Promise.resolve(HISTORY);
      if (path === '/analytics/hardest-questions') return Promise.resolve(HARDEST);
      if (path === '/analytics/review-queue') return Promise.resolve(REVIEW);
      if (path === '/quiz/quiz1') return Promise.reject(new Error('Quiz not found'));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText(/What is a closure\?/);

    await user.click(screen.getAllByRole('button', { name: 'Retake this quiz' })[0]);

    expect(await screen.findByText('Quiz not found')).toBeInTheDocument();
  });
});
