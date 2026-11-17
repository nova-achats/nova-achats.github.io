-- Adresse qui reçoit une copie par mail des DA envoyées par la personne (ex. responsable de l'assistance technique)
alter table public.profiles add column if not exists mail_copie text;
