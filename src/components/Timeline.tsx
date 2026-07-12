import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BreastSide, Diaper, Feed, FeedSubstance, Pump, Sleep } from '../lib/types';

type ActivityTable = 'feeds' | 'pumps' | 'diapers' | 'sleeps';

interface Item {
  id: string;
  table: ActivityTable;
  ts: string;
  label: string;
  emoji: string;
  raw: Feed | Pump | Diaper | Sleep;
  openSleep?: boolean;
}

// Multi-select filter chips; an empty selection means "show everything".
const FILTERS: { table: ActivityTable; label: string; emoji: string }[] = [
  { table: 'feeds', label: 'Feeds', emoji: '🍼' },
  { table: 'pumps', label: 'Pumps', emoji: '🥛' },
  { table: 'diapers', label: 'Diapers', emoji: '💧' },
  { table: 'sleeps', label: 'Sleep', emoji: '😴' },
];

// Lookback window; null = full history.
const RANGES: { label: string; days: number | null }[] = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'All', days: null },
];

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit',
});

// ISO timestamp ⇄ <input type="datetime-local"> value (local time).
const toLocal = (ts: string) =>
  new Date(+new Date(ts) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const toIso = (local: string) => new Date(local).toISOString();
const nowLocal = () => toLocal(new Date().toISOString());

const INPUT = 'rounded-lg border border-slate-200 bg-white p-1.5';

export default function Timeline({ childId }: { childId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [active, setActive] = useState<ActivityTable[]>([]);
  const [rangeDays, setRangeDays] = useState<number | null>(7);
  const [editing, setEditing] = useState<string | null>(null); // `${table}-${id}`

  const toggle = (t: ActivityTable) =>
    setActive((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const load = useCallback(async () => {
    const since = rangeDays === null
      ? null
      : new Date(Date.now() - rangeDays * 86400000).toISOString();
    const q = (table: ActivityTable, tsCol: 'ts' | 'start_ts') => {
      let query = supabase!.from(table).select('*').eq('child_id', childId);
      if (since) query = query.gte(tsCol, since);
      return query.order(tsCol, { ascending: false });
    };
    const [feeds, pumps, diapers, sleeps] = await Promise.all([
      q('feeds', 'ts'), q('pumps', 'ts'), q('diapers', 'ts'), q('sleeps', 'start_ts'),
    ]);
    const all: Item[] = [
      ...((feeds.data ?? []) as Feed[]).map((f): Item => ({
        id: f.id, table: 'feeds', ts: f.ts, raw: f,
        emoji: f.delivery === 'breast' ? '🤱' : '🍼',
        label: f.delivery === 'breast'
          ? `Direct ${f.duration_min ?? '?'} min${f.side ? ` (${f.side})` : ''}`
          : `${f.substance === 'formula' ? 'Formula' : 'EBM'} ${f.volume_ml ?? '?'} mL`,
      })),
      ...((pumps.data ?? []) as Pump[]).map((p): Item => ({
        id: p.id, table: 'pumps', ts: p.ts, raw: p, emoji: '🥛',
        label: `Pumped ${p.total_ml} mL${p.left_ml || p.right_ml
          ? ` (L${p.left_ml ?? 0}/R${p.right_ml ?? 0})` : ''}`,
      })),
      ...((diapers.data ?? []) as Diaper[]).map((d): Item => ({
        id: d.id, table: 'diapers', ts: d.ts, raw: d, emoji: d.dirty ? '💩' : '💧',
        label: `Diaper: ${[d.wet && 'wet', d.dirty && 'dirty'].filter(Boolean).join(' + ') || '—'}` +
          (d.stool_colour ? ` (${d.stool_colour})` : ''),
      })),
      ...((sleeps.data ?? []) as Sleep[]).map((s): Item => ({
        id: s.id, table: 'sleeps', ts: s.start_ts, raw: s, emoji: '😴', openSleep: !s.end_ts,
        label: s.end_ts
          ? `Slept ${Math.round((+new Date(s.end_ts) - +new Date(s.start_ts)) / 60000)} min`
          : 'Sleeping… (tap ⏹ to end)',
      })),
    ].sort((a, b) => b.ts.localeCompare(a.ts));
    setItems(all);
  }, [childId, rangeDays]);

  useEffect(() => {
    void load();
    // realtime: any change from either parent's phone refreshes the list
    const ch = supabase!
      .channel('timeline')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => void load())
      .subscribe();
    return () => void supabase!.removeChannel(ch);
  }, [load]);

  async function del(item: Item) {
    if (!confirm(`Delete "${item.label}"?`)) return;
    await supabase!.from(item.table).delete().eq('id', item.id);
    void load();
  }

  async function endSleep(item: Item) {
    await supabase!.from('sleeps').update({ end_ts: new Date().toISOString() })
      .eq('id', item.id);
    void load();
  }

  const shown = items && (active.length ? items.filter((it) => active.includes(it.table)) : items);

  return (
    <div className="pt-2">
      <div className="flex flex-wrap gap-1.5 pb-2">
        {FILTERS.map((f) => {
          const on = active.includes(f.table);
          return (
            <button key={f.table} onClick={() => toggle(f.table)} aria-pressed={on}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                on ? 'border-slate-600 bg-slate-600 text-white'
                   : 'border-slate-200 bg-white text-slate-500'}`}>
              {f.emoji} {f.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pb-1 text-xs text-slate-400">
        <span>Show:</span>
        {RANGES.map((r) => (
          <button key={r.label} onClick={() => setRangeDays(r.days)}
            className={rangeDays === r.days
              ? 'font-bold text-slate-600'
              : 'underline underline-offset-2'}>
            {r.label}
          </button>
        ))}
      </div>
      {!shown ? (
        <p className="pt-8 text-center text-slate-400">Loading…</p>
      ) : !shown.length ? (
        <p className="pt-8 text-center text-slate-400">
          {items!.length
            ? 'No matching entries in this window.'
            : rangeDays === null
              ? 'Nothing logged yet.'
              : `Nothing in the last ${rangeDays} days.`}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((it) => {
            const key = `${it.table}-${it.id}`;
            return (
              <li key={key} className="py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{it.emoji}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-700">{it.label}</div>
                    <div className="text-xs text-slate-400">{fmt.format(new Date(it.ts))}</div>
                  </div>
                  {it.openSleep && (
                    <button onClick={() => endSleep(it)} title="End sleep"
                      className="rounded-lg bg-sleepy px-2.5 py-1.5 text-sm text-white">⏹</button>
                  )}
                  <button onClick={() => setEditing(editing === key ? null : key)} title="Edit"
                    className={`px-1.5 ${editing === key
                      ? 'text-slate-600' : 'text-slate-300 hover:text-slate-500'}`}>✎</button>
                  <button onClick={() => del(it)} title="Delete"
                    className="px-1.5 text-slate-300 hover:text-red-400">✕</button>
                </div>
                {editing === key && (
                  <EditForm item={it} onCancel={() => setEditing(null)}
                    onSaved={() => { setEditing(null); void load(); }} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---- in-place editing -------------------------------------------------------

type Update = (patch: Record<string, unknown>) => Promise<void>;

function EditForm({ item, onSaved, onCancel }: {
  item: Item; onSaved: () => void; onCancel: () => void;
}) {
  const update: Update = async (patch) => {
    const { error } = await supabase!.from(item.table).update(patch).eq('id', item.id);
    if (error) alert(`Update failed: ${error.message}`);
    else onSaved();
  };
  switch (item.table) {
    case 'feeds': return <FeedEdit f={item.raw as Feed} update={update} onCancel={onCancel} />;
    case 'pumps': return <PumpEdit p={item.raw as Pump} update={update} onCancel={onCancel} />;
    case 'diapers': return <DiaperEdit d={item.raw as Diaper} update={update} onCancel={onCancel} />;
    case 'sleeps': return <SleepEdit s={item.raw as Sleep} update={update} onCancel={onCancel} />;
  }
}

function EditShell({ onSave, onCancel, children }: {
  onSave: () => void; onCancel: () => void; children: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600">
      {children}
      <button onClick={onSave}
        className="rounded-lg bg-slate-600 px-3 py-1.5 font-semibold text-white">Save</button>
      <button onClick={onCancel} className="px-1 text-slate-400 underline">cancel</button>
    </div>
  );
}

function FeedEdit({ f, update, onCancel }: { f: Feed; update: Update; onCancel: () => void }) {
  const [when, setWhen] = useState(toLocal(f.ts));
  const [volume, setVolume] = useState(String(f.volume_ml ?? ''));
  const [substance, setSubstance] = useState<FeedSubstance>(f.substance);
  const [duration, setDuration] = useState(String(f.duration_min ?? ''));
  const [side, setSide] = useState<BreastSide>(f.side ?? 'both');
  const breast = f.delivery === 'breast';
  return (
    <EditShell onCancel={onCancel} onSave={() => void update(breast
      ? { ts: toIso(when), duration_min: Number(duration) || null, side }
      : { ts: toIso(when), volume_ml: Number(volume) || null, substance })}>
      <input type="datetime-local" value={when} max={nowLocal()} className={INPUT}
        onChange={(e) => setWhen(e.target.value)} />
      {breast ? (
        <>
          <input inputMode="numeric" value={duration} placeholder="min"
            className={`${INPUT} w-14 text-center`}
            onChange={(e) => setDuration(e.target.value)} />
          <span>min</span>
          <select value={side} className={INPUT}
            onChange={(e) => setSide(e.target.value as BreastSide)}>
            <option value="L">L</option>
            <option value="both">Both</option>
            <option value="R">R</option>
          </select>
        </>
      ) : (
        <>
          <input inputMode="numeric" value={volume} placeholder="mL"
            className={`${INPUT} w-14 text-center`}
            onChange={(e) => setVolume(e.target.value)} />
          <span>mL</span>
          <select value={substance} className={INPUT}
            onChange={(e) => setSubstance(e.target.value as FeedSubstance)}>
            <option value="breast_milk">Breast milk</option>
            <option value="formula">Formula</option>
          </select>
        </>
      )}
    </EditShell>
  );
}

function PumpEdit({ p, update, onCancel }: { p: Pump; update: Update; onCancel: () => void }) {
  const [when, setWhen] = useState(toLocal(p.ts));
  const [left, setLeft] = useState(String(p.left_ml ?? ''));
  const [right, setRight] = useState(String(p.right_ml ?? ''));
  const total = (Number(left) || 0) + (Number(right) || 0);
  return (
    <EditShell onCancel={onCancel} onSave={() => {
      if (!total) return;
      void update({
        ts: toIso(when),
        left_ml: Number(left) || null, right_ml: Number(right) || null, total_ml: total,
      });
    }}>
      <input type="datetime-local" value={when} max={nowLocal()} className={INPUT}
        onChange={(e) => setWhen(e.target.value)} />
      <input inputMode="numeric" value={left} placeholder="L mL"
        className={`${INPUT} w-14 text-center`} onChange={(e) => setLeft(e.target.value)} />
      <input inputMode="numeric" value={right} placeholder="R mL"
        className={`${INPUT} w-14 text-center`} onChange={(e) => setRight(e.target.value)} />
      <span>= {total} mL</span>
    </EditShell>
  );
}

function DiaperEdit({ d, update, onCancel }: { d: Diaper; update: Update; onCancel: () => void }) {
  const [when, setWhen] = useState(toLocal(d.ts));
  const [wet, setWet] = useState(d.wet);
  const [dirty, setDirty] = useState(d.dirty);
  return (
    <EditShell onCancel={onCancel} onSave={() => {
      if (!wet && !dirty) return alert('Pick wet, dirty, or both.');
      void update({ ts: toIso(when), wet, dirty });
    }}>
      <input type="datetime-local" value={when} max={nowLocal()} className={INPUT}
        onChange={(e) => setWhen(e.target.value)} />
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={wet} onChange={(e) => setWet(e.target.checked)} /> wet
      </label>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={dirty} onChange={(e) => setDirty(e.target.checked)} /> dirty
      </label>
    </EditShell>
  );
}

function SleepEdit({ s, update, onCancel }: { s: Sleep; update: Update; onCancel: () => void }) {
  const [start, setStart] = useState(toLocal(s.start_ts));
  const [end, setEnd] = useState(s.end_ts ? toLocal(s.end_ts) : '');
  return (
    <EditShell onCancel={onCancel} onSave={() => {
      if (end && toIso(end) <= toIso(start)) return alert('End must be after start.');
      void update({ start_ts: toIso(start), end_ts: end ? toIso(end) : null });
    }}>
      <input type="datetime-local" value={start} max={nowLocal()} className={INPUT}
        onChange={(e) => setStart(e.target.value)} />
      <span>→</span>
      <input type="datetime-local" value={end} max={nowLocal()} className={INPUT}
        onChange={(e) => setEnd(e.target.value)} />
      {!end && <span className="text-slate-400">(empty = still sleeping)</span>}
    </EditShell>
  );
}
