import MathText from '../MathText.jsx';

export default function McqQuestion({ question, value, onChange }) {
  return (
    <div className="space-y-3">
      <MathText as="p" className="text-lg leading-relaxed text-slate-800" text={question.prompt} />
      <div className="space-y-2" role="radiogroup" aria-label={question.prompt}>
        {question.options.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-center gap-3 rounded border px-4 py-3 ${
              value === option ? 'border-slate-800 bg-slate-100' : 'border-slate-200'
            }`}
          >
            <input type="radio" name={question.id} checked={value === option} onChange={() => onChange(option)} className="h-4 w-4" />
            <MathText as="span" text={option} />
          </label>
        ))}
      </div>
    </div>
  );
}
