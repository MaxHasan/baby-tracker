/**
 * Import a previous tracker's CSV export into Supabase — see src/lib/csv-import.ts
 * for the expected column format.
 *
 * Dry run (default) — parse and print the daily rollup, write nothing:
 *   npm run import:dry -- "path/to/export.csv"
 *
 * Apply — write to Supabase (needs SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   npm run import -- "path/to/export.csv" --apply
 *
 * Imports are idempotent: every source row carries a natural key, so
 * re-importing an overlapping export inserts only the new rows.
 * Timestamps are local wall-clock with no zone, so run this on a machine set
 * to the same timezone the log was recorded in.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  categorize, parseHhmm, parseLocalTs, parseMl, parseSide, sourceKey,
  toCsvRows, type CsvRow,
} from '../src/lib/csv-import';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- tiny .env loader (no dependency) --------------------------------------
for (const file of ['.env.local', '.env']) {
  const p = resolve(ROOT, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---- row mapping ------------------------------------------------------------
interface Mapped {
  feeds: Record<string, unknown>[];
  sleeps: Record<string, unknown>[];
  diapers: Record<string, unknown>[];
  pumps: Record<string, unknown>[];
  unknown: CsvRow[];
}

function mapRows(rows: CsvRow[]): Mapped {
  const out: Mapped = { feeds: [], sleeps: [], diapers: [], pumps: [], unknown: [] };
  for (const r of rows) {
    const cat = categorize(r);
    const key = sourceKey(r);
    const ts = parseLocalTs(r.start).toISOString();
    if (cat === 'direct') {
      out.feeds.push({
        ts, delivery: 'breast', substance: 'breast_milk',
        duration_min: parseHhmm(r.duration), side: parseSide(r), source_key: key, source: 'csv',
      });
    } else if (cat === 'ebm' || cat === 'formula') {
      out.feeds.push({
        ts, delivery: 'bottle',
        substance: cat === 'formula' ? 'formula' : 'breast_milk',
        volume_ml: parseMl(r.endCondition), source_key: key, source: 'csv',
      });
    } else if (cat === 'sleep') {
      const end = r.end
        ? parseLocalTs(r.end)
        : new Date(+parseLocalTs(r.start) + parseHhmm(r.duration) * 60000);
      out.sleeps.push({
        start_ts: ts, end_ts: end.toISOString(), source_key: key, source: 'csv',
      });
    } else if (cat === 'diaper') {
      const ec = r.endCondition.toLowerCase();
      out.diapers.push({
        ts, wet: ec.includes('pee'), dirty: ec.includes('poo'),
        stool_colour: ec.includes('poo') && r.duration ? r.duration : null,
        source_key: key, source: 'csv',
      });
    } else if (cat === 'pump') {
      // format unverified — a best guess until we see real pump rows
      out.pumps.push({
        ts, total_ml: parseMl(r.endCondition), source_key: key, source: 'csv',
      });
    } else {
      out.unknown.push(r);
    }
  }
  return out;
}

// ---- daily rollup for dry-run / check ---------------------------------------
interface Day {
  directFeeds: number; directMin: number; ebmMl: number; formulaMl: number;
  wet: number; dirty: number; sleepMin: number;
}

function rollup(m: Mapped): Map<string, Day> {
  const days = new Map<string, Day>();
  const day = (iso: string) => {
    const d = new Date(iso);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.has(key)) {
      days.set(key, { directFeeds: 0, directMin: 0, ebmMl: 0, formulaMl: 0, wet: 0, dirty: 0, sleepMin: 0 });
    }
    return days.get(key)!;
  };
  for (const f of m.feeds) {
    const d = day(f.ts as string);
    if (f.delivery === 'breast') {
      d.directFeeds++;
      d.directMin += f.duration_min as number;
    } else if (f.substance === 'formula') d.formulaMl += f.volume_ml as number;
    else d.ebmMl += f.volume_ml as number;
  }
  for (const di of m.diapers) {
    const d = day(di.ts as string);
    if (di.wet) d.wet++;
    if (di.dirty) d.dirty++;
  }
  for (const s of m.sleeps) {
    day(s.start_ts as string).sleepMin +=
      Math.round((+new Date(s.end_ts as string) - +new Date(s.start_ts as string)) / 60000);
  }
  return days;
}

// ---- main --------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const csvPath = args.find((a) => !a.startsWith('--'));
  if (!csvPath) {
    console.error('Usage: npm run import -- <export.csv> [--apply]');
    process.exit(2);
  }

  const rows = toCsvRows(readFileSync(resolve(csvPath), 'utf-8'));
  const mapped = mapRows(rows);
  console.log(
    `Parsed ${rows.length} rows → feeds ${mapped.feeds.length}, ` +
    `sleeps ${mapped.sleeps.length}, diapers ${mapped.diapers.length}, ` +
    `pumps ${mapped.pumps.length}, unknown ${mapped.unknown.length}`,
  );
  if (mapped.unknown.length) {
    console.warn('⚠ Unknown Type values:',
      [...new Set(mapped.unknown.map((r) => r.type))].join(', '));
  }

  const days = rollup(mapped);
  console.log('\ndate        dFeeds  dMin  ebmML  forML  wet  dirty  sleepMin');
  for (const [date, d] of [...days.entries()].sort()) {
    console.log(
      `${date}  ${String(d.directFeeds).padStart(5)} ${String(d.directMin).padStart(5)}` +
      ` ${String(d.ebmMl).padStart(6)} ${String(d.formulaMl).padStart(6)}` +
      ` ${String(d.wet).padStart(4)} ${String(d.dirty).padStart(6)}` +
      ` ${String(d.sleepMin).padStart(9)}`,
    );
  }

  if (!apply) {
    console.log('\nDry run only — pass --apply to write to Supabase.');
    return;
  }

  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(2);
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  let childId = process.env.CHILD_ID;
  if (!childId) {
    const { data, error } = await db.from('children').select('id').order('created_at');
    if (error || !data?.length) {
      console.error('No baby record found — set the baby up in the app once, or ' +
        'set CHILD_ID in .env.local.', error?.message ?? '');
      process.exit(1);
    }
    if (data.length > 1) {
      console.error(`Found ${data.length} baby records — set CHILD_ID to the one to import into.`);
      process.exit(1);
    }
    childId = data[0].id as string;
  }

  for (const [table, items] of Object.entries({
    feeds: mapped.feeds, sleeps: mapped.sleeps,
    diapers: mapped.diapers, pumps: mapped.pumps,
  })) {
    let inserted = 0;
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500).map((r) => ({ ...r, child_id: childId }));
      const { error, count } = await db.from(table)
        .upsert(chunk, { onConflict: 'child_id,source_key', ignoreDuplicates: true, count: 'exact' });
      if (error) {
        console.error(`${table}: ${error.message}`);
        process.exit(1);
      }
      inserted += count ?? 0;
    }
    console.log(`${table}: ${inserted} new (of ${items.length} in export)`);
  }
  console.log('\nImport complete.');
}

void main();
