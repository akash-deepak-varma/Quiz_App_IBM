import { Fragment, useMemo } from 'react';
import katex from 'katex';

// Single left-to-right scan for every special segment type, in one regex, so delimiters of
// one kind can't be misread inside another (e.g. a "$" inside a fenced code block is just a
// character, not the start of math). Order inside the alternation is precedence, highest
// first: fenced code, inline code, display math, inline math. Inline math may not span
// newlines -- a lone "$" in prose (e.g. a price) is common and shouldn't swallow a whole line.
const SEGMENT_REGEX =
  /```(\w+)?\n?([\s\S]*?)```|`([^`\n]+?)`|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

function splitSegments(text) {
  const segments = [];
  let lastIndex = 0;
  let match;

  SEGMENT_REGEX.lastIndex = 0;
  while ((match = SEGMENT_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const [, codeBlockLang, codeBlockValue, inlineCode, displayMath, inlineMath] = match;
    if (codeBlockValue !== undefined) {
      segments.push({ type: 'code-block', value: codeBlockValue.replace(/\n$/, ''), lang: codeBlockLang });
    } else if (inlineCode !== undefined) {
      segments.push({ type: 'code-inline', value: inlineCode });
    } else {
      const isDisplay = displayMath !== undefined;
      segments.push({
        type: 'math',
        value: isDisplay ? displayMath : inlineMath,
        displayMode: isDisplay,
        raw: match[0],
      });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

// Renders a string that may contain LaTeX math ($...$ inline, $$...$$ display), inline code
// (`code`), and fenced code blocks (```lang\ncode```) written by an AI provider (see
// promptUtils.js's math/code formatting rules). Plain strings with none of these pass through
// unchanged, newlines preserved. KaTeX's default trust:false is kept -- untrusted AI-generated
// LaTeX should not be able to execute \href/\includegraphics-style commands.
export default function MathText({ text, as: Component = 'span', className }) {
  const segments = useMemo(() => splitSegments(text ?? ''), [text]);

  return (
    <Component className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <span key={index} style={{ whiteSpace: 'pre-wrap' }}>
              {segment.value}
            </span>
          );
        }
        if (segment.type === 'code-inline') {
          return (
            <code key={index} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">
              {segment.value}
            </code>
          );
        }
        if (segment.type === 'code-block') {
          return (
            <span key={index} className="block">
              {segment.lang && (
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  {segment.lang}
                </span>
              )}
              <pre className="my-1 overflow-x-auto rounded bg-slate-100 p-2 font-mono text-sm">
                {segment.value}
              </pre>
            </span>
          );
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
