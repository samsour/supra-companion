-- The organizer's picked waypoints ([lng, lat] pairs), kept alongside the
-- resulting route geometry so the route stays editable after saving.
alter table public.trips add column route_waypoints jsonb;
