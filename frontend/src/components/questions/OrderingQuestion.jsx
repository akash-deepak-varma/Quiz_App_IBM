import { useState, useEffect } from 'react';
import MathText from '../MathText.jsx';

// Seed the answer with the initial (shuffled) display order on mount, since the learner
// sees a concrete order on screen even before touching anything -- if they click through
// without reordering, submitting "no answer" would be misleading; submitting the order
// they were shown is the honest default.
export default function OrderingQuestion({ question, value, onChange }) {
  const [order, setOrder] = useState(value || question.options);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!value) {
      onChange(question.options);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const movedItem = next[index];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    onChange(next);
    setAnnouncement(`${movedItem} moved to position ${target + 1} of ${next.length}`);
  };

  return (
    <div className="space-y-3">
      <MathText as="p" className="text-lg text-slate-800" text={question.prompt} />
      <p className="text-sm text-slate-500">Arrange these in the correct order.</p>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <ol className="space-y-2">
        {order.map((item, index) => (
          <li key={item} className="flex items-center gap-3 rounded border border-slate-200 bg-white px-4 py-3">
            <span className="w-6 text-sm font-semibold text-slate-400">{index + 1}.</span>
            <MathText as="span" className="flex-1" text={item} />
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-30"
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === order.length - 1}
              className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-30"
              aria-label="Move down"
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
