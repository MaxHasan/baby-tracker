-- Baby Tracker — Supabase schema (run once in SQL Editor: Dashboard → SQL → New query)
-- Two-axis feed model: delivery (breast|bottle) × substance (breast_milk|formula).
-- NEVER collapse these — every KPI depends on the separation.

create type feed_delivery as enum ('breast', 'bottle');
create type feed_substance as enum ('breast_milk', 'formula');
create type breast_side as enum ('L', 'R', 'both');

-- ---------------------------------------------------------------- children --
create table children (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dob date not null,
  birth_weight_g int,
  created_at timestamptz not null default now()
);

-- Two-parent access: membership junction against Supabase auth users.
create table caregivers (
  child_id uuid not null references children (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (child_id, user_id)
);

-- ------------------------------------------------------------------ events --
create table feeds (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  ts timestamptz not null,
  delivery feed_delivery not null,
  substance feed_substance not null,
  volume_ml int check (volume_ml is null or volume_ml between 0 and 500),
  duration_min int check (duration_min is null or duration_min between 0 and 240),
  side breast_side,
  note text,
  -- natural key for idempotent CSV import; app rows get a random one
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- direct feeds are always breast milk and never have a measured volume
  constraint direct_is_breast_milk
    check (delivery = 'bottle' or substance = 'breast_milk'),
  constraint direct_has_no_volume
    check (delivery = 'bottle' or volume_ml is null)
);

create table pumps (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  ts timestamptz not null,
  left_ml int check (left_ml is null or left_ml between 0 and 500),
  right_ml int check (right_ml is null or right_ml between 0 and 500),
  total_ml int not null check (total_ml between 0 and 1000),
  duration_min int,
  note text,
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table diapers (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  ts timestamptz not null,
  wet boolean not null default false,
  dirty boolean not null default false,
  stool_colour text,
  note text,
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table sleeps (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  start_ts timestamptz not null,
  end_ts timestamptz,                   -- null while the sleep timer is running
  note text,
  source_key text not null default gen_random_uuid()::text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint sleep_ends_after_start check (end_ts is null or end_ts >= start_ts)
);

create table growth (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  measured_at date not null,
  weight_g int check (weight_g is null or weight_g between 1000 and 30000),
  length_cm numeric(5, 1),
  head_cm numeric(5, 1),
  note text,
  logged_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- idempotent CSV re-imports: same source row can never duplicate
create unique index feeds_source_key on feeds (child_id, source_key);
create unique index pumps_source_key on pumps (child_id, source_key);
create unique index diapers_source_key on diapers (child_id, source_key);
create unique index sleeps_source_key on sleeps (child_id, source_key);

create index feeds_child_ts on feeds (child_id, ts desc);
create index pumps_child_ts on pumps (child_id, ts desc);
create index diapers_child_ts on diapers (child_id, ts desc);
create index sleeps_child_ts on sleeps (child_id, start_ts desc);
create index growth_child_ts on growth (child_id, measured_at desc);

-- ------------------------------------------------------- helper + policies --
-- true when the signed-in user is a caregiver of the child
create or replace function is_caregiver(child uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from caregivers
                  where child_id = child and user_id = auth.uid()) $$;

-- whoever creates a child automatically becomes its first caregiver
create or replace function add_creator_as_caregiver()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into caregivers (child_id, user_id) values (new.id, auth.uid());
  return new;
end $$;

create trigger children_creator_caregiver
  after insert on children
  for each row execute function add_creator_as_caregiver();

-- parent A invites parent B (B must have signed up already)
create or replace function add_caregiver_by_email(child uuid, caregiver_email text)
returns void language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if not is_caregiver(child) then
    raise exception 'only an existing caregiver can invite';
  end if;
  select id into target from auth.users where lower(email) = lower(caregiver_email);
  if target is null then
    raise exception 'no account with that email — they need to sign up first';
  end if;
  insert into caregivers (child_id, user_id)
  values (child, target) on conflict do nothing;
end $$;

alter table children enable row level security;
alter table caregivers enable row level security;
alter table feeds enable row level security;
alter table pumps enable row level security;
alter table diapers enable row level security;
alter table sleeps enable row level security;
alter table growth enable row level security;

create policy "caregivers read child" on children
  for select using (is_caregiver(id));
create policy "caregivers update child" on children
  for update using (is_caregiver(id));
create policy "any signed-in user may create a child" on children
  for insert with check (auth.uid() is not null);

create policy "see own memberships" on caregivers
  for select using (user_id = auth.uid() or is_caregiver(child_id));

-- one uniform policy set per event table
create policy "caregiver all" on feeds   for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
create policy "caregiver all" on pumps   for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
create policy "caregiver all" on diapers for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
create policy "caregiver all" on sleeps  for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));
create policy "caregiver all" on growth  for all
  using (is_caregiver(child_id)) with check (is_caregiver(child_id));

-- realtime: both phones see each other's edits instantly
alter publication supabase_realtime
  add table feeds, pumps, diapers, sleeps, growth;

-- ---------------------------------------------------- provenance + OCR jobs --
-- Where each event came from: logged in-app, imported from a CSV, or read from
-- a photo of a paper log via the optional OCR feature.
alter table feeds   add column source text not null default 'app'
  check (source in ('app', 'csv', 'notebook'));
alter table pumps   add column source text not null default 'app'
  check (source in ('app', 'csv', 'notebook'));
alter table diapers add column source text not null default 'app'
  check (source in ('app', 'csv', 'notebook'));
alter table sleeps  add column source text not null default 'app'
  check (source in ('app', 'csv', 'notebook'));

-- Optional OCR pipeline (api/ocr.ts) delivers its result via this table as
-- well as the HTTP response, so a dropped connection during the long read
-- doesn't lose the transcription.
create table ocr_jobs (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);
alter table ocr_jobs enable row level security;
create policy "own jobs" on ocr_jobs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
