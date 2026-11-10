-- Radar Jurídico v1: execute no SQL Editor de um projeto Supabase separado.
-- Cada advogado vê somente registros que pertencem à sua conta autenticada.
create extension if not exists pgcrypto;

create table if not exists public.legal_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'pf' check (kind in ('pf','pj')),
  name text not null check (char_length(name) between 2 and 180),
  document text check (char_length(document) <= 18),
  email text check (char_length(email) <= 180),
  phone text check (char_length(phone) <= 40),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create table if not exists public.legal_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid,
  title text not null check (char_length(title) between 2 and 180),
  cnj text check (char_length(cnj) <= 25),
  court text check (char_length(court) <= 120),
  status text not null default 'ativo' check (status in ('ativo','suspenso','encerrado')),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (client_id, owner_id) references public.legal_clients(id, owner_id)
);
create table if not exists public.legal_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  case_id uuid,
  title text not null check (char_length(title) between 2 and 180),
  kind text not null default 'compromisso' check (kind in ('compromisso','audiencia','prazo','tarefa')),
  starts_at timestamptz not null,
  completed boolean not null default false,
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (case_id, owner_id) references public.legal_cases(id, owner_id)
);
create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  case_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  storage_path text not null unique,
  constraint path_belongs_to_owner check (split_part(storage_path, '/', 1) = owner_id::text),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  mime_type text not null,
  created_at timestamptz not null default now(),
  foreign key (case_id, owner_id) references public.legal_cases(id, owner_id)
);

create index if not exists legal_clients_owner_idx on public.legal_clients(owner_id, name);
create index if not exists legal_cases_owner_idx on public.legal_cases(owner_id, created_at desc);
create index if not exists legal_events_owner_idx on public.legal_events(owner_id, starts_at);
create index if not exists legal_docs_owner_idx on public.legal_documents(owner_id, created_at desc);
create index if not exists legal_cases_client_owner_fk_idx on public.legal_cases(client_id, owner_id);
create index if not exists legal_documents_case_owner_fk_idx on public.legal_documents(case_id, owner_id);
create index if not exists legal_events_case_owner_fk_idx on public.legal_events(case_id, owner_id);

alter table public.legal_clients enable row level security;
alter table public.legal_cases enable row level security;
alter table public.legal_events enable row level security;
alter table public.legal_documents enable row level security;

revoke all on public.legal_clients, public.legal_cases, public.legal_events, public.legal_documents from anon;
grant select, insert, update, delete on public.legal_clients, public.legal_cases, public.legal_events, public.legal_documents to authenticated;

drop policy if exists legal_clients_owner on public.legal_clients;
create policy legal_clients_owner on public.legal_clients for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists legal_cases_owner on public.legal_cases;
create policy legal_cases_owner on public.legal_cases for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists legal_events_owner on public.legal_events;
create policy legal_events_owner on public.legal_events for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists legal_documents_owner on public.legal_documents;
create policy legal_documents_owner on public.legal_documents for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal-private', 'legal-private', false, 10485760,
  array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- O caminho do arquivo começa sempre com o auth.uid() do proprietário.
drop policy if exists legal_storage_read on storage.objects;
create policy legal_storage_read on storage.objects for select to authenticated
using (bucket_id = 'legal-private' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists legal_storage_insert on storage.objects;
create policy legal_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'legal-private' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists legal_storage_delete on storage.objects;
create policy legal_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'legal-private' and (storage.foldername(name))[1] = (select auth.uid())::text);
