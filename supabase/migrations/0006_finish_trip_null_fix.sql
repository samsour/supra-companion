-- Fix: finish_trip crashte, wenn ein Fahrer nur Stillstands-Samples hatte
-- (Trip gestartet und direkt beendet): die gefilterten Summen sind dann NULL
-- und verletzten das NOT NULL von distance_km/moving_secs. Jetzt coalesce auf 0.
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
    round((coalesce(sum(step_m) filter (where moving), 0) / 1000.0)::numeric, 1),
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
