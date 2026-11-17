-- Réception des commandes + synchro avec les fichiers Excel stock des agences
alter table public.lignes add column if not exists qte_recue int not null default 0;

alter table public.demandes drop constraint if exists demandes_statut_check;
alter table public.demandes add constraint demandes_statut_check check (statut in ('attente', 'validee', 'refusee', 'everwin', 'recue'));

create table if not exists public.receptions (
  id          bigint generated always as identity primary key,
  demande_id  bigint references public.demandes(id) on delete set null,
  ligne_id    bigint references public.lignes(id) on delete set null,
  agence      text,
  ref         text,
  designation text not null,
  qte         int not null check (qte > 0),
  recu_le     timestamptz not null default now(),
  recu_par    uuid references public.profiles(id)
);
alter table public.receptions enable row level security;
drop policy if exists "admin lit receptions" on public.receptions;
create policy "admin lit receptions" on public.receptions for select to authenticated using (public.mon_role() = 'admin');

-- Clé secrète utilisée par les macros Excel (table illisible depuis le site)
create table if not exists public.parametres (cle text primary key, valeur text not null);
alter table public.parametres enable row level security;
insert into public.parametres (cle, valeur) values ('cle_excel', 'CLE_SECRETE_A_DEFINIR')
  on conflict (cle) do update set valeur = excluded.valeur;

-- L'admin enregistre ce qui est arrivé (réception totale ou partielle)
create or replace function public.recevoir(p_demande bigint, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  d demandes;
  it jsonb;
  l lignes;
  q int;
  n int := 0;
begin
  if public.mon_role() <> 'admin' then raise exception 'Réservé à l''admin'; end if;
  select * into d from demandes where id = p_demande;
  if d.id is null then raise exception 'Demande introuvable'; end if;
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
revoke execute on function public.recevoir(bigint, jsonb) from public, anon;
grant execute on function public.recevoir(bigint, jsonb) to authenticated;

-- Lu par la macro Excel : réceptions d'une agence après le dernier numéro déjà importé
-- Une ligne par réception : id|AAAA-MM-JJ|ref|qte|designation
create or replace function public.stock_receptions(p_agence text, p_cle text, p_depuis bigint)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if p_cle is null or p_cle <> (select valeur from parametres where cle = 'cle_excel') then
    raise exception 'Clé invalide';
  end if;
  return coalesce((
    select string_agg(r.id || '|' || to_char(r.recu_le at time zone 'Europe/Paris', 'YYYY-MM-DD') || '|' ||
                      coalesce(r.ref, '') || '|' || r.qte || '|' || replace(replace(r.designation, '|', '/'), chr(10), ' '),
                      chr(10) order by r.id)
    from receptions r
    where lower(trim(r.agence)) = lower(trim(p_agence)) and r.id > coalesce(p_depuis, 0)
  ), '');
end $$;
revoke execute on function public.stock_receptions(text, text, bigint) from public;
grant execute on function public.stock_receptions(text, text, bigint) to anon, authenticated;
