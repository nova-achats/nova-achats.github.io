-- Demande spéciale : plusieurs lignes (articles du devis, frais de port…)
create or replace function public.creer_speciale(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_n1 uuid;
  v_f bigint;
  v_id bigint;
  v_nom text := trim(p->>'fournisseur');
  l jsonb;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if coalesce(v_nom, '') = '' then raise exception 'Fournisseur obligatoire'; end if;
  select n1_id into v_n1 from profiles where id = auth.uid();
  if v_n1 is null then raise exception 'Aucun N+1 rattaché à ton compte : demande à l''admin.'; end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lignes', '[]')) loop
    if coalesce(trim(l->>'designation'), '') = '' then raise exception 'Une ligne n''a pas de désignation'; end if;
    if coalesce((l->>'qte')::numeric, 0) <= 0 then raise exception 'Quantité invalide (%)', l->>'designation'; end if;
    if (l->>'pu') is null or (l->>'pu')::numeric < 0 then raise exception 'Prix invalide (%)', l->>'designation'; end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Ajoute au moins une ligne'; end if;

  select id into v_f from fournisseurs where lower(trim(nom)) = lower(v_nom) limit 1;
  if v_f is null then insert into fournisseurs (nom) values (v_nom) returning id into v_f; end if;

  insert into demandes (demandeur_id, n1_id, fournisseur_id, fournisseur_nom, agence, commentaire, statut, type, urgent, devis_path, devis_num)
  values (auth.uid(), v_n1, v_f, v_nom, p->>'agence', nullif(trim(p->>'commentaire'), ''), 'tri', 'speciale',
          coalesce((p->>'urgent')::boolean, false), nullif(p->>'devis_path', ''), nullif(trim(p->>'devis_num'), ''))
  returning id into v_id;

  insert into lignes (demande_id, designation, qte, pu)
  select v_id, trim(l->>'designation'), (l->>'qte')::int, (l->>'pu')::numeric
  from jsonb_array_elements(p->'lignes') l;
  return v_id;
end $$;
