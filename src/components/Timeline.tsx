import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Diaper, Feed, Pump, Sleep } from '../lib/types';

interface Item {
  id: string;
  table: 'feeds' | 'pumps' | 'diapers' | 'sleeps';
  ts: string;
  label: string;
  emoji: string;
  openSleep?: boolean;
}

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit',
});

export default function Timeline({ childId }: { childId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    const [feeds, pumps, diapers, sleeps] = await Promise.all([
      supabase!.from('feeds').select('*').eq('child_id', childId)
        .gte('ts', since).order('ts', { ascending: false }),
      supabase!.from('pumps').select('*').eq('child_id', childId)
        .gte('ts', since).order('ts', { ascending: false }),
      supabase!.from('diapers').select('*').eq('child_id', childId)
        .gte('ts', since).order('ts', { ascending: false }),
      supabase!.from('sleeps').select('*').eq('child_id', childId)
        .gte('start_ts', since).order('start_ts', { ascending: false }),
    ]);
    const all: Item[] = [
      ...((feeds.data ?? []) as Feed[]).map((f): Item => ({
        id: f.id, table: 'feeds', ts: f.ts,
        emoji: f.delivery === 'breast' ? '🤱' : '🍼',
        label: f.delivery === 'breast'
          ? `Direct ${f.duration_min ?? '?'} min${f.side ? ` (${f.side})` : ''}`
          : `${f.substance === 'formula' ? 'Formula' : 'EBM'} ${f.volume_ml ?? '?'} mL`,
      })),
      ...((pumps.data ?? []) as Pump[]).map((p): Item => ({
        id: p.id, table: 'pumps', ts: p.ts, emoji: '🥛',
        label: `Pumped ${p.total_ml} mL${p.left_ml || p.right_ml
          ? ` (L${p.left_ml ?? 0}/R${p.right_ml ?? 0})` : ''}`,
      })),
      ...((diapers.data ?? []) as Diaper[]).map((d): Item => ({
        id: d.id, table: 'diapers', ts: d.ts, emoji: d.dirty ? '💩' : '💧',
        label: `Diaper: ${[d.wet && 'wet', d.dirty && 'dirty'].filter(Boolean).join(' + ') || '—'}` +
          (d.stool_colour ? ` (${d.stool_colour})` : ''),
      })),
      ...((sleeps.data ?? []) as Sleep[]).map((s): Item => ({
        id: s.id, table: 'sleeps', ts: s.start_ts, emoji: '😴', openSleep: !s.end_ts,
        label: s.end_ts
          ? `Slept ${Math.round((+new Date(s.end_ts) - +new Date(s.start_ts)) / 60000)} min`
          : 'Sleeping… (tap ⏹ to end)',
      })),
    ].sort((a, b) => b.ts.localeCompare(a.ts));
    setItems(all);
  }, [childId]);

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

  if (!items) return <p className="pt-8 text-center text-slate-400">Loading…</p>;
  if (!items.length) {
    return <p className="pt-8 text-center text-slate-400">Nothing in the last 3 days.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 pt-2">
      {items.map((it) => (
        <li key={`${it.table}-${it.id}`} className="flex items-center gap-3 py-2.5">
          <span className="text-xl">{it.emoji}</span>
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-700">{it.label}</div>
            <div className="text-xs text-slate-400">{fmt.format(new Date(it.ts))}</div>
          </div>
          {it.openSleep && (
            <button onClick={() => endSleep(it)} title="End sleep"
              className="rounded-lg bg-sleepy px-2.5 py-1.5 text-sm text-white">⏹</button>
          )}
          <button onClick={() => del(it)} title="Delete"
            className="px-2 text-slate-300 hover:text-red-400">✕</button>
        </li>
      ))}
    </ul>
  );
}
