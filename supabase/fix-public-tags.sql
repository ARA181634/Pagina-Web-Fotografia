-- Los nombres de etiquetas forman parte del contenido público de la galería.
-- Las relaciones de photo_tags siguen mostrando solo fotografías publicadas.

drop policy if exists "Read tags on published photos or owner" on public.tags;
drop policy if exists "Public reads tags" on public.tags;

create policy "Public reads tags"
on public.tags
for select
to anon, authenticated
using (true);

-- Mantener la escritura reservada al dueño.
-- Esta política ya debería existir; se recrea para dejar el resultado definido.
drop policy if exists "Owner manages tags" on public.tags;

create policy "Owner manages tags"
on public.tags
for all
to authenticated
using ((select public.is_site_owner()))
with check ((select public.is_site_owner()));
