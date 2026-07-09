/**
 * Parser for a common baby-tracking-app CSV export, so you can migrate your
 * history when switching to this app. Expected columns (header row required):
 *
 *   Type, Start, End, Duration, Start Condition, Start Location,
 *   End Condition, Notes
 *
 * Mapping:
 *  - Feed + Start Location "Bottle": Start Condition = "Breast Milk"|"Formula",
 *    volume from End Condition text like "30ml"
 *  - Feed + Start Location "Breast": a direct feed; Duration "HH:MM" is minutes,
 *    per-side codes like "00:23R" in the condition columns; no volume captured
 *  - Sleep: Duration "HH:MM"; Diaper: wet/dirty from End Condition text, with
 *    stool colour arriving (quirkily) in the Duration column
 *  - Timestamps are local wall-clock with no zone, e.g. "2026-06-26 10:28"
 *
 * If your previous tracker exports a different shape, adjust the field mapping
 * here and in scripts/import-csv.ts.
 */

export interface CsvRow {
  type: string;
  start: string;
  end: string;
  duration: string;
  startCondition: string;
  startLocation: string;
  endCondition: string;
  notes: string;
}

export type Category =
  | 'direct'
  | 'ebm'
  | 'formula'
  | 'sleep'
  | 'diaper'
  | 'pump'
  | 'unknown';

/** Minimal RFC-4180 CSV parser (quotes, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

export function toCsvRows(text: string): CsvRow[] {
  const raw = parseCsv(text);
  if (!raw.length || raw[0][0] !== 'Type') {
    throw new Error(
      `Not a recognised tracker CSV (header starts "${raw[0]?.slice(0, 3).join(',')}")`,
    );
  }
  return raw
    .slice(1)
    .filter((r) => r[0]?.trim())
    .map((r) => ({
      type: (r[0] ?? '').trim(),
      start: (r[1] ?? '').trim(),
      end: (r[2] ?? '').trim(),
      duration: (r[3] ?? '').trim(),
      startCondition: (r[4] ?? '').trim(),
      startLocation: (r[5] ?? '').trim(),
      endCondition: (r[6] ?? '').trim(),
      notes: (r[7] ?? '').trim(),
    }));
}

export function categorize(r: CsvRow): Category {
  if (r.type === 'Feed') {
    if (r.startLocation === 'Bottle') {
      return r.startCondition === 'Formula' ? 'formula' : 'ebm';
    }
    return 'direct';
  }
  if (r.type === 'Sleep') return 'sleep';
  if (r.type === 'Diaper') return 'diaper';
  if (r.type === 'Pump') return 'pump';
  return 'unknown';
}

/** "HH:MM" -> minutes; blank/garbage -> 0. */
export function parseHhmm(s: string): number {
  const m = /^(\d+):(\d{2})/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** "30ml" -> 30; blank/garbage -> 0. */
export function parseMl(s: string): number {
  const n = Number(s.trim().toLowerCase().replace('ml', '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Side codes like "00:23R" / "00:36L" in start/end condition. */
export function parseSide(r: CsvRow): 'L' | 'R' | 'both' | null {
  const seen: string[] = (r.startCondition + ' ' + r.endCondition).match(/[LR]\b/g) ?? [];
  const l = seen.includes('L');
  const rr = seen.includes('R');
  if (l && rr) return 'both';
  if (l) return 'L';
  if (rr) return 'R';
  return null;
}

/** Local "YYYY-MM-DD HH:MM" -> Date in this machine's timezone. */
export function parseLocalTs(s: string): Date {
  return new Date(s.slice(0, 16).replace(' ', 'T'));
}

/** Stable per-row key so re-importing the same export can never duplicate. */
export function sourceKey(r: CsvRow): string {
  return [r.type, r.start, r.end, r.duration, r.startCondition, r.startLocation, r.endCondition]
    .join('|');
}
