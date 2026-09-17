import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuestionRenderer from './QuestionRenderer.jsx';

// jsdom lacks the layout/measurement APIs CodeMirror needs -- stand in with a plain textarea
// so CodeQuestion can be exercised without a real editor instance.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }) => (
    <textarea data-testid="codemirror-mock" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe('QuestionRenderer', () => {
  it('dispatches mcq to radio options', () => {
    const question = { id: 'q1', type: 'mcq', prompt: 'Pick one', options: ['A', 'B'] };
    render(<QuestionRenderer question={question} value={null} onChange={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('dispatches true_false to true/false buttons', () => {
    const question = { id: 'q2', type: 'true_false', prompt: 'Is this true?', options: ['true', 'false'] };
    render(<QuestionRenderer question={question} value={null} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'true' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'false' })).toBeInTheDocument();
  });

  it('dispatches ordering to the reorder buttons', () => {
    const question = { id: 'q3', type: 'ordering', prompt: 'Order these', options: ['Step A', 'Step B'] };
    render(<QuestionRenderer question={question} value={null} onChange={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Move up' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Move down' })).toHaveLength(2);
  });

  it('dispatches code_completion to the (mocked) code editor', () => {
    const question = { id: 'q4', type: 'code_completion', prompt: 'Fix it', starterCode: 'function f() {}' };
    render(<QuestionRenderer question={question} value={null} onChange={() => {}} />);
    expect(screen.getByTestId('codemirror-mock')).toBeInTheDocument();
  });

  it('shows a fallback message for an unknown question type', () => {
    const question = { id: 'q5', type: 'not-a-real-type', prompt: 'Huh' };
    render(<QuestionRenderer question={question} value={null} onChange={() => {}} />);
    expect(screen.getByText('Unsupported question type: not-a-real-type')).toBeInTheDocument();
  });
});
