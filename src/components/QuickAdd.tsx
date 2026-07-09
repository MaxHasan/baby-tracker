import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BreastSide, FeedSubstance } from '../lib/types';
import NotebookImport from './NotebookImport';

/** 3am-friendly logging: the common actions are ≤2 taps; every module can
 * also log retroactively via the "earlier" time picker. */
export default function QuickAdd({ childId }: { childId: string }) {
  const [toast, setToast] = useState('');

  async function insert(table: string, row: Record<string, unknown>, label: string) {
    const { error } = await supabase!.from(table).insert({ child_id: childId, ...row });
    setToast(error ? `⚠ ${error.message}` : `✓ ${label}`);
    setTimeout(() => setToast(''), 2500);
  }

  return (
    <div className="space-y-5 pt-2">
      {toast && (
        <div className="fixed left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
      <Bottle insert={insert} />
      <Direct insert={insert} />
      <PumpForm insert={insert} />
      <DiaperForm insert={insert} />
      <SleepForm insert={insert} />
      <GrowthForm insert={insert} />
      <NotebookImport childId={childId} />
      <p className="pb-2 text-center text-xs text-slate-400">
        Direct-breast volume is estimated later from minutes — log time, not mL.
      </p>
    </div>
  );
}

type Insert = (table: string, row: Record<string, unknown>, label: string) => void;

export function Card({ title, color, children }: {
  title: string; color: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold" style={{ color }}>{title}</h2>
      {children}
    </section>
  );
}

export function Chip({ active, onClick, children, color = '#C75B7A' }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border px-4 py-2.5 text-sm font-semibold"
      style={
        active
          ? { background: color, borderColor: color, color: '#fff' }
          : { borderColor: '#e2e8f0', color: '#475569' }
      }
    >
      {children}
    </button>
  );
}

const nowLocal = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** "Now" vs an explicit local datetime — value null means "now". */
function WhenPicker({ value, onChange, label = 'When:' }: {
  value: string | null; onChange: (v: string | null) => void; label?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>{label}</span>
      <button
        onClick={() => onChange(null)}
        className={`rounded-lg border px-2.5 py-1.5 font-semibold ${
          value === null ? 'border-slate-600 bg-slate-600 text-white' : 'border-slate-200'
        }`}
      >
        Now
      </button>
      <button
        onClick={() => value === null && onChange(nowLocal())}
        className={`rounded-lg border px-2.5 py-1.5 font-semibold ${
          value !== null ? 'border-slate-600 bg-slate-600 text-white' : 'border-slate-200'
        }`}
      >
        Earlier…
      </button>
      {value !== null && (
        <input
          type="datetime-local" value={value} max={nowLocal()}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-slate-200 p-1.5"
        />
      )}
    </div>
  );
}

/** Event timestamp: the picked time, or now minus an optional offset. */
function tsFrom(when: string | null, offsetMs = 0): string {
  return when ? new Date(when).toISOString() : new Date(Date.now() - offsetMs).toISOString();
}

function Bottle({ insert }: { insert: Insert }) {
  const [substance, setSubstance] = useState<FeedSubstance>('breast_milk');
  const [when, setWhen] = useState<string | null>(null);
  const color = substance === 'formula' ? '#E8973A' : '#2E86AB';
  const log = (ml: number) =>
    insert('feeds', {
      ts: tsFrom(when), delivery: 'bottle', substance, volume_ml: ml,
    }, `bottle ${ml} mL${when ? ' (backdated)' : ''}`);
  return (
    <Card title="🍼 Bottle" color={color}>
      <div className="mb-3 flex gap-2">
        <Chip color="#2E86AB" active={substance === 'breast_milk'}
          onClick={() => setSubstance('breast_milk')}>Breast milk</Chip>
        <Chip color="#E8973A" active={substance === 'formula'}
          onClick={() => setSubstance('formula')}>Formula</Chip>
      </div>
      <WhenPicker value={when} onChange={setWhen} />
      <div className="flex flex-wrap gap-2">
        {[30, 40, 50, 60, 80].map((ml) => (
          <Chip key={ml} color={color} onClick={() => log(ml)}>{ml} mL</Chip>
        ))}
        <CustomNumber unit="mL" onSubmit={log} />
      </div>
    </Card>
  );
}

// ---- nursing timer (per-side, pause, switch) ------------
interface NurseSeg { side: 'L' | 'R'; start: number; end: number | null }
const NURSE_KEY = 'babytracker.nurse.timer';

function loadNurseSegs(): NurseSeg[] {
  try {
    return JSON.parse(localStorage.getItem(NURSE_KEY) ?? '[]') as NurseSeg[];
  } catch {
    return [];
  }
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Direct({ insert }: { insert: Insert }) {
  const [segs, setSegs] = useState<NurseSeg[]>(loadNurseSegs);
  const [, setTick] = useState(0);
  const running = segs.find((s) => s.end === null);

  // survive tab switches / phone lock / accidental reloads (per device)
  useEffect(() => {
    localStorage.setItem(NURSE_KEY, JSON.stringify(segs));
  }, [segs]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = (side: 'L' | 'R') =>
    segs.filter((s) => s.side === side)
      .reduce((ms, s) => ms + (s.end ?? Date.now()) - s.start, 0);
  const total = elapsed('L') + elapsed('R');

  function tap(side: 'L' | 'R') {
    setSegs((prev) => {
      const open = prev.find((s) => s.end === null);
      const closed = prev.map((s) => (s.end === null ? { ...s, end: Date.now() } : s));
      return open?.side === side
        ? closed // tapped the running side → pause
        : [...closed, { side, start: Date.now(), end: null }]; // start / switch
    });
  }

  function saveTimer() {
    if (total < 1000 || segs.length === 0) return;
    const min = Math.max(1, Math.round(total / 60000));
    const l = elapsed('L') > 0;
    const r = elapsed('R') > 0;
    insert('feeds', {
      ts: new Date(Math.min(...segs.map((s) => s.start))).toISOString(),
      delivery: 'breast', substance: 'breast_milk', duration_min: min,
      side: l && r ? 'both' : l ? 'L' : 'R',
    }, `${min} min at breast`);
    setSegs([]);
  }

  const sideBtn = (side: 'L' | 'R', label: string) => {
    const active = running?.side === side;
    return (
      <button
        onClick={() => tap(side)}
        className="flex-1 rounded-2xl border p-4 text-center"
        style={active
          ? { background: '#C75B7A', borderColor: '#C75B7A', color: '#fff' }
          : { borderColor: '#e2e8f0', color: '#475569' }}
      >
        <span className="block text-sm font-bold">{active ? `⏸ ${label}` : `▶ ${label}`}</span>
        <span className="block text-xl font-bold tabular-nums">{mmss(elapsed(side))}</span>
      </button>
    );
  };

  return (
    <Card title="🤱 Direct breastfeed" color="#C75B7A">
      <div className="flex gap-2">
        {sideBtn('L', 'Left')}
        {sideBtn('R', 'Right')}
      </div>
      {segs.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-600">
            {running ? '● nursing' : '⏸ paused'} · {mmss(total)}
          </span>
          <Chip onClick={saveTimer}>Save feed</Chip>
          <button className="text-sm text-slate-400 underline"
            onClick={() => confirm('Discard this timer?') && setSegs([])}>
            discard
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Tap a side to start; tap the other side to switch; tap again to pause.
        The timer survives switching apps.
      </p>
      <RetroDirect insert={insert} />
    </Card>
  );
}

/** Collapsible manual entry for past direct feeds (the pre-timer flow). */
function RetroDirect({ insert }: { insert: Insert }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<BreastSide>('both');
  const [when, setWhen] = useState<string | null>(null);
  const log = (min: number) =>
    insert('feeds', {
      // picked time = feed START; "now" mode backdates by the duration
      ts: tsFrom(when, min * 60000),
      delivery: 'breast', substance: 'breast_milk', duration_min: min, side,
    }, `${min} min at breast${when ? ' (backdated)' : ''}`);
  if (!open) {
    return (
      <button className="mt-2 text-xs text-slate-400 underline" onClick={() => setOpen(true)}>
        or log a past feed without the timer
      </button>
    );
  }
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-3 flex gap-2">
        {(['L', 'both', 'R'] as BreastSide[]).map((s) => (
          <Chip key={s} active={side === s} onClick={() => setSide(s)}>
            {s === 'both' ? 'Both' : s}
          </Chip>
        ))}
      </div>
      <WhenPicker value={when} onChange={setWhen} label="Started:" />
      <div className="flex flex-wrap gap-2">
        {[10, 15, 20, 30, 45].map((min) => (
          <Chip key={min} onClick={() => log(min)}>{min} min</Chip>
        ))}
        <CustomNumber unit="min" onSubmit={log} />
      </div>
    </div>
  );
}

function PumpForm({ insert }: { insert: Insert }) {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [when, setWhen] = useState<string | null>(null);
  const total = (Number(left) || 0) + (Number(right) || 0);
  return (
    <Card title="🥛 Pump" color="#2E86AB">
      <WhenPicker value={when} onChange={setWhen} />
      <div className="flex items-center gap-2">
        <input inputMode="numeric" placeholder="L mL" value={left}
          onChange={(e) => setLeft(e.target.value)}
          className="w-20 rounded-xl border border-slate-200 p-2.5 text-center" />
        <input inputMode="numeric" placeholder="R mL" value={right}
          onChange={(e) => setRight(e.target.value)}
          className="w-20 rounded-xl border border-slate-200 p-2.5 text-center" />
        <Chip color="#2E86AB" onClick={() => {
          if (!total) return;
          insert('pumps', {
            ts: tsFrom(when),
            left_ml: Number(left) || null, right_ml: Number(right) || null, total_ml: total,
          }, `pumped ${total} mL${when ? ' (backdated)' : ''}`);
          setLeft(''); setRight('');
        }}>Save {total > 0 ? `${total} mL` : ''}</Chip>
      </div>
    </Card>
  );
}

function DiaperForm({ insert }: { insert: Insert }) {
  const [when, setWhen] = useState<string | null>(null);
  const log = (wet: boolean, dirty: boolean, label: string) =>
    insert('diapers', { ts: tsFrom(when), wet, dirty },
      `${label}${when ? ' (backdated)' : ''}`);
  return (
    <Card title="💩 Diaper" color="#8B6F47">
      <WhenPicker value={when} onChange={setWhen} />
      <div className="flex flex-wrap gap-2">
        <Chip color="#4C9BD4" onClick={() => log(true, false, 'wet diaper')}>Wet</Chip>
        <Chip color="#8B6F47" onClick={() => log(false, true, 'dirty diaper')}>Dirty</Chip>
        <Chip color="#6B5E3C" onClick={() => log(true, true, 'wet + dirty')}>Both</Chip>
      </div>
    </Card>
  );
}

function SleepForm({ insert }: { insert: Insert }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  return (
    <Card title="😴 Sleep" color="#7A6FB3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Chip color="#7A6FB3" onClick={() =>
          insert('sleeps', { start_ts: new Date().toISOString(), end_ts: null }, 'sleep started')
        }>Falling asleep now</Chip>
        <span className="text-slate-400">or</span>
        <input type="datetime-local" value={start} max={nowLocal()}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-xl border border-slate-200 p-2" />
        <span className="text-slate-400">→</span>
        <input type="datetime-local" value={end} max={nowLocal()}
          onChange={(e) => setEnd(e.target.value)}
          className="rounded-xl border border-slate-200 p-2" />
        <Chip color="#7A6FB3" onClick={() => {
          if (!start || !end) return;
          insert('sleeps', {
            start_ts: new Date(start).toISOString(), end_ts: new Date(end).toISOString(),
          }, 'sleep logged');
          setStart(''); setEnd('');
        }}>Save</Chip>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        “Falling asleep now” starts an open sleep — end it from the Timeline.
      </p>
    </Card>
  );
}

function GrowthForm({ insert }: { insert: Insert }) {
  const [kg, setKg] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <Card title="⚖️ Weigh-in" color="#66BB6A">
      <div className="flex flex-wrap items-center gap-2">
        <input inputMode="decimal" placeholder="kg (e.g. 3.42)" value={kg}
          onChange={(e) => setKg(e.target.value)}
          className="w-32 rounded-xl border border-slate-200 p-2.5" />
        <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-slate-200 p-2.5 text-sm" />
        <Chip color="#66BB6A" onClick={() => {
          const v = Number(kg.replace(',', '.'));
          if (!v || v < 1 || v > 30) return;
          insert('growth', {
            measured_at: date,
            weight_g: Math.round(v * 1000),
          }, `${v} kg — target updates`);
          setKg('');
        }}>Save</Chip>
      </div>
    </Card>
  );
}

function CustomNumber({ unit, onSubmit }: { unit: string; onSubmit: (n: number) => void }) {
  const [v, setV] = useState('');
  return (
    <span className="inline-flex items-center gap-1">
      <input inputMode="numeric" placeholder={`custom ${unit}`} value={v}
        onChange={(e) => setV(e.target.value)}
        className="w-24 rounded-xl border border-slate-200 p-2.5 text-center text-sm" />
      <button className="text-sm font-semibold text-slate-500 underline"
        onClick={() => { const n = Number(v); if (n > 0) { onSubmit(n); setV(''); } }}>
        ok
      </button>
    </span>
  );
}
