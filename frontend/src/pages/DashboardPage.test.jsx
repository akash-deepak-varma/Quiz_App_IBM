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

  it('renders hardest questions and the review queue, one tab at a time', async () => {
    mockDashboardFetches();
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByText(/What is a closure\?/)).toBeInTheDocument();
    expect(screen.queryByText(/What is hoisting\?/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retake this quiz' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Due for review/ }));

    expect(await screen.findByText(/What is hoisting\?/)).toBeInTheDocument();
    expect(screen.queryByText(/What is a closure\?/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retake this quiz' })).toHaveLength(1);
  });

  it('paginates through more than a page of results instead of showing them all at once', async () => {
    const manyReview = {
      questions: Array.from({ length: 12 }, (_, i) => ({
        questionId: `r${i + 1}`,
        prompt: `Question number ${i + 1}`,
        topic: 'JavaScript',
        quizId: `quiz${i + 1}`,
      })),
    };
    mockDashboardFetches({ review: manyReview });
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole('button', { name: /Due for review/ }));

    expect(await screen.findByText('Question number 1')).toBeInTheDocument();
    expect(screen.queryByText('Question number 11')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Question number 11')).toBeInTheDocument();
    expect(screen.queryByText('Question number 1')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows placeholder copy when there is nothing to review', async () => {
    mockDashboardFetches({ hardest: { questions: [] }, review: { questions: [] } });
    const user = userEvent.setup();

    renderPage();

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/analytics/review-queue'));
    expect(screen.getByText('Nothing here right now.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Due for review/ }));

    expect(await screen.findByText('Nothing here right now.')).toBeInTheDocument();
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
