export default function TrueFalseQuestion({ question, value, onChange }) {
  const options = question.options || ['true', 'false'];

  return (
    <div className="space-y-3">
      <p className="text-lg text-slate-800">{question.prompt}</p>
      <div className="flex gap-3">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`flex-1 rounded border px-4 py-3 capitalize ${
              value === option ? 'border-slate-800 bg-slate-100' : 'border-slate-200'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
