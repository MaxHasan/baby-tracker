/**
 * Vercel serverless function: notebook-page photo → structured baby-care events.
 *
 * Uses Claude (claude-opus-4-8) vision with a structured-output schema, so the
 * response is guaranteed-valid JSON matching src/lib/notebook.ts types.
 * Auth: requires a valid Supabase user JWT (either parent's session).
 * Env (Vercel): ANTHROPIC_API_KEY (server-only), plus the VITE_SUPABASE_* pair.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// OPTIONAL FEATURE — handwritten paper-log OCR.
// The prompt below is an EXAMPLE tuned to one caretaker's notebook format.
// Rewrite the "Conventions" section to match how *your* paper log is written
// (columns, abbreviations, date format, language), or delete this whole
// endpoint + the NotebookImport component if you don't keep a paper log.
const SYSTEM = `You are transcribing a handwritten baby-care log. Pages are
ruled notebooks with columns: Date | time | milk | Poo + Pee | ket (notes).

Conventions:
- Times are 24-hour with a dot or colon separator: "03.40" means 03:40.
- Dates are day-first: "6/7" or "6/7 26" = 6 July 2026. A date labels a
  section; rows below belong to it until the next date. One page (or photo of
  a two-page spread) may contain several date sections — return each as its
  own day.
- Milk entries look like "60 ml F" or "80ml A": bottle volume in mL.
  A = ASI = expressed breast milk ("breast_milk"); F = formula.
  When a number is overwritten/corrected, use the correction.
- The Poo + Pee column holds checkmarks. Two checkmarks on a row = one diaper
  event with both poo and pee. A single checkmark = one diaper event; use
  horizontal position (left≈poo, right≈pee) and notes to decide which — if
  unsure, set wet=true dirty=false with confidence "low".
- "ket" notes: "Poop" marks that row's diaper as dirty. "DBF ± 15 m" (direct
  breastfeeding, ~15 minutes) becomes a "direct" event with duration_min.
  Daily tallies like "A : 420", "F: 340", "760//", "Poo: 3x", "Pee: 9x" are
  NOT events — report them in that day's totals (pee_count/poo_count from the
  "Nx" tallies).
- Emit one "bottle" event per milk row, plus a separate "diaper" event at the
  same time when the row has checkmarks.
- Anything you cannot read confidently: give your best guess with confidence
  "low" and add a human-readable warning. Never invent rows.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['days', 'warnings'],
  properties: {
    warnings: { type: 'array', items: { type: 'string' } },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'events', 'totals'],
        properties: {
          date: {
            type: ['string', 'null'],
            description: 'YYYY-MM-DD; null only if the section has no legible date',
          },
          events: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'time', 'kind', 'substance', 'volume_ml', 'duration_min',
                'wet', 'dirty', 'note', 'confidence',
              ],
              properties: {
                time: { type: 'string', description: 'HH:MM, 24h' },
                kind: { type: 'string', enum: ['bottle', 'direct', 'diaper'] },
                // enum + union type on one field is rejected by the schema
                // validator — express nullability via anyOf instead
                substance: {
                  anyOf: [
                    { type: 'string', enum: ['breast_milk', 'formula'] },
                    { type: 'null' },
                  ],
                },
                volume_ml: { type: ['integer', 'null'] },
                duration_min: { type: ['integer', 'null'] },
                wet: { type: ['boolean', 'null'] },
                dirty: { type: ['boolean', 'null'] },
                note: { type: ['string', 'null'] },
                confidence: { type: 'string', enum: ['high', 'low'] },
              },
            },
          },
          totals: {
            type: 'object',
            additionalProperties: false,
            required: ['a_ml', 'f_ml', 'total_ml', 'pee_count', 'poo_count'],
            properties: {
              a_ml: { type: ['integer', 'null'] },
              f_ml: { type: ['integer', 'null'] },
              total_ml: { type: ['integer', 'null'] },
              pee_count: { type: ['integer', 'null'] },
              poo_count: { type: ['integer', 'null'] },
            },
          },
        },
      },
    },
  },
} as const;

/** Validate the caller's Supabase JWT; return an RLS-scoped client for
 * writing the job row as that user (null = unauthorized). */
async function authedClient(req: VercelRequest): Promise<SupabaseClient | null> {
  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const authz = req.headers.authorization;
  if (!url || !anon || !authz) return null;
  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: authz },
  });
  if (!resp.ok) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured in Vercel' });
  }
  const db = await authedClient(req);
  if (!db) {
    return res.status(401).json({ error: 'Sign in to use notebook scanning' });
  }
  // Gate on caregiver status, not just a valid login: a random signup has a
  // valid JWT but no caregiver row, so this keeps our Anthropic spend behind
  // the family allow-list even though the URL is public. (RLS lets a user see
  // only their own memberships.)
  const { count: careCount } = await db
    .from('caregivers')
    .select('child_id', { count: 'exact', head: true });
  if (!careCount) {
    return res.status(403).json({ error: 'This account is not linked to a baby' });
  }

  const { image, mediaType, jobId } = (req.body ?? {}) as {
    image?: string; mediaType?: string; jobId?: string;
  };
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing image (base64)' });
  }
  if (image.length > 5_000_000) {
    return res.status(413).json({ error: 'Image too large — retake or downscale' });
  }

  // Deliver the result via the DB as well as the HTTP response: if the
  // connection drops during the long read, the app still gets the result.
  const job = async (patch: Record<string, unknown>) => {
    if (jobId) await db.from('ocr_jobs').upsert({ id: jobId, ...patch });
  };
  await job({ status: 'pending' });
  const fail = async (status: number, error: string) => {
    await job({ status: 'error', error });
    return res.status(status).json({ error });
  };

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      // medium effort: transcription follows explicit rules, doesn't need deep
      // reasoning — roughly halves latency vs the default (review UI catches slips)
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA },
        effort: 'medium',
      },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (mediaType ?? 'image/jpeg') as 'image/jpeg',
              data: image,
            },
          },
          {
            type: 'text',
            text: `Transcribe this notebook page. Today is ${
              new Date().toISOString().slice(0, 10)
            }; the log entries are from the recent past — infer years accordingly.`,
          },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return fail(502, 'The model declined to read this image');
    }
    if (response.stop_reason === 'max_tokens') {
      return fail(502, 'Page too dense — try one page per photo');
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return fail(502, 'No transcription produced');
    }
    const result = JSON.parse(text.text);
    await job({ status: 'done', result });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return fail(429, 'Rate limited — try again in a minute');
    }
    if (err instanceof Anthropic.APIError) {
      return fail(502, `Claude API error: ${err.message}`);
    }
    return fail(500, err instanceof Error ? err.message : 'Unexpected error');
  }
}
