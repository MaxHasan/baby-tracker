import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Dashboard from './components/Dashboard';
import NotConfigured from './components/NotConfigured';
import QuickAdd from './components/QuickAdd';
import Timeline from './components/Timeline';
import { isConfigured, supabase } from './lib/supabase';
import type { Child } from './lib/types';

type Tab = 'log' | 'timeline' | 'dashboard';

// Rename this to whatever you like — shown on the sign-in screen and title.
const APP_NAME = 'Baby Tracker';

export default function App() {
  if (!isConfigured) return <NotConfigured />;
  return <Authed />;
}

function Authed() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase!.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <Splash text="Loading…" />;
  if (!session) return <AuthScreen />;
  return <Main onSignOut={() => supabase!.auth.signOut()} />;
}

function Splash({ text }: { text: string }) {
  return (
    <div className="flex h-dvh items-center justify-center text-slate-400">{text}</div>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signUp, setSignUp] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const auth = supabase!.auth;
    const { error } = signUp
      ? await auth.signUp({ email, password })
      : await auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    else if (signUp) setMsg('Account created — check email if confirmation is on.');
  }

  return (
    <div className="mx-auto max-w-sm p-6 pt-20">
      <h1 className="text-center text-3xl font-bold text-direct">🍼 {APP_NAME}</h1>
      <form onSubmit={submit} className="mt-8 space-y-3">
        <input
          className="w-full rounded-xl border border-slate-200 bg-white p-3"
          type="email" placeholder="email" value={email} required
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-xl border border-slate-200 bg-white p-3"
          type="password" placeholder="password" value={password} required minLength={6}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="w-full rounded-xl bg-direct p-3 font-semibold text-white">
          {signUp ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button
        className="mt-4 w-full text-center text-sm text-slate-500 underline"
        onClick={() => setSignUp(!signUp)}
      >
        {signUp ? 'Have an account? Sign in' : 'First time? Create an account'}
      </button>
      {msg && <p className="mt-4 text-center text-sm text-direct">{msg}</p>}
    </div>
  );
}

function Main({ onSignOut }: { onSignOut: () => void }) {
  const [child, setChild] = useState<Child | null>(null);
  const [dupCount, setDupCount] = useState(0);
  const [noChild, setNoChild] = useState(false);
  const [setup, setSetup] = useState({ name: '', dob: '', kg: '' });
  const [tab, setTab] = useState<Tab>('log');
  const [err, setErr] = useState('');

  // Never auto-create: an account that simply hasn't been invited yet must not
  // silently spawn a duplicate baby record. Fetch ALL visible children so we
  // can DETECT duplicates — with two records, logging and viewing can land on
  // different ones and data appears to vanish.
  const bootstrap = useCallback(async () => {
    setErr(''); setNoChild(false);
    const { data, error } = await supabase!
      .from('children').select('*').order('created_at');
    if (error) return setErr(error.message);
    if (data.length) {
      setChild(data[0] as Child); // deterministic: always the oldest
      setDupCount(data.length);
    } else {
      setNoChild(true);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function createChild() {
    const kg = Number(setup.kg.replace(',', '.'));
    if (!setup.name.trim() || !setup.dob) {
      return setErr('Enter your baby’s name and date of birth.');
    }
    // Insert WITHOUT returning the row: we only become able to SELECT it via
    // the caregiver trigger, which fires after RETURNING would be evaluated.
    const { error } = await supabase!.from('children').insert({
      name: setup.name.trim(),
      dob: setup.dob,
      birth_weight_g: kg >= 0.5 && kg <= 10 ? Math.round(kg * 1000) : null,
    });
    if (error) setErr(error.message);
    else await bootstrap();
  }

  async function invite() {
    const email = prompt('Other parent’s email (they must have an account already):');
    if (!email || !child) return;
    const { error } = await supabase!.rpc('add_caregiver_by_email', {
      child: child.id,
      caregiver_email: email,
    });
    alert(error ? `Failed: ${error.message}` : `${email} can now log for ${child.name}.`);
  }

  if (err) return <Splash text={`Error: ${err}`} />;
  if (noChild) {
    return (
      <div className="mx-auto max-w-sm p-6 pt-16 text-slate-700">
        <h1 className="text-2xl font-bold text-direct">🍼 Almost there</h1>
        <p className="mt-4 text-sm">
          This account isn't linked to a baby yet.
        </p>
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          If your co-parent already set the baby up, don't create a second
          record here — ask them to tap <i>invite parent</i> with your email,
          then tap Reload.
        </p>
        <button onClick={() => void bootstrap()}
          className="mt-3 w-full rounded-xl border border-slate-300 p-3 font-semibold">
          🔄 Reload (after being invited)
        </button>

        <h2 className="mt-6 text-sm font-bold text-slate-600">
          Otherwise, first parent — set the baby up once:
        </h2>
        <div className="mt-2 space-y-2">
          <input value={setup.name} placeholder="Baby's name"
            onChange={(e) => setSetup((s) => ({ ...s, name: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 p-3" />
          <label className="block text-xs text-slate-400">Date of birth
            <input type="date" value={setup.dob} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setSetup((s) => ({ ...s, dob: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 p-3" />
          </label>
          <input inputMode="decimal" value={setup.kg} placeholder="Birth weight kg (optional)"
            onChange={(e) => setSetup((s) => ({ ...s, kg: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 p-3" />
          <button onClick={() => void createChild()}
            className="w-full rounded-xl bg-direct p-3 font-semibold text-white">
            Create baby record
          </button>
        </div>
        <button onClick={onSignOut}
          className="mt-4 w-full text-center text-sm text-slate-400 underline">
          sign out
        </button>
      </div>
    );
  }
  if (!child) return <Splash text="Setting things up…" />;

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-xl font-bold text-direct">👶 {child.name}</h1>
        <div className="space-x-3 text-xs text-slate-400">
          <button className="underline" onClick={invite}>invite parent</button>
          <button className="underline" onClick={onSignOut}>sign out</button>
        </div>
      </header>

      {dupCount > 1 && (
        <div className="mx-4 mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          ⚠ {dupCount} baby records exist for this account — logs can split
          between them and appear to vanish. Keep one record and re-point the
          others' events to it (see the README “duplicate records” note).
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 pb-24">
        {tab === 'log' && <QuickAdd childId={child.id} />}
        {tab === 'timeline' && <Timeline childId={child.id} />}
        {tab === 'dashboard' && <Dashboard child={child} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md border-t border-slate-200 bg-white/95 backdrop-blur">
        {(
          [
            ['log', '➕', 'Log'],
            ['timeline', '📜', 'Timeline'],
            ['dashboard', '📊', 'Dashboard'],
          ] as [Tab, string, string][]
        ).map(([t, icon, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-center text-sm ${
              tab === t ? 'font-bold text-direct' : 'text-slate-400'
            }`}
          >
            <span className="block text-lg">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
