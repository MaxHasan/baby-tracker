import type { Diaper, Feed, Growth, Pump, Sleep } from './types';
import { directMlPerFeed, targetMlPerKg } from './types';

export interface DayRow {
  date: string; // yyyy-mm-dd, local
  directFeeds: number;
  directMin: number;
  directEstMl: number;
  ebmMl: number;
  formulaMl: number;
  bottleMl: number;
  totalEstMl: number;
  wet: number;
  dirty: number;
  sleepMin: number;
  pumpedMl: number;
  pumpedLeftMl: number;
  pumpedRightMl: number;
  weightG: number | null; // weight used for this day's target
  targetMl: number | null;
}

export function localDateKey(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Latest known weight (g) on or before a date; falls back to birth weight. */
function weightOn(date: string, growth: Growth[], birthWeightG: number | null) {
  let w = birthWeightG;
  for (const g of [...growth].sort((a, b) => a.measured_at.localeCompare(b.measured_at))) {
    if (g.measured_at <= date && g.weight_g) w = g.weight_g;
  }
  return w;
}

export function dailyRollup(args: {
  feeds: Feed[];
  pumps: Pump[];
  diapers: Diaper[];
  sleeps: Sleep[];
  growth: Growth[];
  birthWeightG: number | null;
  dob: string;
  fromDate: string;
  toDate: string;
}): DayRow[] {
  // Age in whole days on a given local date (dob and keys are yyyy-mm-dd).
  const ageOn = (date: string) =>
    Math.round((+new Date(date) - +new Date(args.dob)) / 86400000);
  const days = new Map<string, DayRow>();
  for (let d = new Date(args.fromDate); localDateKey(d.toISOString()) <= args.toDate; d.setDate(d.getDate() + 1)) {
    const key = localDateKey(d.toISOString());
    const w = weightOn(key, args.growth, args.birthWeightG);
    days.set(key, {
      date: key, directFeeds: 0, directMin: 0, directEstMl: 0, ebmMl: 0,
      formulaMl: 0, bottleMl: 0, totalEstMl: 0, wet: 0, dirty: 0, sleepMin: 0,
      pumpedMl: 0, pumpedLeftMl: 0, pumpedRightMl: 0, weightG: w,
      targetMl: w ? Math.round((w / 1000) * targetMlPerKg(ageOn(key))) : null,
    });
  }
  const day = (ts: string) => days.get(localDateKey(ts));

  for (const f of args.feeds) {
    const d = day(f.ts);
    if (!d) continue;
    if (f.delivery === 'breast') {
      d.directFeeds += 1;
      d.directMin += f.duration_min ?? 0;
    } else if (f.substance === 'formula') d.formulaMl += f.volume_ml ?? 0;
    else d.ebmMl += f.volume_ml ?? 0;
  }
  for (const p of args.pumps) {
    const d = day(p.ts);
    if (!d) continue;
    d.pumpedMl += p.total_ml;
    d.pumpedLeftMl += p.left_ml ?? 0;
    d.pumpedRightMl += p.right_ml ?? 0;
  }
  for (const di of args.diapers) {
    const d = day(di.ts);
    if (!d) continue;
    if (di.wet) d.wet += 1;
    if (di.dirty) d.dirty += 1;
  }
  // Sleep can span midnight — credit each local day the portion that fell in
  // it (23:30→04:00 = 0.5h on day T, 4h on day T+1), not all to the start day.
  for (const s of args.sleeps) {
    if (!s.end_ts) continue;
    let cursor = new Date(s.start_ts);
    const end = new Date(s.end_ts);
    while (cursor < end) {
      const midnight = new Date(cursor);
      midnight.setHours(24, 0, 0, 0); // next local midnight
      const segEnd = midnight < end ? midnight : end;
      const d = days.get(localDateKey(cursor.toISOString()));
      if (d) d.sleepMin += Math.round((+segEnd - +cursor) / 60000);
      cursor = segEnd;
    }
  }

  for (const d of days.values()) {
    // Per-feed estimate (Kent 2006), age-ramped for the colostrum/transition
    // period; duration is a poor linear predictor at any age.
    d.directEstMl = Math.round(d.directFeeds * directMlPerFeed(ageOn(d.date)));
    d.bottleMl = d.ebmMl + d.formulaMl;
    d.totalEstMl = d.directEstMl + d.bottleMl;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
