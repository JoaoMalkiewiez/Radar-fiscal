-- Executar DEPOIS de database/radar-juridico.sql em uma instalação nova.
-- A migração equivalente já foi aplicada no projeto Radar Jurídico.
create table if not exists public.legal_access (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 role text not null default 'advogado' check(role in ('administrador','advogado','assistente')),
 created_at timestamptz not null default now()
);
alter table public.legal_access enable row level security;
revoke all on public.legal_access from anon,authenticated;
grant select on public.legal_access to authenticated;
drop policy if exists legal_access_self on public.legal_access;
create policy legal_access_self on public.legal_access for select to authenticated
 using(user_id=(select auth.uid()));

create table if not exists public.legal_movements (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 case_id uuid not null,
 title text not null check(char_length(title) between 2 and 180),
 details text check(char_length(details)<=4000),
 happened_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 foreign key(case_id,owner_id) references public.legal_cases(id,owner_id)
);
create index if not exists legal_movements_owner_idx on public.legal_movements(owner_id,happened_at desc);
create index if not exists legal_movements_case_owner_idx on public.legal_movements(case_id,owner_id);
alter table public.legal_movements enable row level security;
revoke all on public.legal_movements from anon;
grant select,insert,update,delete on public.legal_movements to authenticated;

drop policy if exists legal_movements_owner on public.legal_movements;
create policy legal_movements_owner on public.legal_movements for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
drop policy if exists legal_clients_owner on public.legal_clients;
create policy legal_clients_owner on public.legal_clients for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
drop policy if exists legal_cases_owner on public.legal_cases;
create policy legal_cases_owner on public.legal_cases for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
drop policy if exists legal_events_owner on public.legal_events;
create policy legal_events_owner on public.legal_events for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
drop policy if exists legal_documents_owner on public.legal_documents;
create policy legal_documents_owner on public.legal_documents for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
drop policy if exists legal_storage_read on storage.objects;
create policy legal_storage_read on storage.objects for select to authenticated
 using(bucket_id='legal-private' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
drop policy if exists legal_storage_insert on storage.objects;
create policy legal_storage_insert on storage.objects for insert to authenticated
 with check(bucket_id='legal-private' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
drop policy if exists legal_storage_delete on storage.objects;
create policy legal_storage_delete on storage.objects for delete to authenticated
 using(bucket_id='legal-private' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
