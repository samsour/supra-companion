-- Organizers may delete their trips; members, checkpoints, samples and
-- stats go with them via the existing ON DELETE CASCADE constraints.
create policy "organizer deletes trip" on public.trips
  for delete to authenticated
  using (organizer_id = auth.uid());
