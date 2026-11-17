-- Demandes spéciales (hors catalogue) avec devis joint
alter table public.demandes add column if not exists devis_path text;
alter table public.demandes add column if not exists devis_num text;

-- Stockage privé des devis (lisibles par les personnes connectées uniquement)
insert into storage.buckets (id, name, public) values ('devis', 'devis', false) on conflict (id) do nothing;
drop policy if exists "devis depot" on storage.objects;
create policy "devis depot" on storage.objects for insert to authenticated with check (bucket_id = 'devis');
drop policy if exists "devis lecture" on storage.objects;
create policy "devis lecture" on storage.objects for select to authenticated using (bucket_id = 'devis');

create or replace function public.creer_speciale(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_n1 uuid;
  v_f bigint;
  v_id bigint;
  v_nom text := trim(p->>'fournisseur');
  v_qte int := (p->>'qte')::int;
  v_pu numeric := (p->>'pu')::numeric;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if coalesce(trim(p->>'designation'), '') = '' then raise exception 'Désignation obligatoire'; end if;
  if coalesce(v_nom, '') = '' then raise exception 'Fournisseur obligatoire'; end if;
  if v_qte is null or v_qte <= 0 then raise exception 'Quantité invalide'; end if;
  if v_pu is null or v_pu < 0 then raise exception 'Prix invalide'; end if;
  select n1_id into v_n1 from profiles where id = auth.uid();
  if v_n1 is null then raise exception 'Aucun N+1 rattaché à ton compte : demande à l''admin.'; end if;

  select id into v_f from fournisseurs where lower(trim(nom)) = lower(v_nom) limit 1;
  if v_f is null then insert into fournisseurs (nom) values (v_nom) returning id into v_f; end if;

  insert into demandes (demandeur_id, n1_id, fournisseur_id, fournisseur_nom, agence, commentaire, statut, type, urgent, devis_path, devis_num)
  values (auth.uid(), v_n1, v_f, v_nom, p->>'agence', nullif(trim(p->>'commentaire'), ''), 'tri', 'speciale',
          coalesce((p->>'urgent')::boolean, false), nullif(p->>'devis_path', ''), nullif(trim(p->>'devis_num'), ''))
  returning id into v_id;

  insert into lignes (demande_id, designation, qte, pu) values (v_id, trim(p->>'designation'), v_qte, v_pu);
  return v_id;
end $$;
grant execute on function public.creer_speciale(jsonb) to authenticated;
