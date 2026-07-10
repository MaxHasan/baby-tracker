# Baby Tracker

A private, self-hosted baby-tracking web app for two or more parents on separate phones
with realtime sync. Log feeds, pumping, sleep, diapers and growth; see a
dashboard with intake vs. a weight-scaled target, formula share, breast-milk
supply, sleep and diaper adequacy.

Installs to the home screen as a progressive web app (PWA), runs free on Supabase +
Vercel, and every parent's data stays in **their own** Supabase project.

## Why it exists

Most trackers model a feed as a single "type", which loses information. This app
keeps feeds on **two independent axes**:

- **Delivery** — direct at the breast vs. bottle
- **Substance** — expressed breast milk vs. formula

A bottle of expressed milk shares its *substance* with a direct latch but its
*delivery* with formula. Keeping these separate is what makes the KPIs (formula
share, supply vs. demand, direct-vs-bottle balance) meaningful.

## Features

- Two-parent access with realtime sync (Supabase Realtime + row-level security)
- Quick-add for bottle, direct breastfeed (with a per-side nursing timer),
  pump (L/R), diaper, sleep, and weigh-ins — each loggable retroactively
- Dashboard: daily intake by source vs. a weight-scaled target
  (~150 mL/kg/day), formula % (today / 7-day / all-time), breast-milk supply
  (direct estimate + pumped L/R), rolling-24h diaper adequacy, sleep
- Optional: import history from a previous tracker's CSV export
- Optional: OCR a photo of a handwritten paper log via the Anthropic API

> **Not medical advice.** Estimates (especially direct-breast intake, which
> can't be measured) are modeled, not measured. Weight checks with your
> pediatrician remain the source of truth.

## Tech

Vite + React + TypeScript, Tailwind, Recharts, `vite-plugin-pwa`; Supabase
(Postgres + Auth + Realtime) backend; deploys on Vercel. The optional OCR
endpoint (`api/ocr.ts`) is a Vercel serverless function calling the Anthropic API.

## Self-host it

You need free **Supabase** and **Vercel** accounts, and Node 20+.

### 1. Supabase

1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → run.
   This creates the tables, row-level security, the caregiver model, and realtime.
3. **Authentication → Sign In / Providers → Email**: for a private family app,
   turn **off** "Allow new users to sign up" after both parents have created
   their accounts (invite-only). Optionally disable email confirmation for two
   known users.
4. **Project Settings → API**: copy the Project URL and the publishable (anon)
   key.

### 2. Run locally

```bash
cp .env.example .env.local     # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Sign up (both parents). The **first** parent fills in the baby's name / DOB /
birth weight once. The second parent signs up, then the first taps **invite
parent** and enters their email — this links both accounts to the one baby.
Don't create a second baby record (see *Duplicate records* below).

### 3. Deploy

Push to GitHub, import the repo in Vercel (framework auto-detects Vite), add the
two `VITE_*` environment variables, and deploy. On each phone, open the URL and
**Add to Home Screen** (iOS Safari) / **Install app** (Android Chrome) for the
standalone PWA.

### 4. Optional — import history from a CSV

If your previous tracker exports a CSV (see the column format in
[`src/lib/csv-import.ts`](src/lib/csv-import.ts)), you can bulk-import it:

```bash
# dry run — parses and prints a daily summary, writes nothing
npm run import:dry -- "path/to/export.csv"
# apply — needs SUPABASE_SERVICE_ROLE_KEY in .env.local
npm run import -- "path/to/export.csv" --apply
```

Timestamps in these exports are local wall-clock with no timezone, so run the
import on a machine set to the timezone the log was recorded in. Imports are
idempotent — re-running on an overlapping export only adds new rows.

### 5. Optional — paper-log OCR

If a caregiver keeps a handwritten log, `api/ocr.ts` can transcribe a photo of
a page via the Anthropic API into reviewable entries.

1. Get an API key from console.anthropic.com.
2. In Vercel → Settings → Environment Variables, add `ANTHROPIC_API_KEY`
   (server-only — **no** `VITE_` prefix) and redeploy.
3. The prompt in `api/ocr.ts` is tuned to one specific notebook format — edit
   its "Conventions" section to match how *your* log is written, or remove the
   endpoint and the "Caretaker's notebook" card if you don't need it.

## Notes

**Duplicate records.** The app never auto-creates a baby, but if two records
ever exist for one baby (e.g. both parents tapped "create" before inviting),
logging and viewing can land on different ones and data appears to vanish. The
app warns you when it sees more than one. To fix: pick the record to keep and
re-point the others' rows to it in SQL, e.g.

```sql
-- replace with the id to KEEP and the id to MERGE from
update feeds   set child_id = 'KEEP' where child_id = 'DROP';
update pumps   set child_id = 'KEEP' where child_id = 'DROP';
update diapers set child_id = 'KEEP' where child_id = 'DROP';
update sleeps  set child_id = 'KEEP' where child_id = 'DROP';
update growth  set child_id = 'KEEP' where child_id = 'DROP';
delete from children where id = 'DROP';
```

## License

MIT — see [LICENSE](LICENSE).
