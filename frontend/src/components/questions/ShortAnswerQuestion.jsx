import MathText from '../MathText.jsx';

export default function ShortAnswerQuestion({ question, value, onChange }) {
  return (
    <div className="space-y-3">
      <MathText as="p" className="text-lg leading-relaxed text-slate-800" text={question.prompt} />
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder="Type your answer..."
        aria-label={question.prompt}
        className="w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
    </div>
  );
}
