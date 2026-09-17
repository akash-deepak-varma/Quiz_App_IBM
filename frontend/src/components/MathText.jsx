import { Fragment, useMemo } from 'react';
import katex from 'katex';

// Splits on $$...$$ (display math) before $...$ (inline math) so a display block isn't
// mistaken for two inline delimiters. Inline math may not span newlines -- a lone "$" in
// prose (e.g. a price) is common and shouldn't accidentally swallow the rest of a line.
const MATH_SEGMENT_REGEX = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

function splitMath(text) {
  const segments = [];
  let lastIndex = 0;
  let match;

  MATH_SEGMENT_REGEX.lastIndex = 0;
  while ((match = MATH_SEGMENT_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const isDisplay = match[1] !== undefined;
    segments.push({ type: 'math', value: isDisplay ? match[1] : match[2], displayMode: isDisplay, raw: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

// Renders a string that may contain LaTeX math ($...$ inline, $$...$$ display) written by an
// AI provider (see promptUtils.js's math-formatting rule). Plain strings with no "$" pass
// through unchanged. KaTeX's default trust:false is kept -- untrusted AI-generated LaTeX
// should not be able to execute \href/\includegraphics-style commands.
export default function MathText({ text, as: Component = 'span', className }) {
  const segments = useMemo(() => splitMath(text ?? ''), [text]);

  return (
    <Component className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <Fragment key={index}>{segment.value}</Fragment>;
        }
        try {
          const html = katex.renderToString(segment.value, {
            throwOnError: false,
            displayMode: segment.displayMode,
          });
          // eslint-disable-next-line react/no-danger
          return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch {
          return <Fragment key={index}>{segment.raw}</Fragment>;
        }
      })}
    </Component>
  );
}
