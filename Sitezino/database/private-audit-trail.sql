-- Rodar após os arquivos database/radar-juridico.sql e
-- database/authorized-access-and-movements.sql em uma instalação nova.
-- No Supabase kokpxikvisheaxkicmop esta migração JÁ foi aplicada.
create schema if not exists legal_internal;
revoke all on schema legal_internal from public,anon,authenticated;
create table if not exists public.legal_audit_logs (
 id bigint generated always as identity primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,
 entity_type text not null check(entity_type in ('clients','cases','events','documents','movements')),
 entity_id uuid not null,
 action text not null check(action in ('INSERT','UPDATE','DELETE')),
 created_at timestamptz not null default now()
);
create index if not exists legal_audit_owner_idx on public.legal_audit_logs(owner_id,created_at desc);
alter table public.legal_audit_logs enable row level security;
revoke all on public.legal_audit_logs from anon,authenticated;
grant select on public.legal_audit_logs to authenticated;
drop policy if exists legal_audit_read on public.legal_audit_logs;
create policy legal_audit_read on public.legal_audit_logs for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.legal_access a where a.user_id=(select auth.uid()) and a.enabled));
create or replace function legal_internal.audit_legal_change()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare changed record;
begin
 if TG_OP='DELETE' then changed:=OLD; else changed:=NEW; end if;
 insert into public.legal_audit_logs(owner_id,actor_id,entity_type,entity_id,action)
 values(changed.owner_id,auth.uid(),substring(TG_TABLE_NAME from 7),changed.id,TG_OP);
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end; $$;
revoke all on function legal_internal.audit_legal_change() from public,anon,authenticated;
create trigger legal_client_audit after insert or update or delete on public.legal_clients for each row execute function legal_internal.audit_legal_change();
create trigger legal_case_audit after insert or update or delete on public.legal_cases for each row execute function legal_internal.audit_legal_change();
create trigger legal_event_audit after insert or update or delete on public.legal_events for each row execute function legal_internal.audit_legal_change();
create trigger legal_document_audit after insert or update or delete on public.legal_documents for each row execute function legal_internal.audit_legal_change();
create trigger legal_movement_audit after insert or update or delete on public.legal_movements for each row execute function legal_internal.audit_legal_change();
