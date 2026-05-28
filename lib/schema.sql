-- ============================================================================
-- good chats · supabase schema
-- run this entire file in Supabase > SQL Editor > New query > Run
-- safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS)
-- ============================================================================

-- enable extensions
create extension if not exists "uuid-ossp";

-- ============================================================================
-- HOSTS · who's allowed to run sessions
-- ============================================================================
create table if not exists hosts (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  display_name text,
  is_approved boolean default false,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- auto-create a host record when someone signs up via magic link
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.hosts (id, email, display_name, is_approved)
  values (new.id, new.email, split_part(new.email, '@', 1), false)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- SESSIONS · a single speed networking event
-- ============================================================================
create table if not exists sessions (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,                  -- url slug, e.g. "november-gather"
  name text not null,
  host_id uuid references hosts(id) on delete set null,
  status text not null default 'draft',       -- draft | live | running_round | between_rounds | closing | ended
  rounds_total int not null default 6,
  round_seconds int not null default 300,
  break_seconds int not null default 15,      -- between rounds
  current_round int default 0,
  current_round_started_at timestamptz,       -- when the current round opened
  main_room_name text,                        -- daily.co room name for the main room
  prompts jsonb default '[]'::jsonb,          -- ordered list: [{ id, text, tag }]
  created_at timestamptz default now(),
  ended_at timestamptz,
  metadata jsonb default '{}'::jsonb
);
create index if not exists idx_sessions_code on sessions(code);
create index if not exists idx_sessions_status on sessions(status);

-- ============================================================================
-- PROFILES · persistent contact info shared across sessions, keyed by email
-- ============================================================================
create table if not exists profiles (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  display_name text not null,
  linkedin_url text,
  newsletter_opt_in boolean default true,
  kit_synced_at timestamptz,                  -- when we last sent this email to Kit
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_profiles_email on profiles(email);

-- ============================================================================
-- PARTICIPANTS · people who joined a session
-- linked to a profile when the joiner provided email; no profile for legacy rows
-- ============================================================================
create table if not exists participants (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  name text not null,
  joined_at timestamptz default now(),
  left_at timestamptz,
  is_present boolean default true,
  current_room_name text,
  metadata jsonb default '{}'::jsonb
);

-- backfill: ensure profile_id column exists on legacy participants tables.
-- must run BEFORE the index below.
alter table participants add column if not exists profile_id uuid references profiles(id) on delete set null;

-- heartbeat timestamp · updated on every state poll. used to detect real disconnects
-- vs. brief refreshes (a refreshing participant updates this within ~2s).
alter table participants add column if not exists last_seen timestamptz default now();

create index if not exists idx_participants_session on participants(session_id);
create index if not exists idx_participants_present on participants(session_id, is_present);
create index if not exists idx_participants_profile on participants(profile_id);

-- ============================================================================
-- ROUNDS · history of who paired with whom each round
-- ============================================================================
create table if not exists rounds (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  round_number int not null,
  prompt_text text,
  started_at timestamptz default now(),
  ended_at timestamptz,
  unique (session_id, round_number)
);
create index if not exists idx_rounds_session on rounds(session_id);

-- ============================================================================
-- PAIRINGS · individual matches within a round
-- ============================================================================
create table if not exists pairings (
  id uuid primary key default uuid_generate_v4(),
  round_id uuid not null references rounds(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  participant_a_id uuid not null references participants(id) on delete cascade,
  participant_b_id uuid references participants(id) on delete cascade,  -- null if sit-out
  room_name text,                                                        -- daily.co room name
  room_label text,                                                       -- pretty name e.g. "mom's kitchen table"
  created_at timestamptz default now()
);
create index if not exists idx_pairings_round on pairings(round_id);
create index if not exists idx_pairings_session on pairings(session_id);
create index if not exists idx_pairings_a on pairings(participant_a_id);
create index if not exists idx_pairings_b on pairings(participant_b_id);

-- ============================================================================
-- CAPTURES · "save this connection" button taps
-- snapshots captured profile's contact info at capture time so the recap survives
-- if the profile changes later
-- ============================================================================
create table if not exists captures (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  capturer_id uuid not null references participants(id) on delete cascade,
  captured_id uuid not null references participants(id) on delete cascade,
  pairing_id uuid references pairings(id) on delete set null,
  captured_email text,                         -- snapshot of captured person's email at capture time
  captured_linkedin_url text,                  -- snapshot of captured person's linkedin
  captured_name text,                          -- snapshot of captured person's display name
  note text,
  created_at timestamptz default now()
);
create index if not exists idx_captures_session on captures(session_id);
create index if not exists idx_captures_capturer on captures(capturer_id);

-- backfill: add capture snapshot columns (idempotent)
alter table captures add column if not exists captured_email text;
alter table captures add column if not exists captured_linkedin_url text;
alter table captures add column if not exists captured_name text;

-- ============================================================================
-- RATE_LIMITS · sliding-window request tracking per IP/key
-- ============================================================================
create table if not exists rate_limits (
  id uuid primary key default uuid_generate_v4(),
  bucket text not null,                       -- e.g. "join:abc-123:1.2.3.4"
  ts timestamptz default now()
);
create index if not exists idx_rate_limits_bucket_ts on rate_limits(bucket, ts);

-- helper: count rows in bucket within last N seconds
create or replace function public.count_rate_limit(p_bucket text, p_window_seconds int)
returns int as $$
  select count(*)::int
  from rate_limits
  where bucket = p_bucket
    and ts > now() - (p_window_seconds || ' seconds')::interval;
$$ language sql security definer;

-- cleanup helper: deletes rate_limit rows older than 1 hour. call from cron or manually.
create or replace function public.cleanup_rate_limits()
returns void as $$
  delete from rate_limits where ts < now() - interval '1 hour';
$$ language sql security definer;

-- ============================================================================
-- ROW LEVEL SECURITY · deny-by-default
-- service role bypasses RLS, so server-side API routes (which use service_role)
-- still have full access. anon clients have no direct access to any table —
-- everything goes through API routes.
-- ============================================================================
alter table hosts enable row level security;
alter table sessions enable row level security;
alter table participants enable row level security;
alter table rounds enable row level security;
alter table pairings enable row level security;
alter table captures enable row level security;
alter table rate_limits enable row level security;
alter table profiles enable row level security;

-- hosts: authenticated host reads self only.
drop policy if exists "hosts read self" on hosts;
create policy "hosts read self" on hosts
  for select using (auth.uid() = id);

-- sessions: authenticated host can read+write own sessions only.
drop policy if exists "sessions host all" on sessions;
create policy "sessions host all" on sessions
  for all using (auth.uid() = host_id);

-- explicitly drop the old loose policies if they exist (cleanup from earlier schema)
drop policy if exists "sessions public read" on sessions;
drop policy if exists "participants public read" on participants;
drop policy if exists "participants public insert" on participants;
drop policy if exists "rounds public read" on rounds;
drop policy if exists "pairings public read" on pairings;
drop policy if exists "captures public" on captures;

-- intentionally no anon policies on participants / rounds / pairings / captures / rate_limits.
-- anon clients can't read or write. server uses service_role and bypasses RLS.
-- if you ever expose the supabase client to the browser for any of these, REVISIT THIS.

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================
create or replace view session_stats as
select
  s.id as session_id,
  s.code,
  s.name,
  s.status,
  count(distinct p.id) filter (where p.is_present) as live_count,
  count(distinct p.id) as total_joined,
  count(distinct pa.id) as total_pairings,
  count(distinct c.id) as total_captures
from sessions s
left join participants p on p.session_id = s.id
left join pairings pa on pa.session_id = s.id
left join captures c on c.session_id = s.id
group by s.id;

-- ============================================================================
-- APPROVAL · run this AFTER the host signs up via magic link the first time.
-- replace with real emails. only approved hosts can access /host/*.
-- ============================================================================
-- update hosts set is_approved = true, is_admin = true where email = 'nelvin@givingbridgeconsulting.com';
-- update hosts set is_approved = true where email = 'jon@weareforgood.com';
-- update hosts set is_approved = true where email = 'becky@weareforgood.com';
