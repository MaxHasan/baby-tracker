import { useCallback, useEffect, useState } from 'react';
import {
  Bar, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { dailyRollup, localDateKey, type DayRow } from '../lib/rollup';
import type { Child, Diaper, Feed, Growth, Pump, Sleep } from '../lib/types';
import { COLORS, DIRECT_FEED_MEAN_KENT, DIRECT_ML_PER_FEED } from '../lib/types';

interface Data {
  rows: DayRow[];
  hasWeighIn: boolean;
  formulaPct24: number | null; // formula share of intake over the past 24h
  pumped24: number; // mL pumped over the rolling past 24h
}

export default function Dashboard({ child }: { child: Child }) {
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(async () => {
    const [feeds, pumps, diapers, sleeps, growth] = await Promise.all([
      supabase!.from('feeds').select('*').eq('child_id', child.id),
      supabase!.from('pumps').select('*').eq('child_id', child.id),
      supabase!.from('diapers').select('*').eq('child_id', child.id),
      supabase!.from('sleeps').select('*').eq('child_id', child.id),
      supabase!.from('growth').select('*').eq('child_id', child.id),
    ]);
    const diaperRows = (diapers.data ?? []) as Diaper[];
    const feedRows = (feeds.data ?? []) as Feed[];
    const pumpRows = (pumps.data ?? []) as Pump[];
    const since24 = Date.now() - 24 * 3600 * 1000;

    // Formula share of estimated intake over the rolling past 24 hours.
    const f24 = feedRows.filter((f) => +new Date(f.ts) >= since24);
    const ml = (pred: (f: Feed) => boolean) =>
      f24.filter(pred).reduce((a, f) => a + (f.volume_ml ?? 0), 0);
    const formula24 = ml((f) => f.delivery === 'bottle' && f.substance === 'formula');
    const ebm24 = ml((f) => f.delivery === 'bottle' && f.substance === 'breast_milk');
    const directEst24 = f24.filter((f) => f.delivery === 'breast').length * DIRECT_ML_PER_FEED;
    const total24 = formula24 + ebm24 + directEst24;

    setData({
      hasWeighIn: (growth.data ?? []).length > 0,
      formulaPct24: total24 ? Math.round((formula24 / total24) * 100) : null,
      pumped24: pumpRows
        .filter((p) => +new Date(p.ts) >= since24)
        .reduce((a, p) => a + p.total_ml, 0),
      rows: dailyRollup({
        feeds: feedRows,
        pumps: pumpRows,
        diapers: diaperRows,
        sleeps: (sleeps.data ?? []) as Sleep[],
        growth: (growth.data ?? []) as Growth[],
        birthWeightG: child.birth_weight_g,
        fromDate: child.dob,
        toDate: localDateKey(new Date().toISOString()),
      }),
    });
  }, [child]);

  useEffect(() => {
    void load();
    // realtime + refetch when the tab regains focus: keep KPIs (and their
    // rolling/day windows) current while the app stays open on a phone
    const ch = supabase!
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => void load())
      .subscribe();
    const onVis = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      void supabase!.removeChannel(ch);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  if (!data) return <p className="pt-8 text-center text-slate-400">Crunching…</p>;
  const { rows, hasWeighIn, formulaPct24, pumped24 } = data;
  const today = rows[rows.length - 1];
  // Intake & diapers are calendar-day figures against daily targets, so their
  // warnings are paced by how much of the local day has elapsed — a quiet
  // morning shouldn't light every card red.
  const dayFrac = (Date.now() - new Date().setHours(0, 0, 0, 0)) / 86400000;
  const chart = rows.slice(-30).map((r) => ({ ...r, day: r.date.slice(5).replace('-', '/') }));

  // Formula share: rolling 24h (headline), plus 7-day and all-time day-windows.
  const pct = (f: number, t: number) => (t ? Math.round((f / t) * 100) : null);
  const sum = (rs: DayRow[], k: keyof DayRow) => rs.reduce((a, r) => a + (r[k] as number), 0);
  const last7 = rows.slice(-7);
  const f7 = pct(sum(last7, 'formulaMl'), sum(last7, 'totalEstMl'));
  const fAll = pct(sum(rows, 'formulaMl'), sum(rows, 'totalEstMl'));

  const pumped7 = sum(last7, 'pumpedMl');
  // Total breast-milk supply = milk taken directly (modeled) + milk pumped.
  const supplyAll = sum(rows, 'directEstMl') + sum(rows, 'pumpedMl');

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Intake today (est)" value={`${today.totalEstMl} mL`}
          sub={today.targetMl && today.weightG
            ? `target ${today.targetMl} mL = ${(today.weightG / 1000).toFixed(2)} kg × 150${
                hasWeighIn ? '' : ' (birth wt — add a weigh-in)'}`
            : undefined}
          warn={!!today.targetMl && today.totalEstMl < today.targetMl * dayFrac * 0.8} />
        <Kpi label="Formula % (24h)"
          value={formulaPct24 === null ? '—' : `${formulaPct24}%`}
          sub={`7-day ${f7 ?? '—'}% · all-time ${fAll ?? '—'}%`} />
        <Kpi label="Diapers today" value={`${today.wet} 💧 / ${today.dirty} 💩`}
          sub="target ≥6 wet · ≥3 dirty / day"
          warn={today.wet < Math.floor(6 * dayFrac) || today.dirty < Math.floor(3 * dayFrac)} />
        <Kpi label="Pumped (last 24h)" value={`${pumped24} mL`}
          sub={`7-day ${pumped7} mL`} />
      </div>
      <p className="-mt-2 px-1 text-[11px] text-slate-400">
        Intake &amp; diapers count the calendar day (warnings scale with the time
        of day); formula % and pumped are rolling 24-hour windows. Diaper targets
        are the newborn adequacy guide, applicable after ~day 5.
      </p>

      <ChartCard title="Daily intake by source vs target"
        note={`Pink = modeled direct-breast estimate (${DIRECT_ML_PER_FEED} mL/feed, ±40%): direct intake can't be measured. Basis: Kent et al. 2006, mean ${DIRECT_FEED_MEAN_KENT} mL/feed.`}>
        <ComposedChart data={chart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <XAxis dataKey="day" fontSize={10} tickMargin={4} />
          <YAxis fontSize={10} />
          <Tooltip content={<TotalTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="directEstMl" name="Direct (est)" stackId="a" fill={COLORS.direct} />
          <Bar dataKey="ebmMl" name="EBM" stackId="a" fill={COLORS.ebm} />
          <Bar dataKey="formulaMl" name="Formula" stackId="a" fill={COLORS.formula} />
          <Line dataKey="targetMl" name="Target" stroke={COLORS.grey}
            strokeDasharray="6 4" dot={false} />
        </ComposedChart>
      </ChartCard>

      <ChartCard title="Breast-milk supply (direct + pumped)"
        note="Total milk produced per day: what the baby took directly at the breast (estimated) plus what you pumped, split L / R.">
        {supplyAll === 0 ? (
          <div className="flex h-[200px] items-center justify-center px-4 text-center text-xs text-slate-400">
            No direct feeds or pump sessions logged yet — log a breastfeed or a
            pump (🥛, with left &amp; right volumes) and this fills in.
          </div>
        ) : (
          <ComposedChart data={chart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <XAxis dataKey="day" fontSize={10} tickMargin={4} />
            <YAxis fontSize={10} />
            <Tooltip content={<TotalTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="directEstMl" name="Direct (est)" stackId="s" fill={COLORS.direct} />
            <Bar dataKey="pumpedLeftMl" name="Pump L" stackId="s" fill={COLORS.left} />
            <Bar dataKey="pumpedRightMl" name="Pump R" stackId="s" fill={COLORS.right} />
          </ComposedChart>
        )}
      </ChartCard>
    </div>
  );
}

/** Chart tooltip with a bold Total of the stacked bars, so the day is easy to
 * compare against the italicized Target line (absent on the supply chart). */
function TotalTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string;
    dataKey?: string | number }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const series = payload.filter((p) => p.dataKey !== 'targetMl');
  const target = payload.find((p) => p.dataKey === 'targetMl');
  const total = series.reduce((a, p) => a + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-2.5 text-xs shadow-md">
      <div className="mb-1 font-semibold text-slate-500">{label}</div>
      {series.map((p) => (
        <div key={String(p.dataKey)} style={{ color: p.color }}>
          {p.name} : {p.value}
        </div>
      ))}
      <div className="mt-1 font-bold text-slate-700 underline underline-offset-2">
        Total : {total}
      </div>
      {target && (
        <div className="italic text-slate-500">{target.name} : {target.value}</div>
      )}
    </div>
  );
}

function ChartCard({ title, note, children }: {
  title: string; note: string; children: React.ReactElement;
}) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <h2 className="mb-1 px-1 text-sm font-bold text-slate-600">{title}</h2>
      <p className="mb-2 px-1 text-xs text-slate-400">{note}</p>
      <ResponsiveContainer width="100%" height={260}>{children}</ResponsiveContainer>
    </section>
  );
}

function Kpi({ label, value, sub, warn }: {
  label: string; value: string; sub?: string; warn?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${
      warn ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'
    }`}>
      <div className="text-xs font-semibold text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-700">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
