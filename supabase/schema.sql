-- Pokemon Impostor Quiz (Supabase-only)
-- Run this in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- 1) Rooms table (used for create/join + uniqueness of room codes)
create table if not exists public.rooms (
  code text primary key,
  host_player_id text not null,
  created_at timestamptz not null default now()
);

-- 2) Room state table (single row per room, contains the entire authoritative state)
create table if not exists public.room_state (
  code text primary key references public.rooms(code) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) Rounds library (created/edited by the host)
create table if not exists public.rounds (
  id text primary key,
  category text not null check (category in ('aufzaehlen','trifft','sortieren','fakten','fehler')),
  name text not null default '',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists rounds_category_idx on public.rounds(category);
create index if not exists rounds_updated_at_idx on public.rounds(updated_at);

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ---------------------------------------------------------------------------
-- This project is intended for private use. For simplicity we allow all access
-- to these tables for anon/auth users.
alter table public.rooms enable row level security;
alter table public.room_state enable row level security;
alter table public.rounds enable row level security;

drop policy if exists "rooms_all" on public.rooms;
create policy "rooms_all" on public.rooms
  for all to public
  using (true)
  with check (true);

drop policy if exists "room_state_all" on public.room_state;
create policy "room_state_all" on public.room_state
  for all to public
  using (true)
  with check (true);

drop policy if exists "rounds_all" on public.rounds;
create policy "rounds_all" on public.rounds
  for all to public
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Realtime (so clients can subscribe to room_state changes)
-- ---------------------------------------------------------------------------
-- If you get "already a member of publication" errors, it's safe to ignore.
alter publication supabase_realtime add table public.room_state;
alter publication supabase_realtime add table public.rounds;
