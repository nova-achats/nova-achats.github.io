-- Fréquence d'envoi du panier par personne + besoin urgent
alter table public.profiles add column if not exists delai_jours int not null default 0;
alter table public.demandes add column if not exists urgent boolean not null default false;

-- Historique des envois de panier (sert au délai et au comptage des urgences)
create table if not exists public.envois (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  urgent     boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.envois enable row level security;
drop policy if exists "envois visibles" on public.envois;
create policy "envois visibles" on public.envois for select to authenticated using (
  user_id = auth.uid() or public.mon_role() = 'admin'
  or exists (select 1 from profiles p where p.id = envois.user_id and p.n1_id = auth.uid())
);

drop function if exists public.creer_demandes(text, text, jsonb);
create or replace function public.creer_demandes(p_agence text, p_commentaire text, p_items jsonb, p_urgent boolean default false)
returns bigint[] language plpgsql security definer set search_path = public as $$
declare
  v_n1  uuid;
  v_del int;
  v_der timestamptz;
  v_f   bigint;
  v_id  bigint;
  v_ids bigint[] := '{}';
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select n1_id, delai_jours into v_n1, v_del from profiles where id = auth.uid();
  if v_n1 is null then raise exception 'Aucun N+1 rattaché à ton compte : demande à l''admin.'; end if;

  if not coalesce(p_urgent, false) and v_del > 0 then
    select max(created_at) into v_der from envois where user_id = auth.uid() and not urgent;
    if v_der is not null and v_der + make_interval(days => v_del) > now() then
      raise exception 'Prochain envoi possible le %. Si ça ne peut pas attendre, coche « Besoin urgent ».',
        to_char((v_der + make_interval(days => v_del)) at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI');
    end if;
  end if;

  for v_f in
    select distinct p.fournisseur_id
    from jsonb_array_elements(p_items) i
    join produits p on p.id = (i->>'produit_id')::bigint and p.actif
    where (i->>'qte')::int > 0
  loop
    insert into demandes (demandeur_id, n1_id, fournisseur_id, agence, commentaire, statut, urgent)
    values (auth.uid(), v_n1, v_f, p_agence, nullif(trim(p_commentaire), ''), 'tri', coalesce(p_urgent, false))
    returning id into v_id;

    insert into lignes (demande_id, produit_id, designation, qte, pu)
    select v_id, p.id,
           p.nom || coalesce(' — T ' || nullif(i->>'taille', ''), ''),
           (i->>'qte')::int, p.prix
    from jsonb_array_elements(p_items) i
    join produits p on p.id = (i->>'produit_id')::bigint
    where p.fournisseur_id = v_f and p.actif and (i->>'qte')::int > 0;

    v_ids := v_ids || v_id;
  end loop;

  if array_length(v_ids, 1) is null then raise exception 'Panier vide'; end if;
  insert into envois (user_id, urgent) values (auth.uid(), coalesce(p_urgent, false));
  return v_ids;
end $$;
grant execute on function public.creer_demandes(text, text, jsonb, boolean) to authenticated;

-- Le tri garde le marquage urgent sur la fiche besoin
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
      insert into demandes (demandeur_id, n1_id, fournisseur_id, fournisseur_nom, agence, commentaire, statut, urgent)
      values (d.demandeur_id, d.n1_id, null, 'Stock général', d.agence, d.commentaire, 'besoin', d.urgent)
      returning id into v_b;
    elsif d.urgent then
      update demandes set urgent = true where id = v_b;
    end if;
    update lignes set demande_id = v_b, prepare = false where demande_id = p_id and id = any(p_stock);
  end if;

  if n_stock = n_total then
    delete from demandes where id = p_id;
  else
    update demandes set statut = 'attente' where id = p_id;
  end if;
end $$;
