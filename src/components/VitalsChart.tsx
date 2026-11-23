import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HealthReading } from '../types';

interface VitalsChartProps {
  readings: HealthReading[];
  title?: string;
}

export function VitalsChart({ readings, title = 'Health Readings Trend' }: VitalsChartProps) {
  const metrics = useMemo(() => {
    const set = new Set<string>();
    for (const r of readings) {
      if (r.numeric_primary !== null) set.add(r.metric);
    }
    return Array.from(set);
  }, [readings]);

  const [selectedMetric, setSelectedMetric] = useState<string>('');
  const activeMetric = selectedMetric && metrics.includes(selectedMetric) ? selectedMetric : metrics[0] || '';

  const chartData = useMemo(() => {
    if (!activeMetric) return [];
    return readings
      .filter((r) => r.metric === activeMetric && r.numeric_primary !== null)
      .slice(-14)
      .map((r) => ({
        date: new Date(r.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        primary: r.numeric_primary,
        secondary: r.numeric_secondary,
        raw: `${r.value} ${r.unit}`.trim(),
        recordedBy: r.recorded_by_name,
      }));
  }, [readings, activeMetric]);

  const hasSecondary = chartData.some((d) => d.secondary !== null && d.secondary !== undefined);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Live database readings recorded by nurses, patients, and doctors
          </p>
        </div>
        {metrics.length > 0 && (
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {metrics.map((metric) => (
              <button
                key={metric}
                type="button"
                onClick={() => setSelectedMetric(metric)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeMetric === metric
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {metric}
              </button>
            ))}
          </div>
        )}
      </div>

      {chartData.length === 0 ? (
        <div className="h-56 flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-lg bg-slate-50/60 text-center px-4">
          <p className="text-sm font-medium text-slate-700">No numeric readings recorded yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            Once a nurse or patient logs a measurement (e.g. Blood Pressure or Blood Sugar), the trend chart renders here from database records.
          </p>
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Line
                type="monotone"
                dataKey="primary"
                name={hasSecondary ? 'Systolic' : activeMetric}
                stroke="#0f766e"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: '#0f766e' }}
                activeDot={{ r: 5 }}
              />
              {hasSecondary && (
                <Line
                  type="monotone"
                  dataKey="secondary"
                  name="Diastolic"
                  stroke="#0284c7"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#0284c7' }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
