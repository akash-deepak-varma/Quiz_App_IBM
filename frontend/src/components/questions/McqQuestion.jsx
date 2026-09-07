export default function McqQuestion({ question, value, onChange }) {
  return (
    <div className="space-y-3">
      <p className="text-lg text-slate-800">{question.prompt}</p>
      <div className="space-y-2">
        {question.options.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-center gap-3 rounded border px-4 py-3 ${
              value === option ? 'border-slate-800 bg-slate-100' : 'border-slate-200'
            }`}
          >
            <input type="radio" name={question.id} checked={value === option} onChange={() => onChange(option)} className="h-4 w-4" />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
