import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressBar from './ProgressBar.jsx';

describe('ProgressBar', () => {
  it('renders the 1-based question number and computed percentage', () => {
    render(<ProgressBar current={1} total={4} />);
    expect(screen.getByText('Question 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders 100% on the last question', () => {
    render(<ProgressBar current={3} total={4} />);
    expect(screen.getByText('Question 4 of 4')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders 0% when total is 0', () => {
    render(<ProgressBar current={0} total={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
