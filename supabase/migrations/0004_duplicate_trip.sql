-- Duplicate a trip's route + checkpoints into a fresh trip (caller becomes
-- organizer). Serves three purposes: day-by-day copies on multi-day trips,
-- template routes, and recovery if an organizer's anonymous session is lost.
-- Any member of the source trip may duplicate it.

create or replace function public.duplicate_trip(
  p_trip uuid, p_handle text, p_car_model text default null, p_car_color text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_trip_member(p_trip) then raise exception 'not a member of this trip'; end if;
  v_code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  insert into trips (name, organizer_id, invite_code, route_geojson, route_waypoints)
    select name || ' (Kopie)', auth.uid(), v_code, route_geojson, route_waypoints
    from trips where id = p_trip
    returning id into v_new;
  insert into trip_members (trip_id, user_id, handle, car_model, car_color, role)
    values (v_new, auth.uid(), p_handle, p_car_model, p_car_color, 'organizer');
  insert into checkpoints (trip_id, name, kind, lat, lng, order_idx)
    select v_new, name, kind, lat, lng, order_idx from checkpoints where trip_id = p_trip;
  return v_new;
end;
$$;
