import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function AccuracyTrendChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-slate-400">No quiz history yet.</p>;
  }

  const chartData = data.map((d) => ({ date: d.date, accuracy: Math.round(d.accuracy * 100) }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
        <Tooltip formatter={(value) => [`${value}%`, 'Accuracy']} />
        <Line type="monotone" dataKey="accuracy" stroke="#1e293b" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
