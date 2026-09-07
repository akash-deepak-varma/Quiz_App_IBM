import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function TopicAccuracyChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-slate-400">No topic data yet.</p>;
  }

  const chartData = data.map((d) => ({ topic: d.topic, accuracy: Math.round(d.accuracy * 100) }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="topic" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
        <Tooltip formatter={(value) => [`${value}%`, 'Accuracy']} />
        <Bar dataKey="accuracy" fill="#1e293b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
