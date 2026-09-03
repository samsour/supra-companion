-- Spectator Mode: eigener Zuschauer-Code pro Trip, Rolle 'spectator',
-- stiller Beitritt per RPC. Zuschauer hören den Konvoi-Channel mit,
-- senden nie und tauchen in Fahrer-Sichten nicht auf.

alter table public.trips add column spectator_code text;
update public.trips
  set spectator_code = upper(substring(md5(gen_random_uuid()::text) from 1 for 6))
  where spectator_code is null;
alter table public.trips alter column spectator_code set not null;
create unique index trips_spectator_code_key on public.trips (spectator_code);

alter table public.trip_members drop constraint trip_members_role_check;
alter table public.trip_members add constraint trip_members_role_check
  check (role in ('organizer', 'driver', 'passenger', 'spectator'));

create or replace function public.create_trip(
  p_name text, p_handle text, p_car_model text default null, p_car_color text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into trips (name, organizer_id, invite_code, spectator_code)
    values (
      p_name, auth.uid(),
      upper(substring(md5(gen_random_uuid()::text) from 1 for 6)),
      upper(substring(md5(gen_random_uuid()::text) from 1 for 6))
    )
    returning id into v_id;
  insert into trip_members (trip_id, user_id, handle, car_model, car_color, role)
    values (v_id, auth.uid(), p_handle, p_car_model, p_car_color, 'organizer');
  return v_id;
end;
$$;

create or replace function public.duplicate_trip(
  p_trip uuid, p_handle text, p_car_model text default null, p_car_color text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_new uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_trip_member(p_trip) then raise exception 'not a member of this trip'; end if;
  insert into trips (name, organizer_id, invite_code, spectator_code, route_geojson, route_waypoints)
    select name || ' (Kopie)', auth.uid(),
      upper(substring(md5(gen_random_uuid()::text) from 1 for 6)),
      upper(substring(md5(gen_random_uuid()::text) from 1 for 6)),
      route_geojson, route_waypoints
    from trips where id = p_trip
    returning id into v_new;
  insert into trip_members (trip_id, user_id, handle, car_model, car_color, role)
    values (v_new, auth.uid(), p_handle, p_car_model, p_car_color, 'organizer');
  insert into checkpoints (trip_id, name, kind, lat, lng, order_idx)
    select v_new, name, kind, lat, lng, order_idx from checkpoints where trip_id = p_trip;
  return v_new;
end;
$$;

create or replace function public.join_as_spectator(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_id from trips where spectator_code = upper(trim(p_code));
  if v_id is null then raise exception 'Ungültiger Zuschauer-Link'; end if;
  insert into trip_members (trip_id, user_id, handle, role, share_location)
    values (v_id, auth.uid(), 'Zuschauer', 'spectator', false)
    on conflict (trip_id, user_id) do nothing;
  return v_id;
end;
$$;
