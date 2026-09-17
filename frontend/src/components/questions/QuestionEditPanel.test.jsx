import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestionEditPanel from './QuestionEditPanel.jsx';
import { apiFetch } from '../../api/client.js';

vi.mock('../../api/client.js', () => ({ apiFetch: vi.fn() }));

const LOADED_QUESTION = {
  id: 'ques1',
  type: 'mcq',
  prompt: 'What is 2 + 2?',
  options: ['3', '4', '5'],
  starterCode: null,
  correctAnswer: '4',
  explanation: 'Basic addition.',
};

describe('QuestionEditPanel', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('loads the question and pre-fills the form', async () => {
    apiFetch.mockResolvedValueOnce(LOADED_QUESTION);

    render(<QuestionEditPanel quizId="quiz1" questionId="ques1" onSaved={() => {}} onCancel={() => {}} />);

    expect(await screen.findByDisplayValue('What is 2 + 2?')).toBeInTheDocument();
    // getByDisplayValue's default normalizer collapses newlines -- disable it so the
    // multiline options textarea can be matched exactly.
    expect(screen.getByDisplayValue('3\n4\n5', { normalizer: (s) => s })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/quiz/quiz1/questions/ques1');
  });

  it('saves edits and reports display fields back to the caller', async () => {
    apiFetch.mockResolvedValueOnce(LOADED_QUESTION);
    const updated = { ...LOADED_QUESTION, prompt: 'What is 2 + 3?' };
    apiFetch.mockResolvedValueOnce(updated);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<QuestionEditPanel quizId="quiz1" questionId="ques1" onSaved={onSaved} onCancel={() => {}} />);
    await screen.findByDisplayValue('What is 2 + 2?');

    const promptField = screen.getByDisplayValue('What is 2 + 2?');
    await user.clear(promptField);
    await user.type(promptField, 'What is 2 + 3?');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/quiz/quiz1/questions/ques1', expect.objectContaining({ method: 'PATCH' }))
    );
    expect(onSaved).toHaveBeenCalledWith({
      id: 'ques1',
      type: 'mcq',
      prompt: 'What is 2 + 3?',
      options: updated.options,
      starterCode: updated.starterCode,
    });
  });

  it('regenerates the question via the AI endpoint', async () => {
    apiFetch.mockResolvedValueOnce(LOADED_QUESTION);
    const regenerated = { ...LOADED_QUESTION, prompt: 'What is 3 + 3?' };
    apiFetch.mockResolvedValueOnce(regenerated);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<QuestionEditPanel quizId="quiz1" questionId="ques1" onSaved={onSaved} onCancel={() => {}} />);
    await screen.findByDisplayValue('What is 2 + 2?');

    await user.click(screen.getByRole('button', { name: 'Regenerate with AI' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/quiz/quiz1/questions/ques1/regenerate', { method: 'POST' })
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ques1', prompt: 'What is 3 + 3?' })
    );
  });

  it('shows a conflict error and does not call onSaved when the quiz already has attempts', async () => {
    apiFetch.mockResolvedValueOnce(LOADED_QUESTION);
    apiFetch.mockRejectedValueOnce(new Error('This quiz already has attempts -- its questions can no longer be edited'));
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<QuestionEditPanel quizId="quiz1" questionId="ques1" onSaved={onSaved} onCancel={() => {}} />);
    await screen.findByDisplayValue('What is 2 + 2?');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/already has attempts/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    apiFetch.mockResolvedValueOnce(LOADED_QUESTION);
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(<QuestionEditPanel quizId="quiz1" questionId="ques1" onSaved={() => {}} onCancel={onCancel} />);
    await screen.findByDisplayValue('What is 2 + 2?');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
  });
});
