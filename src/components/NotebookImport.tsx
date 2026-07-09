import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  bottleSums, toRow, type NotebookEvent, type OcrResult,
} from '../lib/notebook';
import { Card, Chip } from './QuickAdd';

/** Snap a photo of the caretaker's notebook page → Claude reads it →
 * review/correct the rows → save. Re-scanning a page never duplicates. */
export default function NotebookImport({ childId }: { childId: string }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'ocr' | 'save' | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');

  async function handleFile(file: File) {
    setBusy('ocr'); setMsg(''); setResult(null); setSkip(new Set());
    // The result is delivered twice: as the HTTP response AND as a row in
    // ocr_jobs. If the connection drops mid-read, the DB poll still gets it.
    const jobId = crypto.randomUUID();
    let settled = false;
    try {
      const { data, mediaType } = await toJpegBase64(file);
      const { data: { session } } = await supabase!.auth.getSession();

      const viaHttp = (async (): Promise<OcrResult> => {
        const resp = await fetch('/api/ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ image: data, mediaType, jobId }),
          signal: AbortSignal.timeout(280_000),
        });
        if (!resp.ok) {
          const detail = await resp.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${resp.status}`);
        }
        return resp.json() as Promise<OcrResult>;
      })();

      const viaDb = (async (): Promise<OcrResult> => {
        for (let i = 0; i < 70 && !settled; i++) {
          await new Promise((r) => setTimeout(r, 4000));
          const { data: row } = await supabase!
            .from('ocr_jobs').select('status,result,error').eq('id', jobId).maybeSingle();
          if (row?.status === 'done') return row.result as OcrResult;
          if (row?.status === 'error') throw new Error(row.error ?? 'reading failed');
        }
        throw new Error('Timed out waiting for the result');
      })();

      setResult(await Promise.any([viaHttp, viaDb]));
    } catch (e) {
      const first = e instanceof AggregateError ? e.errors[0] : e;
      const network = first instanceof TypeError ||
        (first instanceof DOMException && first.name === 'TimeoutError');
      setMsg(network
        ? '⚠ Connection dropped while reading — the page may be very dense. Try again.'
        : `⚠ ${first instanceof Error ? first.message : 'reading failed'}`);
    } finally {
      settled = true;
      setBusy(null);
      if (cameraRef.current) cameraRef.current.value = '';
      if (albumRef.current) albumRef.current.value = '';
    }
  }

  function update(di: number, ei: number, patch: Partial<NotebookEvent>) {
    setResult((r) => {
      if (!r) return r;
      const days = r.days.map((d, i) =>
        i !== di ? d : {
          ...d,
          events: d.events.map((e, j) => (j !== ei ? e : { ...e, ...patch })),
        });
      return { ...r, days };
    });
  }

  async function save() {
    if (!result) return;
    setBusy('save');
    let saved = 0, dupes = 0, failed = 0;
    for (const [di, day] of result.days.entries()) {
      if (!day.date) continue;
      for (const [ei, ev] of day.events.entries()) {
        if (skip.has(`${di}-${ei}`)) continue;
        const { table, row } = toRow(day.date, ev);
        const { error, count } = await supabase!
          .from(table)
          .upsert({ child_id: childId, ...row }, {
            onConflict: 'child_id,source_key', ignoreDuplicates: true, count: 'exact',
          });
        if (error) failed++;
        else if (count) saved++;
        else dupes++;
      }
    }
    setBusy(null);
    setMsg(`✓ ${saved} saved${dupes ? `, ${dupes} already logged` : ''}${failed ? `, ⚠ ${failed} failed` : ''}`);
    if (!failed) setResult(null);
  }

  return (
    <Card title="📓 Caretaker's notebook" color="#B08968">
      {!result && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Photograph a notebook page and Claude will read the feeds, diapers and
            direct-breastfeed notes — you review before anything is saved.
          </p>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} />
          <input ref={albumRef} type="file" accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} />
          <div className="flex flex-wrap gap-2">
            <Chip color="#B08968" onClick={() => cameraRef.current?.click()}>
              {busy === 'ocr' ? 'Reading page…' : '📷 Camera'}
            </Chip>
            <Chip color="#B08968" onClick={() => albumRef.current?.click()}>
              🖼️ From photos
            </Chip>
          </div>
        </>
      )}

      {result && (
        <div className="space-y-4">
          {result.warnings.map((w, i) => (
            <p key={i} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700">⚠ {w}</p>
          ))}
          {result.days.map((day, di) => {
            const included = day.events.filter((_, ei) => !skip.has(`${di}-${ei}`));
            const sums = bottleSums(included);
            const t = day.totals;
            const mismatch =
              (t.a_ml != null && t.a_ml !== sums.a) ||
              (t.f_ml != null && t.f_ml !== sums.f);
            return (
              <div key={di}>
                <div className="mb-2 flex items-center gap-2">
                  <input type="date" value={day.date ?? ''}
                    onChange={(e) => setResult((r) => {
                      if (!r) return r;
                      const days = r.days.map((d, i) =>
                        i === di ? { ...d, date: e.target.value || null } : d);
                      return { ...r, days };
                    })}
                    className="rounded-lg border border-slate-200 p-1.5 text-sm" />
                  {!day.date && <span className="text-xs text-red-500">date needed</span>}
                </div>
                <ul className="divide-y divide-slate-100">
                  {day.events.map((ev, ei) => {
                    const key = `${di}-${ei}`;
                    const off = skip.has(key);
                    return (
                      <li key={key}
                        className={`flex flex-wrap items-center gap-2 py-1.5 text-sm ${
                          off ? 'opacity-40' : ''} ${
                          ev.confidence === 'low' ? 'bg-amber-50' : ''}`}>
                        <input type="checkbox" checked={!off}
                          onChange={() => setSkip((s) => {
                            const n = new Set(s);
                            if (n.has(key)) n.delete(key); else n.add(key);
                            return n;
                          })} />
                        <input type="time" value={ev.time}
                          onChange={(e) => update(di, ei, { time: e.target.value })}
                          className="rounded border border-slate-200 p-1 text-xs" />
                        {ev.kind === 'bottle' && (
                          <>
                            <span>{ev.substance === 'formula' ? '🍼 formula' : '🍼 EBM'}</span>
                            <input inputMode="numeric" value={ev.volume_ml ?? ''}
                              onChange={(e) => update(di, ei, { volume_ml: Number(e.target.value) || null })}
                              className="w-14 rounded border border-slate-200 p-1 text-center text-xs" />
                            <span className="text-xs text-slate-400">mL</span>
                          </>
                        )}
                        {ev.kind === 'direct' && (
                          <span>🤱 direct ~{ev.duration_min ?? '?'} min</span>
                        )}
                        {ev.kind === 'diaper' && (
                          <>
                            <button onClick={() => update(di, ei, { wet: !ev.wet })}
                              className={`rounded px-1.5 text-xs ${ev.wet ? 'bg-sky-100' : 'bg-slate-100 opacity-50'}`}>
                              💧 wet
                            </button>
                            <button onClick={() => update(di, ei, { dirty: !ev.dirty })}
                              className={`rounded px-1.5 text-xs ${ev.dirty ? 'bg-amber-100' : 'bg-slate-100 opacity-50'}`}>
                              💩 dirty
                            </button>
                          </>
                        )}
                        {ev.note && <span className="text-xs text-slate-400">({ev.note})</span>}
                      </li>
                    );
                  })}
                </ul>
                <p className={`mt-1 text-xs ${mismatch ? 'text-red-500' : 'text-slate-400'}`}>
                  Selected bottles: EBM {sums.a} mL · formula {sums.f} mL
                  {t.a_ml != null || t.f_ml != null
                    ? ` — notebook tally: A ${t.a_ml ?? '–'} / F ${t.f_ml ?? '–'}${mismatch ? ' → check the rows' : ' ✓'}`
                    : ''}
                </p>
              </div>
            );
          })}
          <div className="flex gap-2">
            <Chip color="#B08968" onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save selected'}
            </Chip>
            <Chip onClick={() => setResult(null)}>Discard</Chip>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
    </Card>
  );
}

/** Downscale client-side so the upload stays small (Vercel body limit ~4.5MB). */
async function toJpegBase64(file: File, maxDim = 2000):
  Promise<{ data: string; mediaType: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mediaType: 'image/jpeg' };
}
