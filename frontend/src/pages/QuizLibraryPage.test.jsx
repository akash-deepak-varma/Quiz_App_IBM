import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import QuizLibraryPage from './QuizLibraryPage.jsx';
import { apiFetch } from '../api/client.js';

vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }));

const TOPICS = { topics: [{ id: 't1', name: 'JavaScript', quizCount: 2, tags: ['week-1', 'interview-prep'] }] };

const QUIZZES = {
  quizzes: [
    {
      quizId: 'q1',
      topic: 'JavaScript',
      difficulty: 'beginner',
      tags: ['week-1'],
      questionCount: 5,
      attemptCount: 0,
      bestScore: null,
      isFavorited: false,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <QuizLibraryPage />
    </MemoryRouter>
  );
}

describe('QuizLibraryPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('lists quizzes with their topic, tags, and attempt info', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/topics') return Promise.resolve(TOPICS);
      if (path.startsWith('/quiz/library')) return Promise.resolve(QUIZZES);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('button', { name: 'Favorite' })).toBeInTheDocument();
    // "JavaScript" also appears in the topic filter's <option> -- scope to the quiz card.
    expect(screen.getAllByText(/JavaScript/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/5 questions/)).toBeInTheDocument();
    // "week-1" also appears as a tag-filter <option> -- getAllByText confirms the tag chip too.
    expect(screen.getAllByText('week-1').length).toBeGreaterThanOrEqual(1);
  });

  it('toggles a quiz as favorited', async () => {
    apiFetch.mockImplementation((path, opts) => {
      if (path === '/topics') return Promise.resolve(TOPICS);
      if (path.startsWith('/quiz/library')) return Promise.resolve(QUIZZES);
      if (path === '/quiz/q1/favorite' && opts?.method === 'POST') return Promise.resolve({});
      return Promise.reject(new Error(`unexpected call ${path}`));
    });
    const user = userEvent.setup();

    renderPage();
    const favoriteButton = await screen.findByRole('button', { name: 'Favorite' });

    await user.click(favoriteButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Favorited' })).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/quiz/q1/favorite', { method: 'POST' });
  });

  it('re-fetches the library when a topic filter is chosen', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/topics') return Promise.resolve(TOPICS);
      if (path.startsWith('/quiz/library')) return Promise.resolve(QUIZZES);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole('button', { name: 'Favorite' });

    await user.selectOptions(screen.getByDisplayValue('All topics'), 'JavaScript');

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('topic=JavaScript'))
    );
  });

  it('shows an error banner when a favorite toggle fails', async () => {
    apiFetch.mockImplementation((path, opts) => {
      if (path === '/topics') return Promise.resolve(TOPICS);
      if (path.startsWith('/quiz/library')) return Promise.resolve(QUIZZES);
      if (path === '/quiz/q1/favorite' && opts?.method === 'POST') {
        return Promise.reject(new Error('Could not update favorite'));
      }
      return Promise.reject(new Error(`unexpected call ${path}`));
    });
    const user = userEvent.setup();

    renderPage();
    const favoriteButton = await screen.findByRole('button', { name: 'Favorite' });

    await user.click(favoriteButton);

    expect(await screen.findByText('Could not update favorite')).toBeInTheDocument();
  });
});
