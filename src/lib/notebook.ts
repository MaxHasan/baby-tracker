/**
 * Shared types + mapping for the caretaker-notebook OCR flow.
 * The extraction itself happens server-side in api/ocr.ts (Claude vision);
 * these helpers turn reviewed events into idempotent Supabase rows.
 */

export interface NotebookEvent {
  time: string; // "HH:MM" 24h
  kind: 'bottle' | 'direct' | 'diaper';
  substance: 'breast_milk' | 'formula' | null; // bottle only (A=ASI→breast_milk, F→formula)
  volume_ml: number | null; // bottle only
  duration_min: number | null; // direct only (e.g. "DBF ± 15 m")
  wet: boolean | null; // diaper only
  dirty: boolean | null; // diaper only
  note: string | null;
  confidence: 'high' | 'low';
}

export interface NotebookTotals {
  a_ml: number | null; // caretaker's written ASI tally
  f_ml: number | null; // formula tally
  total_ml: number | null;
  pee_count: number | null;
  poo_count: number | null;
}

export interface NotebookDay {
  date: string | null; // "YYYY-MM-DD"
  events: NotebookEvent[];
  totals: NotebookTotals;
}

export interface OcrResult {
  days: NotebookDay[];
  warnings: string[];
}

/** Local wall-clock date+time → ISO (runs in the family's timezone). */
export function eventTs(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

/** Stable natural key: re-scanning the same page can never duplicate rows. */
export function notebookSourceKey(date: string, e: NotebookEvent): string {
  return [
    'notebook', date, e.time, e.kind,
    e.volume_ml ?? e.duration_min ?? '', e.substance ?? '',
  ].join('|');
}

export function toRow(date: string, e: NotebookEvent):
  { table: 'feeds' | 'diapers'; row: Record<string, unknown> } {
  const base = {
    ts: eventTs(date, e.time),
    note: e.note,
    source: 'notebook',
    source_key: notebookSourceKey(date, e),
  };
  if (e.kind === 'diaper') {
    return { table: 'diapers', row: { ...base, wet: !!e.wet, dirty: !!e.dirty } };
  }
  if (e.kind === 'direct') {
    return {
      table: 'feeds',
      row: {
        ...base, delivery: 'breast', substance: 'breast_milk',
        duration_min: e.duration_min,
      },
    };
  }
  return {
    table: 'feeds',
    row: {
      ...base, delivery: 'bottle',
      substance: e.substance ?? 'breast_milk', volume_ml: e.volume_ml,
    },
  };
}

/** Sum the included bottle events for the checksum against the written tally. */
export function bottleSums(events: NotebookEvent[]): { a: number; f: number } {
  let a = 0, f = 0;
  for (const e of events) {
    if (e.kind !== 'bottle' || !e.volume_ml) continue;
    if (e.substance === 'formula') f += e.volume_ml;
    else a += e.volume_ml;
  }
  return { a, f };
}
