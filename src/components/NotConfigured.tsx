export default function NotConfigured() {
  return (
    <div className="mx-auto max-w-md p-6 pt-16 text-slate-700">
      <h1 className="text-2xl font-bold text-direct">🍼 Baby Tracker</h1>
      <p className="mt-4">
        The app isn't connected to Supabase yet. One-time setup:
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
        <li>
          Create a free project at <b>supabase.com</b> (region close to home).
        </li>
        <li>
          In the project: <b>SQL Editor → New query</b> → paste and run{' '}
          <code>supabase/schema.sql</code> from this repo.
        </li>
        <li>
          Copy <b>Project Settings → API</b> values into <code>.env.local</code>{' '}
          (see <code>.env.example</code>).
        </li>
        <li>
          Restart <code>npm run dev</code>.
        </li>
      </ol>
      <p className="mt-4 text-sm text-slate-500">
        Full instructions: <code>README.md</code>.
      </p>
    </div>
  );
}
