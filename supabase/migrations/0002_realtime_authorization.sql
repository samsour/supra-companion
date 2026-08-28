-- Realtime broadcast authorization for private convoy channels.
-- Topic format: "trip:{uuid}" (see packages/core src/protocol.ts).
-- Covers broadcast and presence. Run after 0001_init.sql.

create policy "trip members receive convoy messages" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'trip:%'
    and public.is_trip_member(split_part(realtime.topic(), ':', 2)::uuid)
  );

create policy "trip members send convoy messages" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'trip:%'
    and public.is_trip_member(split_part(realtime.topic(), ':', 2)::uuid)
  );
