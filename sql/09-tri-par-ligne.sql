-- Tri article par article : les lignes "stock" partent dans la fiche besoin de la personne
-- (une seule fiche ouverte par personne et par agence, tous fournisseurs confondus),
-- les autres restent dans la DA qui part chez le N+1.
create or replace function public.trier_lignes(p_id bigint, p_stock bigint[])
returns void language plpgsql security definer set search_path = public as $$
declare
  d demandes;
  v_b bigint;
  n_stock int;
  n_total int;
begin
  if public.mon_role() <> 'admin' then raise exception 'Réservé à l''admin'; end if;
  select * into d from demandes where id = p_id;
  if d.id is null or d.statut <> 'tri' then raise exception 'Demande introuvable ou déjà triée'; end if;

  select count(*) into n_total from lignes where demande_id = p_id;
  select count(*) into n_stock from lignes where demande_id = p_id and id = any(coalesce(p_stock, '{}'));

  if n_stock > 0 then
    select id into v_b from demandes
     where statut = 'besoin' and demandeur_id = d.demandeur_id and agence is not distinct from d.agence
     order by id limit 1;
    if v_b is null then
      insert into demandes (demandeur_id, n1_id, fournisseur_id, fournisseur_nom, agence, commentaire, statut)
      values (d.demandeur_id, d.n1_id, null, 'Stock général', d.agence, d.commentaire, 'besoin')
      returning id into v_b;
    end if;
    update lignes set demande_id = v_b, prepare = false where demande_id = p_id and id = any(p_stock);
  end if;

  if n_stock = n_total then
    delete from demandes where id = p_id;
  else
    update demandes set statut = 'attente' where id = p_id;
  end if;
end $$;

grant execute on function public.trier_lignes(bigint, bigint[]) to authenticated;
