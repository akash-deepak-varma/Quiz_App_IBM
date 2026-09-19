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

  it('renders a fenced code block inside a <pre>, with no KaTeX applied', () => {
    const { container } = render(<MathText text={'```\nconst x = 1;\n```'} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.textContent).toBe('const x = 1;');
    expect(container.querySelector('.katex')).toBeNull();
  });

  it('shows the fence language as a label when present', () => {
    const { container } = render(<MathText text={'```python\nprint(1)\n```'} />);
    expect(container.textContent).toContain('python');
    expect(container.querySelector('pre').textContent).toBe('print(1)');
  });

  it('renders inline code inside a <code> element', () => {
    const { container } = render(<MathText text="Call `foo()` to start." />);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code.textContent).toBe('foo()');
  });

  it('does not treat a $ inside a fenced code block as math', () => {
    const { container } = render(<MathText text={'```\nconst price = "$5";\n```'} />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('pre').textContent).toBe('const price = "$5";');
  });

  it('preserves newlines in plain text so multi-paragraph text does not collapse', () => {
    const { container } = render(<MathText text={'Line one.\n\nLine two.'} />);
    expect(container.textContent).toBe('Line one.\n\nLine two.');
    expect(container.querySelector('span[style]').style.whiteSpace).toBe('pre-wrap');
  });
});
