-- Replay-Spuren als eine schnelle Server-Funktion statt REST-Pagination:
-- Die RLS-Policy auf location_samples ruft is_trip_member() pro Zeile auf —
-- bei zigtausenden Samples läuft das in den statement_timeout. Hier wird die
-- Mitgliedschaft einmal geprüft (security definer umgeht die Policy), die
-- Spur serverseitig auf max. p_max_per_driver Punkte je Fahrer ausgedünnt
-- und kompakt als ein einziges JSONB ([lng, lat, ts_ms]-Tripel) geliefert.
create or replace function public.get_trip_track(p_trip uuid, p_max_per_driver int default 1500)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_trip_member(p_trip) then
    raise exception 'kein Zugriff auf diesen Trip';
  end if;

  with s as (
    select user_id, lat, lng, ts,
           row_number() over (partition by user_id order by ts, id) as rn,
           count(*) over (partition by user_id) as n
    from location_samples
    where trip_id = p_trip
      and (accuracy is null or accuracy <= 30)
  ), thinned as (
    select user_id, lat, lng, ts
    from s
    where n <= p_max_per_driver
       or rn % greatest(1, ceil(n::numeric / p_max_per_driver))::int = 1
       or rn = n
  )
  select coalesce(jsonb_object_agg(user_id, pts), '{}'::jsonb)
    into v
  from (
    select user_id,
           jsonb_agg(
             jsonb_build_array(
               round(lng::numeric, 6),
               round(lat::numeric, 6),
               (extract(epoch from ts) * 1000)::bigint
             )
             order by ts
           ) as pts
    from thinned
    group by user_id
  ) g;

  return v;
end;
$$;
