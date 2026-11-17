-- La réception est faite par la personne qui a commandé (l'admin garde la main en secours)
create or replace function public.recevoir(p_demande bigint, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  d demandes;
  it jsonb;
  l lignes;
  q int;
  n int := 0;
begin
  select * into d from demandes where id = p_demande;
  if d.id is null then raise exception 'Demande introuvable'; end if;
  if d.demandeur_id <> auth.uid() and public.mon_role() <> 'admin' then
    raise exception 'Seule la personne qui a commandé peut réceptionner';
  end if;
  if d.statut not in ('validee', 'everwin') then raise exception 'Cette demande ne peut pas être réceptionnée'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    q := (it->>'qte')::int;
    if q is null or q <= 0 then continue; end if;
    select * into l from lignes where id = (it->>'ligne_id')::bigint and demande_id = p_demande;
    if l.id is null then raise exception 'Ligne introuvable'; end if;
    if l.qte_recue + q > l.qte then raise exception 'Quantité reçue supérieure à la quantité commandée (%)', l.designation; end if;
    update lignes set qte_recue = qte_recue + q where id = l.id;
    insert into receptions (demande_id, ligne_id, agence, ref, designation, qte, recu_par)
    values (p_demande, l.id, d.agence,
            (select nullif(trim(p.ref), '') from produits p where p.id = l.produit_id),
            l.designation, q, auth.uid());
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Aucune quantité saisie'; end if;

  if not exists (select 1 from lignes where demande_id = p_demande and qte_recue < qte) then
    update demandes set statut = 'recue' where id = p_demande;
  end if;
end $$;
