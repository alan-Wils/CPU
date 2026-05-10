"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const STRAIN_COLORS = ["#22c55e", "#38bdf8", "#a78bfa", "#f472b6", "#fbbf24", "#2dd4bf"];

const tooltipStyle = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
};

function moneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

export type YieldTrendsPayload = {
  strains: { key: string; label: string }[];
  rows: Record<string, string | number>[];
};

export function ProductionYieldChart(props: { data: YieldTrendsPayload | null | undefined }) {
  const strains = props.data?.strains ?? [];
  const rows = props.data?.rows ?? [];
  if (!strains.length || !rows.length) {
    return (
      <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13 }}>
        No completed harvest weight in this range (strain totals need dry flower grams on completed batches).
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}`} width={44} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} lbs`, "Cumulative"]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {strains.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={STRAIN_COLORS[i % STRAIN_COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SalesOverTimeChart(props: {
  rows: { date: string; leafLink: number; nexbatch: number; combined: number }[] | null | undefined;
}) {
  const rows = props.rows ?? [];
  if (!rows.length) {
    return (
      <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13 }}>
        No sales series for this range.
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="nbSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="llSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => moneyShort(Number(v))} width={52} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number, name: string) => [moneyShort(v), name === "combined" ? "Combined" : name === "leafLink" ? "LeafLink" : "NexBatch"]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="leafLink" stackId="1" stroke="#38bdf8" fill="url(#llSales)" name="LeafLink" />
          <Area type="monotone" dataKey="nexbatch" stackId="1" stroke="#22c55e" fill="url(#nbSales)" name="NexBatch" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LaborMixPie(props: {
  productiveHours: number;
  deadHours: number;
  breakHours: number;
}) {
  const data = [
    { name: "Productive", value: Math.max(0, props.productiveHours), color: "#22c55e" },
    { name: "Dead time (est.)", value: Math.max(0, props.deadHours), color: "#f97316" },
    { name: "Break", value: Math.max(0, props.breakHours), color: "#64748b" },
  ].filter((d) => d.value > 0);
  if (!data.length) {
    return <div style={{ color: "#64748b", fontSize: 13 }}>No labor hours in range.</div>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={2}>
            {data.map((e, i) => (
              <Cell key={e.name} fill={e.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v.toFixed(1)} h`, n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FacilitiesDowntimeChart(props: { rows: { label: string; minutes: number }[] | null | undefined }) {
  const rows = props.rows ?? [];
  if (!rows.length) return null;
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} />
          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} width={36} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} min`, "Task time"]} />
          <Bar dataKey="minutes" fill="#38bdf8" radius={[4, 4, 0, 0]} name="Minutes" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RevenueChannelDonut(props: { rows: { label: string; value: number }[] | null | undefined }) {
  const rows = (props.rows ?? []).filter((r) => (Number(r.value) || 0) > 0);
  const colors = ["#22c55e", "#38bdf8", "#a78bfa", "#fbbf24"];
  if (!rows.length) {
    return (
      <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13 }}>
        No channel revenue in range.
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={76} paddingAngle={2}>
            {rows.map((e, i) => (
              <Cell key={e.label} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [moneyShort(v), ""]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExecutiveRevenueBars(props: { rows: { name: string; revenue: number }[] | null | undefined }) {
  const rows = props.rows ?? [];
  if (!rows.length) return null;
  const data = rows.map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100 }));
  return (
    <div style={{ width: "100%", height: Math.max(160, data.length * 36) }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={data} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#1e293b" horizontal={false} strokeDasharray="3 3" />
          <XAxis type="number" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => moneyShort(Number(v))} />
          <YAxis type="category" dataKey="name" stroke="#64748b" tick={{ fontSize: 10 }} width={120} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [moneyShort(v), "Revenue"]} />
          <Bar dataKey="revenue" fill="#22c55e" radius={[0, 4, 4, 0]} name="Revenue" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
