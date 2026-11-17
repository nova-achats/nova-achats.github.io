-- Nouveau circuit : la demande arrive d'abord chez l'admin, qui la passe en DA (-> N+1) ou en besoin (stock général)
alter table public.demandes drop constraint if exists demandes_statut_check;
alter table public.demandes add constraint demandes_statut_check
  check (statut in ('tri', 'attente', 'validee', 'refusee', 'everwin', 'besoin', 'preparee', 'recue'));
alter table public.lignes add column if not exists prepare boolean not null default false;

-- Sorties du stock général (lues plus tard par la macro du fichier stock magasin)
create table if not exists public.sorties (
  id          bigint generated always as identity primary key,
  demande_id  bigint references public.demandes(id) on delete set null,
  ligne_id    bigint references public.lignes(id) on delete set null,
  agence      text,
  ref         text,
  designation text not null,
  qte         int not null check (qte > 0),
  sorti_le    timestamptz not null default now()
);
alter table public.sorties enable row level security;
drop policy if exists "admin lit sorties" on public.sorties;
create policy "admin lit sorties" on public.sorties for select to authenticated using (public.mon_role() = 'admin');

-- Les demandes du panier arrivent chez l'admin (statut 'tri')
create or replace function public.creer_demandes(p_agence text, p_commentaire text, p_items jsonb)
returns bigint[] language plpgsql security definer set search_path = public as $$
declare
  v_n1  uuid;
  v_f   bigint;
  v_id  bigint;
  v_ids bigint[] := '{}';
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select n1_id into v_n1 from profiles where id = auth.uid();
  if v_n1 is null then raise exception 'Aucun N+1 rattaché à ton compte : demande à l''admin.'; end if;

  for v_f in
    select distinct p.fournisseur_id
    from jsonb_array_elements(p_items) i
    join produits p on p.id = (i->>'produit_id')::bigint and p.actif
    where (i->>'qte')::int > 0
  loop
    insert into demandes (demandeur_id, n1_id, fournisseur_id, agence, commentaire, statut)
    values (auth.uid(), v_n1, v_f, p_agence, nullif(trim(p_commentaire), ''), 'tri')
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
  return v_ids;
end $$;

-- L'admin trie : 'da' -> validation N+1, 'besoin' -> préparation depuis le stock général
create or replace function public.trier_demande(p_id bigint, p_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mon_role() <> 'admin' then raise exception 'Réservé à l''admin'; end if;
  if p_mode not in ('da', 'besoin') then raise exception 'Choix invalide'; end if;
  update demandes set statut = case when p_mode = 'da' then 'attente' else 'besoin' end
   where id = p_id and statut = 'tri';
  if not found then raise exception 'Demande introuvable ou déjà triée'; end if;
end $$;

-- L'admin coche les articles mis dans le carton ; tout coché -> sortie du stock général
create or replace function public.cocher_ligne(p_ligne bigint, p_ok boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  l lignes;
  d demandes;
begin
  if public.mon_role() <> 'admin' then raise exception 'Réservé à l''admin'; end if;
  select * into l from lignes where id = p_ligne;
  select * into d from demandes where id = l.demande_id;
  if d.id is null or d.statut <> 'besoin' then raise exception 'Ce besoin n''est plus modifiable'; end if;
  update lignes set prepare = p_ok where id = p_ligne;

  if not exists (select 1 from lignes where demande_id = d.id and not prepare) then
    insert into sorties (demande_id, ligne_id, agence, ref, designation, qte)
    select d.id, x.id, d.agence, (select nullif(trim(p.ref), '') from produits p where p.id = x.produit_id), x.designation, x.qte
    from lignes x where x.demande_id = d.id;
    update demandes set statut = 'preparee', valide_le = now() where id = d.id;
    return 'preparee';
  end if;
  return 'besoin';
end $$;

-- Réception aussi possible pour un besoin préparé
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
  if d.statut not in ('validee', 'everwin', 'preparee') then raise exception 'Cette demande ne peut pas être réceptionnée'; end if;

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

-- Lecture des sorties par la future macro du fichier stock magasin (même clé que les agences)
create or replace function public.stock_sorties(p_cle text, p_depuis bigint)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if p_cle is null or p_cle <> (select valeur from parametres where cle = 'cle_excel') then
    raise exception 'Clé invalide';
  end if;
  return coalesce((
    select string_agg(s.id || '|' || to_char(s.sorti_le at time zone 'Europe/Paris', 'YYYY-MM-DD') || '|' ||
                      coalesce(s.ref, '') || '|' || s.qte || '|' || coalesce(s.agence, '') || '|' ||
                      replace(replace(s.designation, '|', '/'), chr(10), ' '),
                      chr(10) order by s.id)
    from sorties s where s.id > coalesce(p_depuis, 0)
  ), '');
end $$;

grant execute on function public.trier_demande(bigint, text) to authenticated;
grant execute on function public.cocher_ligne(bigint, boolean) to authenticated;
grant execute on function public.stock_sorties(text, bigint) to anon, authenticated;
