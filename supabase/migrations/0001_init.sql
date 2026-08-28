-- Supra Companion — initial schema, RLS, RPCs, realtime authorization.
-- Run in the Supabase SQL editor (or `supabase db push` if using the CLI).
-- Prerequisite: enable Anonymous sign-ins (Dashboard → Authentication).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  status        text not null default 'draft' check (status in ('draft','live','ended')),
  organizer_id  uuid not null references auth.users (id),
  route_geojson jsonb,
  starts_at     timestamptz,
  invite_code   text not null unique,
  created_at    timestamptz not null default now()
);

create table public.trip_members (
  trip_id        uuid not null references public.trips (id) on delete cascade,
  user_id        uuid not null references auth.users (id),
  handle         text not null,
  car_model      text,
  car_color      text,
  role           text not null default 'driver' check (role in ('organizer','driver','passenger')),
  share_location boolean not null default true,
  joined_at      timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table public.checkpoints (
  id        uuid primary key default gen_random_uuid(),
  trip_id   uuid not null references public.trips (id) on delete cascade,
  name      text not null,
  kind      text not null default 'meet' check (kind in ('fuel','food','photo','meet')),
  lat       double precision not null,
  lng       double precision not null,
  order_idx int not null
);

create table public.location_samples (
  id       bigint generated always as identity primary key,
  trip_id  uuid not null references public.trips (id) on delete cascade,
  user_id  uuid not null references auth.users (id),
  lat      double precision not null,
  lng      double precision not null,
  speed    real,
  heading  real,
  accuracy real,
  ts       timestamptz not null
);
create index location_samples_trip_user_ts on public.location_samples (trip_id, user_id, ts);

create table public.trip_stats (
  trip_id         uuid not null references public.trips (id) on delete cascade,
  user_id         uuid not null references auth.users (id),
  distance_km     numeric not null default 0,
  moving_secs     int not null default 0,
  avg_speed_kmh   numeric,
  top_speed_kmh   numeric,
  checkpoints_hit int not null default 0,
  computed_at     timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- ------------------------------------------------------------- membership

-- security definer so RLS policies can check membership without recursing
-- into trip_members' own policies
create or replace function public.is_trip_member(tid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from trip_members
    where trip_id = tid and user_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------------- RLS

alter table public.trips            enable row level security;
alter table public.trip_members     enable row level security;
alter table public.checkpoints      enable row level security;
alter table public.location_samples enable row level security;
alter table public.trip_stats       enable row level security;

create policy "members read trips" on public.trips
  for select to authenticated
  using (public.is_trip_member(id) or organizer_id = auth.uid());

create policy "organizer updates trip" on public.trips
  for update to authenticated
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

create policy "members read members" on public.trip_members
  for select to authenticated
  using (public.is_trip_member(trip_id));

create policy "member updates own row" on public.trip_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "members read checkpoints" on public.checkpoints
  for select to authenticated
  using (public.is_trip_member(trip_id));

create policy "organizer manages checkpoints" on public.checkpoints
  for all to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.organizer_id = auth.uid()))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.organizer_id = auth.uid()));

create policy "member inserts own samples on live trip" on public.location_samples
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_trip_member(trip_id)
    and exists (select 1 from public.trips t where t.id = trip_id and t.status = 'live')
  );

create policy "members read samples" on public.location_samples
  for select to authenticated
  using (public.is_trip_member(trip_id));

create policy "members read stats" on public.trip_stats
  for select to authenticated
  using (public.is_trip_member(trip_id));

-- trip creation and joining go through the RPCs below (no direct inserts):
-- joining must validate an invite code the user can't otherwise read.

-- ------------------------------------------------------------------ RPCs

create or replace function public.create_trip(
  p_name text, p_handle text, p_car_model text default null, p_car_color text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  insert into trips (name, organizer_id, invite_code)
    values (p_name, auth.uid(), v_code)
    returning id into v_id;
  insert into trip_members (trip_id, user_id, handle, car_model, car_color, role)
    values (v_id, auth.uid(), p_handle, p_car_model, p_car_color, 'organizer');
  return v_id;
end;
$$;

create or replace function public.join_trip(
  p_code text, p_handle text, p_car_model text default null, p_car_color text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_id from trips where invite_code = upper(trim(p_code)) and status <> 'ended';
  if v_id is null then raise exception 'invalid invite code'; end if;
  insert into trip_members (trip_id, user_id, handle, car_model, car_color)
    values (v_id, auth.uid(), p_handle, p_car_model, p_car_color)
    on conflict (trip_id, user_id) do update
      set handle = excluded.handle,
          car_model = excluded.car_model,
          car_color = excluded.car_color;
  return v_id;
end;
$$;

-- Trip-end aggregation (organizer only). Mirrors packages/core stats filters:
-- accuracy <= 30 m, implied speed <= 250 km/h, moving >= 1.5 m/s.
create or replace function public.finish_trip(p_trip uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (select 1 from trips where id = p_trip and organizer_id = auth.uid()) then
    raise exception 'only the organizer can finish a trip';
  end if;

  update trips set status = 'ended' where id = p_trip;

  insert into trip_stats (trip_id, user_id, distance_km, moving_secs, avg_speed_kmh, top_speed_kmh)
  select
    p_trip,
    user_id,
    round((sum(step_m) filter (where moving) / 1000.0)::numeric, 1),
    coalesce(sum(least(dt_s, 120)) filter (where moving), 0)::int,
    case when coalesce(sum(least(dt_s, 120)) filter (where moving), 0) > 0
      then round((sum(step_m) filter (where moving)
                  / sum(least(dt_s, 120)) filter (where moving) * 3.6)::numeric, 1)
    end,
    round((max(implied_mps) filter (where moving) * 3.6)::numeric, 1)
  from (
    select
      user_id, step_m, dt_s,
      case when dt_s > 0 then step_m / dt_s else 0 end as implied_mps,
      (dt_s > 0 and step_m / dt_s between 1.5 and (250 / 3.6)) as moving
    from (
      select
        user_id,
        extract(epoch from ts - lag(ts) over w) as dt_s,
        2 * 6371000 * asin(least(1, sqrt(
          power(sin(radians(lat - lag(lat) over w) / 2), 2)
          + cos(radians(lag(lat) over w)) * cos(radians(lat))
            * power(sin(radians(lng - lag(lng) over w) / 2), 2)
        ))) as step_m
      from location_samples
      where trip_id = p_trip and (accuracy is null or accuracy <= 30)
      window w as (partition by user_id order by ts)
    ) steps
    where dt_s is not null
  ) filtered
  group by user_id
  on conflict (trip_id, user_id) do update
    set distance_km = excluded.distance_km,
        moving_secs = excluded.moving_secs,
        avg_speed_kmh = excluded.avg_speed_kmh,
        top_speed_kmh = excluded.top_speed_kmh,
        computed_at = now();
end;
$$;

-- Realtime channel authorization lives in 0002_realtime_authorization.sql
-- (separate file so an issue there can't roll back the core schema).
