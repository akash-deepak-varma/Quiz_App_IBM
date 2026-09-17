import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import MathText from './MathText.jsx';

describe('MathText', () => {
  it('renders a plain string unchanged', () => {
    const { container } = render(<MathText text="Just plain text, no math here." />);
    expect(container.textContent).toBe('Just plain text, no math here.');
    expect(container.querySelector('.katex')).toBeNull();
  });

  it('renders an inline $...$ segment as KaTeX output', () => {
    const { container } = render(<MathText text="Solve $x^2 + 1 = 0$ for x." />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).toContain('Solve');
    expect(container.textContent).toContain('for x.');
  });

  it('renders a display $$...$$ segment as KaTeX output', () => {
    const { container } = render(<MathText text="$$E = mc^2$$" />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does not choke on an unmatched dollar sign', () => {
    const { container } = render(<MathText text="This costs $5 total." />);
    expect(container.textContent).toBe('This costs $5 total.');
  });
});
