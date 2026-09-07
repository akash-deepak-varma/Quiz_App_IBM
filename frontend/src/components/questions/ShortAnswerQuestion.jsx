export default function ShortAnswerQuestion({ question, value, onChange }) {
  return (
    <div className="space-y-3">
      <p className="text-lg text-slate-800">{question.prompt}</p>
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder="Type your answer..."
        className="w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}
